import { createHash } from 'node:crypto';
import { existsSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  sourceTablePolicy,
  unverifiedMigrationGates,
} from './sites-snapshot-policy.mjs';

const format = 'partner-hub-sites-snapshot-v1';
const maxRows = 100_000;
const maxCellBytes = 64 * 1024 * 1024;
const maxTotalBytes = 1024 * 1024 * 1024;
const maxSnapshotBytes = 2 * 1024 * 1024 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonicalSql = (sql) => sql?.replaceAll('\r\n', '\n').trim() ?? null;
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
let baselinePromise;

export class SnapshotError extends Error {
  constructor(code) {
    // Never include an input path, SQL error, filename, identifier, or cell value.
    super(code);
    this.code = code;
  }
}

function schemaObjects(db) {
  return db
    .prepare(
      "SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type COLLATE BINARY,name COLLATE BINARY",
    )
    .all()
    .map((row) => ({ ...row, sql: canonicalSql(row.sql) }));
}

function columnsOf(db, table) {
  return db
    .prepare(
      'SELECT cid,name,type,"notnull",dflt_value,pk,hidden FROM pragma_table_xinfo(?) ORDER BY cid',
    )
    .all(table);
}

export async function sitesSnapshotBaseline() {
  baselinePromise ??= (async () => {
    const directory = new URL('../drizzle/', import.meta.url);
    const migrations = [];
    const db = new DatabaseSync(':memory:', { allowExtension: false });
    try {
      for (const name of (await readdir(directory))
        .filter((name) => /^\d.*\.sql$/.test(name))
        .sort(compareText)) {
        const sql = (
          await readFile(new URL(name, directory), 'utf8')
        ).replaceAll('\r\n', '\n');
        // Only trusted repository migrations, never input SQL dumps. SQLite parses triggers.
        db.exec(sql);
        migrations.push({ name, sha256: sha256(sql) });
      }
      const objects = schemaObjects(db);
      const tables = objects
        .filter((row) => row.type === 'table')
        .map((row) => row.name)
        .sort(compareText);
      if (
        JSON.stringify(tables) !==
        JSON.stringify(Object.keys(sourceTablePolicy).sort(compareText))
      )
        throw new SnapshotError('source-policy-needs-update');
      return {
        migrations,
        objects,
        tables,
        columns: Object.fromEntries(
          tables.map((table) => [table, columnsOf(db, table)]),
        ),
      };
    } finally {
      db.close();
    }
  })();
  return baselinePromise;
}

function fileIdentity(path) {
  const stat = statSync(path, { bigint: true });
  if (!stat.isFile()) throw new SnapshotError('snapshot-not-regular-file');
  if (stat.size > BigInt(maxSnapshotBytes))
    throw new SnapshotError('snapshot-file-budget-exceeded');
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}

function assertStandaloneSnapshot(path) {
  if (['-wal', '-shm', '-journal'].some((suffix) => existsSync(path + suffix)))
    throw new SnapshotError('snapshot-sidecars-present');
  const fd = openSync(path, 'r');
  try {
    const header = Buffer.alloc(100);
    if (
      readSync(fd, header, 0, header.length, 0) !== 100 ||
      header.subarray(0, 16).toString('ascii') !== 'SQLite format 3\0'
    )
      throw new SnapshotError('snapshot-not-sqlite');
    if (header[18] !== 1 || header[19] !== 1)
      throw new SnapshotError('snapshot-wal-or-unsupported-format');
  } finally {
    closeSync(fd);
  }
}

function frame(hash, type, bytes) {
  hash.update(type + ':' + bytes.byteLength + ':');
  hash.update(bytes);
}

function cellBytes(type, value) {
  if (type === 'null') return Buffer.alloc(0);
  if (type === 'integer') return Buffer.from(value.toString());
  if (type === 'real') {
    const buffer = Buffer.alloc(8);
    buffer.writeDoubleBE(value);
    return buffer;
  }
  if (type === 'text' || type === 'blob') return value;
  throw new SnapshotError('snapshot-unsupported-value');
}

function canonicalTimestamp(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    return false;
  const time = new Date(value);
  return Number.isFinite(time.valueOf()) && time.toISOString() === value;
}

