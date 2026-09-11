import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  inspectSitesSnapshot,
  sitesSnapshotBaseline,
} from './sites-snapshot.mjs';

const maxSourceBytes = 64 * 1024 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const importedTables = [
  'portal_state',
  'application_drafts',
  'consulting_flows',
];
const excludedTables = [
  'portal_chatgpt_member_bindings',
  'portal_chatgpt_identity_bindings',
];

export class SitesImportError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function importRequired(condition, code) {
  if (!condition) throw new SitesImportError(code);
}

function identity(path) {
  importRequired(
    !['-wal', '-shm', '-journal'].some((suffix) => existsSync(path + suffix)),
    'source-sidecars-present',
  );
  const stat = statSync(path, { bigint: true });
  importRequired(
    stat.isFile() && stat.size <= BigInt(maxSourceBytes),
    'source-file-budget-or-type',
  );
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}

// Narrow four-row import reader. Never accepts SQL/JSON exports or report JSON as
// evidence, never changes the snapshot, and never exposes authentication cells.
export async function readSitesImportSource(inputPath) {
  let db;
  try {
    importRequired(
      typeof inputPath === 'string' &&
        inputPath.length > 0 &&
        !inputPath.includes('\0'),
      'source-path-required',
    );
    const path = resolve(inputPath);
    const beforeIdentity = identity(path);
    const fileSha256 = sha256(await readFile(path));
    const report = await inspectSitesSnapshot(path);
    importRequired(
      report.complete &&
        Object.keys(report.issues).length === 0 &&
        report.tables.every((table) => Object.keys(table.issues).length === 0),
      'source-snapshot-preflight-failed',
    );
    const counts = Object.fromEntries(
      report.tables.map((table) => [table.name, table.rows]),
    );
    importRequired(
      importedTables.every((name) => counts[name] === 1),
      'source-three-business-rows-required',
    );
    importRequired(
      excludedTables.reduce((total, name) => total + counts[name], 0) === 1,
      'source-one-archived-identity-required',
    );
    importRequired(
      report.tables.every(
        ({ name, rows }) =>
          importedTables.includes(name) ||
          excludedTables.includes(name) ||
          rows === 0,
      ),
      'source-outside-scoped-import',
    );
    const baseline = await sitesSnapshotBaseline();
    db = new DatabaseSync(path, {
      readOnly: true,
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      timeout: 1000,
    });
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; BEGIN');
    const objects = db
      .prepare(
        "SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type COLLATE BINARY,name COLLATE BINARY",
      )
      .all()
      .map((row) => ({
        ...row,
        sql: row.sql?.replaceAll('\r\n', '\n').trim() ?? null,
      }));
    importRequired(
      JSON.stringify(objects) === JSON.stringify(baseline.objects),
      'source-schema-changed',
    );
    const rows = {};
    for (const table of importedTables) {
      const columns = baseline.columns[table];
      const query = db.prepare(
        'SELECT ' +
          columns
            .map(
              ({ name }, i) =>
                `typeof("${name}") AS t${i},CASE WHEN typeof("${name}") IN ('text','blob') THEN CAST("${name}" AS BLOB) ELSE "${name}" END AS v${i}`,
            )
            .join(',') +
          ` FROM "${table}" NOT INDEXED`,
      );
      query.setReadBigInts(true);
      const entries = query.all();
      importRequired(entries.length === 1, 'source-count-changed');
      rows[table] = Object.fromEntries(
        columns.map(({ name, type }, i) => {
          const storageType = entries[0]['t' + i];
          const value = entries[0]['v' + i];
          importRequired(
            storageType === type.toLowerCase() || storageType === 'null',
            'source-cell-type-changed',
          );
          return [name, storageType === 'text' ? utf8.decode(value) : value];
        }),
      );
    }
    db.exec('ROLLBACK');
    db.close();
    db = undefined;
    const recheck = async () => {
      try {
        importRequired(
          identity(path) === beforeIdentity &&
            sha256(await readFile(path)) === fileSha256,
          'source-changed-since-plan',
        );
        importRequired(
          identity(path) === beforeIdentity,
          'source-changed-since-plan',
        );
      } catch {
        throw new SitesImportError('source-changed-since-plan');
      }
    };
    await recheck();
    return {
      rows,
      report,
      fileSha256,
      recheck,
      exclusions: excludedTables.map((table) => ({
        table,
        rows: counts[table],
        disposition: 'preserved-in-source-not-activated',
      })),
    };
  } catch (error) {
    if (error instanceof SitesImportError) throw error;
    throw new SitesImportError('source-read-failed');
  } finally {
    if (db) db.close();
  }
}