function inspectTable(db, table, columns, budget) {
  /** @type {Record<string, number>} */
  const issues = {};
  const note = (code) => {
    issues[code] = (issues[code] ?? 0) + 1;
  };
  const hashes = [];
  const query = db.prepare(
    'SELECT ' +
      columns
        .map((column, i) => {
          const c = quote(column.name);
          // TEXT comes back as raw UTF-8 bytes, not a potentially lossy JS string.
          return `typeof(${c}) AS t${i},CASE WHEN typeof(${c}) IN ('text','blob') THEN CAST(${c} AS BLOB) ELSE ${c} END AS v${i}`;
        })
        .join(',') +
      ` FROM main.${quote(table)} NOT INDEXED`,
  );
  query.setReadBigInts(true);
  const validJson = db.prepare('SELECT json_valid(?) AS valid');
  const duplicateJson = db.prepare(
    'SELECT 1 FROM json_tree(?) WHERE key IS NOT NULL GROUP BY parent,key HAVING count(*) > 1 LIMIT 1',
  );
  let logicalBytes = 0;
  for (const row of query.iterate()) {
    if (++budget.rows > maxRows)
      throw new SnapshotError('snapshot-row-budget-exceeded');
    const rowHash = createHash('sha256');
    const fileFields = {};
    frame(rowHash, 'row', Buffer.from(table));
    for (const [i, column] of columns.entries()) {
      const type = row['t' + i];
      const value = row['v' + i];
      const bytes = cellBytes(type, value);
      if (bytes.byteLength > maxCellBytes)
        throw new SnapshotError('snapshot-cell-budget-exceeded');
      budget.bytes += bytes.byteLength;
      logicalBytes += bytes.byteLength;
      if (budget.bytes > maxTotalBytes)
        throw new SnapshotError('snapshot-byte-budget-exceeded');
      frame(rowHash, 'column', Buffer.from(column.name));
      frame(rowHash, type, bytes);
      if (type === 'null') {
        if (column.notnull || column.pk) note('required-cell-null');
        continue;
      }
      if (type !== column.type.toLowerCase()) note('storage-class-mismatch');
      if (type !== 'text') continue;
      let text;
      try {
        text = utf8.decode(bytes);
      } catch {
        note('invalid-utf8');
        continue;
      }
      if (['id', 'file_id', 'storage_key'].includes(column.name))
        fileFields[column.name] = text;
      if (text.includes('\0')) note('postgres-text-nul');
      if (column.name.endsWith('_at') && !canonicalTimestamp(text))
        note('noncanonical-timestamp');
      if (
        column.name === 'bucket_date' &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(text) ||
          !canonicalTimestamp(text + 'T00:00:00.000Z'))
      )
        note('noncanonical-bucket-date');
      if (column.name === 'payload' || column.name === 'result_json') {
        if (validJson.get(text).valid !== 1) note('invalid-json');
        else if (duplicateJson.get(text)) note('duplicate-json-key');
      }
    }
    if (
      table === 'company_file_objects' ||
      table === 'company_file_storage_keys'
    ) {
      const id = fileFields.id ?? fileFields.file_id;
      if (!id || fileFields.storage_key !== 'company-source/' + id)
        note('noncanonical-company-storage-key');
    }
    if (
      table === 'consulting_flow_file_owners' ||
      table === 'consulting_flow_upload_requests'
    ) {
      if (
        !fileFields.file_id ||
        fileFields.storage_key !== 'consulting-flow/' + fileFields.file_id
      )
        note('noncanonical-flow-storage-key');
    }
    hashes.push(rowHash.digest());
  }
  // A multiset digest preserves duplicates, column association and SQLite storage classes,
  // independent of rowid, insertion order, collations or indexes. No private row hashes leave here.
  hashes.sort((a, b) => Buffer.compare(a, b));
  const hash = createHash('sha256');
  frame(hash, 'table', Buffer.from(table));
  frame(hash, 'rows', Buffer.from(String(hashes.length)));
  for (const digest of hashes) frame(hash, 'row-sha256', digest);
  return {
    name: table,
    policy: sourceTablePolicy[table],
    rows: hashes.length,
    logicalBytes,
    sha256: hash.digest('hex'),
    issues,
  };
}

function pendingReview(tables) {
  const rows = (table) =>
    tables.find((entry) => entry.name === table)?.rows ?? 0;
  return {
    historicalFlowRows: rows('consulting_flows'),
    passwordAccountRows: rows('portal_password_accounts'),
    inactiveAuthenticationRows: tables
      .filter((entry) => entry.policy.startsWith('archive-'))
      .reduce((count, entry) => count + entry.rows, 0),
    fileRootRows:
      rows('company_file_objects') + rows('consulting_flow_file_owners'),
    uploadReservationRows:
      rows('company_file_upload_requests') +
      rows('consulting_flow_upload_requests'),
  };
}

export async function inspectSitesSnapshot(inputPath) {
  let db;
  try {
    if (typeof inputPath !== 'string' || !inputPath || inputPath.includes('\0'))
      throw new SnapshotError('snapshot-path-required');
    const baseline = await sitesSnapshotBaseline();
    const path = resolve(inputPath);
    const identity = fileIdentity(path);
    assertStandaloneSnapshot(path);
    db = new DatabaseSync(path, {
      readOnly: true,
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      timeout: 1000,
    });
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; BEGIN');
    // Pin one coherent read transaction before reading any table or checking schema.
    const objects = schemaObjects(db);
    if (db.prepare('PRAGMA encoding').get().encoding !== 'UTF-8')
      throw new SnapshotError('snapshot-encoding-not-utf8');
    const schemaSha256 = sha256(JSON.stringify(objects));
    const baselineSchemaSha256 = sha256(JSON.stringify(baseline.objects));
    /** @type {Record<string, number>} */
    const issues = {};
    const actualTables = objects.filter((entry) => entry.type === 'table');
    const unknownTables = actualTables.filter(
      (entry) => !Object.hasOwn(sourceTablePolicy, entry.name),
    );
    if (unknownTables.length)
      issues['unknown-source-tables'] = unknownTables.length;
    const schemaMatchesBaseline = schemaSha256 === baselineSchemaSha256;
    if (!schemaMatchesBaseline) issues['schema-differs-from-repository'] = 1;
    // Integrity pragmas may evaluate CHECK expressions from schema. Run them only
    // against the exact trusted schema, never an input file's arbitrary SQL.
    if (schemaMatchesBaseline) {
      const quick = db.prepare('PRAGMA quick_check(20)').all();
      if (quick.length !== 1 || quick[0].quick_check !== 'ok')
        issues['sqlite-quick-check-failed'] = 1;
      let foreignKeyViolations = 0;
      for (const _row of db.prepare('PRAGMA foreign_key_check').iterate()) {
        if (++foreignKeyViolations > maxRows)
          throw new SnapshotError('snapshot-row-budget-exceeded');
      }
      if (foreignKeyViolations)
        issues['foreign-key-violations'] = foreignKeyViolations;
    } else {
      issues['sqlite-integrity-check-skipped-schema-drift'] = 1;
    }
    const tables = [];
    const budget = { rows: 0, bytes: 0 };
    let allTablesRead = unknownTables.length === 0;
    for (const table of baseline.tables) {
      if (!actualTables.some((entry) => entry.name === table)) {
        issues['missing-source-tables'] =
          (issues['missing-source-tables'] ?? 0) + 1;
        allTablesRead = false;
        continue;
      }
      // Never SELECT a source view, virtual table or altered/generated column schema.
      const info = db
        .prepare(
          'SELECT type FROM pragma_table_list WHERE schema = ? AND name = ?',
        )
        .get('main', table);
      const columns = columnsOf(db, table);
      if (
        info?.type !== 'table' ||
        JSON.stringify(columns) !== JSON.stringify(baseline.columns[table])
      ) {
        issues['unsupported-table-schema'] =
          (issues['unsupported-table-schema'] ?? 0) + 1;
        allTablesRead = false;
        continue;
      }
      tables.push(inspectTable(db, table, columns, budget));
    }
    db.exec('ROLLBACK');
    db.close();
    db = undefined;
    assertStandaloneSnapshot(path);
    if (identity !== fileIdentity(path))
      throw new SnapshotError('snapshot-file-changed');
    const complete =
      allTablesRead &&
      schemaMatchesBaseline &&
      !issues['sqlite-quick-check-failed'];
    const dataSha256 = complete
      ? sha256(
          JSON.stringify(
            tables.map(({ name, rows, sha256 }) => ({ name, rows, sha256 })),
          ),
        )
      : null;
    return {
      format,
      complete,
      migrationReady: false,
      scope: 'local-sqlite-logical-snapshot-only',
      limits: { maxRows, maxCellBytes, maxTotalBytes, maxSnapshotBytes },
      baseline: {
        migrationCount: baseline.migrations.length,
        migrationsSha256: sha256(JSON.stringify(baseline.migrations)),
        schemaSha256: baselineSchemaSha256,
      },
      schemaSha256,
      dataSha256,
      issues,
      tables,
      review: pendingReview(tables),
      unverified: [...unverifiedMigrationGates],
    };
  } catch (error) {
    if (error instanceof SnapshotError) throw error;
    throw new SnapshotError('snapshot-read-failed');
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        /* Do not leak SQLite diagnostics. */
      }
    }
  }
}

export async function compareSitesSnapshots(leftPath, rightPath) {
  // Inspect files directly. Never trust a user-edited JSON manifest as restore evidence.
  const left = await inspectSitesSnapshot(leftPath);
  const right = await inspectSitesSnapshot(rightPath);
  const schemaMatches = left.schemaSha256 === right.schemaSha256;
  const comparable = left.complete && right.complete;
  return {
    format,
    scope: 'local-sqlite-logical-comparison-only',
    comparable,
    sqliteLogicalMatch:
      comparable && schemaMatches && left.dataSha256 === right.dataSha256,
    schemaMatches,
    migrationReady: false,
    changedTables: [
      ...new Set([...left.tables, ...right.tables].map((entry) => entry.name)),
    ]
      .filter((name) => {
        const a = left.tables.find((entry) => entry.name === name);
        const b = right.tables.find((entry) => entry.name === name);
        return !a || !b || a.rows !== b.rows || a.sha256 !== b.sha256;
      })
      .sort(compareText),
    left,
    right,
  };
}
