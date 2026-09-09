import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { test, type TestContext } from 'node:test';
import {
  inspectSitesSnapshot,
  compareSitesSnapshots,
  sitesSnapshotBaseline,
} from '../scripts/sites-snapshot.mjs';
import { sourceTablePolicy } from '../scripts/sites-snapshot-policy.mjs';

const stamp = '2026-09-10T00:00:00.000Z';
const secret = 'PRIVATE-SNAPSHOT-MUST-NEVER-BE-LOGGED';
const sourceSql = readdirSync(new URL('../drizzle/', import.meta.url))
  .filter((name) => /^\d.*\.sql$/.test(name))
  .sort()
  .map((name) =>
    readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'),
  );
const hash = (path: string) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'partner-hub-snapshot-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, 'source.sqlite');
  const restored = join(directory, 'restored.sqlite');
  const db = new DatabaseSync(source);
  for (const sql of sourceSql) db.exec(sql);
  db.close();
  return { directory, source, restored };
}

// Adversarial fixture creation only. Reinstall the exact original trigger SQL so
// negative rows do not accidentally turn the test into a schema-only mismatch.
function editFixture(path: string, edit: (db: DatabaseSync) => void) {
  const db = new DatabaseSync(path);
  const triggers = db
    .prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger'")
    .all() as { name: string; sql: string }[];
  try {
    db.exec('BEGIN');
    for (const trigger of triggers)
      db.exec('DROP TRIGGER ' + quote(trigger.name));
    edit(db);
    for (const trigger of triggers) db.exec(trigger.sql);
    db.exec('COMMIT');
  } finally {
    db.close();
  }
}

function portal(db: DatabaseSync, payload: string) {
  db.prepare('INSERT INTO portal_state VALUES(?,?,?)').run(
    'portal',
    payload,
    stamp,
  );
}

void test('all 99 source migrations and 30 policies are accounted for without production access', async (t) => {
  const { source } = fixture(t);
  const baseline = await sitesSnapshotBaseline();
  assert.equal(baseline.migrations.length, 99);
  assert.equal(baseline.tables.length, 30);
  assert.deepEqual(baseline.tables, Object.keys(sourceTablePolicy).sort());
  assert.equal(
    sourceTablePolicy.portal_chatgpt_member_bindings,
    'archive-sites-identity-only',
  );
  const before = hash(source);
  const report = await inspectSitesSnapshot(source);
  assert.equal(report.complete, true);
  assert.equal(report.migrationReady, false);
  assert.deepEqual(report.issues, {});
  assert.equal(report.schemaSha256, report.baseline.schemaSha256);
  assert.ok(report.tables.every((table) => table.rows === 0));
  assert.equal(report.unverified.length, 5);
  assert.equal(hash(source), before);
});

void test('large raw JSON, byte order and exact integer values are retained in the logical digest', async (t) => {
  const { source, restored } = fixture(t);
  editFixture(source, (db) => {
    portal(
      db,
      '{ "private":"' +
        secret +
        '" , "long":"' +
        '한'.repeat(40_000) +
        '","n":9007199254740993}',
    );
    db.prepare('INSERT INTO portal_login_stats VALUES(?,?,?)').run(
      'private-member',
      stamp,
      BigInt('9007199254740993'),
    );
  });
  copyFileSync(source, restored);
  const before = hash(source);
  const match = await compareSitesSnapshots(source, restored);
  assert.equal(match.sqliteLogicalMatch, true);
  assert.equal(match.migrationReady, false);
  assert.ok(
    match.left.tables.find((table) => table.name === 'portal_state')!
      .logicalBytes > 120_000,
  );
  const output = JSON.stringify(match);
  assert.ok(!output.includes(secret));
  assert.ok(!output.includes('private-member'));
  assert.ok(!output.includes('9007199254740993'));
  assert.equal(hash(source), before);
  editFixture(restored, (db) => {
    db.prepare('UPDATE portal_login_stats SET login_count=?').run(
      BigInt('9007199254740992'),
    );
  });
  const changed = await compareSitesSnapshots(source, restored);
  assert.equal(changed.sqliteLogicalMatch, false);
  assert.deepEqual(changed.changedTables, ['portal_login_stats']);
});

void test('digest ignores physical insertion order but detects JSON whitespace/key order changes', async (t) => {
  const { source, restored } = fixture(t);
  editFixture(source, (db) => {
    portal(db, '{"a":1,"b":2}');
    const insert = db.prepare('INSERT INTO portal_login_stats VALUES(?,?,?)');
    insert.run('b', stamp, 2);
    insert.run('a', stamp, 1);
  });
  copyFileSync(source, restored);
  editFixture(restored, (db) => {
    db.exec('DELETE FROM portal_login_stats');
    const insert = db.prepare('INSERT INTO portal_login_stats VALUES(?,?,?)');
    insert.run('a', stamp, 1);
    insert.run('b', stamp, 2);
  });
  assert.equal(
    (await compareSitesSnapshots(source, restored)).sqliteLogicalMatch,
    true,
  );
  for (const payload of ['{ "a":1,"b":2}', '{"b":2,"a":1}']) {
    editFixture(restored, (db) => {
      db.prepare('UPDATE portal_state SET payload=?').run(payload);
    });
    assert.deepEqual(
      (await compareSitesSnapshots(source, restored)).changedTables,
      ['portal_state'],
    );
  }
});

void test('empty, blob, embedded NUL, integer and nearby real values cannot hash as the same value', async (t) => {
  const { source } = fixture(t);
  editFixture(source, (db) => {
    db.prepare('INSERT INTO portal_auth_limits VALUES(?,?,?)').run(
      secret,
      1,
      1000,
    );
  });
  const digests = new Set<string>();
  for (const value of [
    1,
    1.0000000000000002,
    '',
    new Uint8Array(),
    'a\0b',
    new Uint8Array([97, 0, 98]),
  ]) {
    editFixture(source, (db) => {
      db.prepare('UPDATE portal_auth_limits SET attempts=?').run(value);
    });
    const report = await inspectSitesSnapshot(source);
    const table = report.tables.find(
      (entry) => entry.name === 'portal_auth_limits',
    )!;
    digests.add(table.sha256);
    if (value !== 1) assert.equal(table.issues['storage-class-mismatch'], 1);
    assert.ok(!JSON.stringify(report).includes(secret));
  }
  assert.equal(digests.size, 6);
});

void test('JSON duplicate keys (including escaped keys) and invalid JSON are reported without parsing away evidence', async (t) => {
  const { source } = fixture(t);
  editFixture(source, (db) => portal(db, '{}'));
  for (const [payload, code] of [
    ['{"a":{"x":1,"x":2}}', 'duplicate-json-key'],
    ['{"a":1,"\\u0061":2}', 'duplicate-json-key'],
    ['{"x":' + secret, 'invalid-json'],
  ]) {
    editFixture(source, (db) => {
      db.prepare('UPDATE portal_state SET payload=?').run(payload);
    });
    const report = await inspectSitesSnapshot(source);
    assert.equal(
      report.tables.find((table) => table.name === 'portal_state')!.issues[
        code
      ],
      1,
    );
    assert.ok(!JSON.stringify(report).includes(secret));
  }
});

void test('invalid UTF-8 and NUL text are flagged and original bytes remain untouched', async (t) => {
  const { source } = fixture(t);
  editFixture(source, (db) => {
    db.exec(
      "INSERT INTO portal_login_stats VALUES(CAST(x'c328' AS TEXT),'2026-09-10T00:00:00.000Z',1)",
    );
    db.prepare('INSERT INTO portal_login_stats VALUES(?,?,?)').run(
      'a\0b',
      stamp,
      1,
    );
  });
  const before = hash(source);
  const report = await inspectSitesSnapshot(source);
  const issues = report.tables.find(
    (table) => table.name === 'portal_login_stats',
  )!.issues;
  assert.equal(issues['invalid-utf8'], 1);
  assert.equal(issues['postgres-text-nul'], 1);
  assert.equal(hash(source), before);
});

void test('legacy timestamps and file locations require review, never automatic rewriting', async (t) => {
  const { source } = fixture(t);
  editFixture(source, (db) => {
    db.prepare(
      'INSERT INTO company_file_objects VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run(
      'file-one',
      'legacy/path',
      secret,
      'company',
      '기타자료',
      'title',
      '',
      'owner',
      'private@example.invalid',
      'text/plain',
      1,
      '2026-02-30',
    );
    db.prepare('INSERT INTO consulting_flow_file_owners VALUES(?,?,?,?)').run(
      'flow-file',
      'case-one',
      'legacy/flow',
      stamp,
    );
    db.prepare('INSERT INTO portal_login_stats VALUES(?,?,?)').run(
      'member',
      '2026-02-30T00:00:00.000Z',
      1,
    );
  });
  const before = hash(source);
  const report = await inspectSitesSnapshot(source);
  assert.equal(
    report.tables.find((table) => table.name === 'company_file_objects')!
      .issues['noncanonical-company-storage-key'],
    1,
  );
  assert.equal(
    report.tables.find((table) => table.name === 'company_file_objects')!
      .issues['noncanonical-timestamp'],
    1,
  );
  assert.equal(
    report.tables.find((table) => table.name === 'consulting_flow_file_owners')!
      .issues['noncanonical-flow-storage-key'],
    1,
  );
  assert.equal(
    report.tables.find((table) => table.name === 'portal_login_stats')!.issues[
      'noncanonical-timestamp'
    ],
    1,
  );
  assert.equal(report.review.fileRootRows, 2);
  assert.equal(hash(source), before);
  assert.ok(!JSON.stringify(report).includes('private@example.invalid'));
});

void test('historical FLOW, passwords and old sessions remain counted but never become migration approval', async (t) => {
  const { source } = fixture(t);
  editFixture(source, (db) => {
    db.prepare('INSERT INTO consulting_flows VALUES(?,?,?,?,?)').run(
      'case',
      'member',
      27,
      '{"private":"' + secret + '"}',
      stamp,
    );
    db.prepare('INSERT INTO portal_password_accounts VALUES(?,?,?,?,?,?)').run(
      'member',
      'private@example.invalid',
      secret,
      'version',
      stamp,
      stamp,
    );
    db.prepare('INSERT INTO portal_password_sessions VALUES(?,?,?,?,?)').run(
      secret,
      'member',
      'private@example.invalid',
      'version',
      10,
    );
    db.prepare(
      'INSERT INTO portal_chatgpt_member_bindings VALUES(?,?,?,?)',
    ).run('member', secret, stamp, stamp);
  });
  const report = await inspectSitesSnapshot(source);
  assert.equal(report.review.historicalFlowRows, 1);
  assert.equal(report.review.passwordAccountRows, 1);
  assert.equal(report.review.inactiveAuthenticationRows, 2);
  assert.equal(report.migrationReady, false);
  assert.ok(!JSON.stringify(report).includes(secret));
});

void test('missing or unknown tables and extra columns cannot pass a complete snapshot comparison', async (t) => {
  const { source, restored } = fixture(t);
  copyFileSync(source, restored);
  const db = new DatabaseSync(restored);
  db.exec('DROP TABLE portal_chatgpt_member_bindings');
  db.exec('CREATE TABLE ' + quote(secret) + ' (data TEXT)');
  db.exec('ALTER TABLE portal_login_stats ADD COLUMN extra TEXT');
  db.close();
  const comparison = await compareSitesSnapshots(source, restored);
  assert.equal(comparison.comparable, false);
  assert.equal(comparison.sqliteLogicalMatch, false);
  assert.equal(comparison.right.dataSha256, null);
  assert.equal(comparison.right.issues['missing-source-tables'], 1);
  assert.equal(comparison.right.issues['unknown-source-tables'], 1);
  assert.equal(comparison.right.issues['unsupported-table-schema'], 1);
  assert.ok(!JSON.stringify(comparison).includes(secret));
});

void test('schema drift alone changes comparison and foreign-key orphans are reported', async (t) => {
  const { source, restored } = fixture(t);
  copyFileSync(source, restored);
  let db = new DatabaseSync(restored);
  db.exec('CREATE INDEX snapshot_extra ON portal_login_stats(login_count)');
  db.close();
  const result = await compareSitesSnapshots(source, restored);
  assert.equal(result.schemaMatches, false);
  assert.equal(result.sqliteLogicalMatch, false);
  assert.deepEqual(result.changedTables, []);
  db = new DatabaseSync(restored, { enableForeignKeyConstraints: false });
  db.exec('DROP INDEX snapshot_extra');
  db.prepare('INSERT INTO company_file_assignments VALUES(?,?)').run(
    'nonexistent',
    secret,
  );
  db.close();
  assert.equal(
    (await inspectSitesSnapshot(restored)).issues['foreign-key-violations'],
    1,
  );
});

void test('input SQL/JSON, missing files, WAL snapshots and sidecars fail without executing or creating files', async (t) => {
  const { source, directory } = fixture(t);
  const before = hash(source);
  const dump = join(directory, secret + '.sql');
  writeFileSync(dump, 'DROP TABLE portal_state; ' + secret);
  await assert.rejects(inspectSitesSnapshot(dump), {
    message: 'snapshot-not-sqlite',
  });
  const missing = join(directory, 'not-created.sqlite');
  await assert.rejects(inspectSitesSnapshot(missing), {
    message: 'snapshot-read-failed',
  });
  assert.ok(!readdirSync(directory).includes('not-created.sqlite'));
  const sidecar = source + '-journal';
  writeFileSync(sidecar, 'incomplete');
  await assert.rejects(inspectSitesSnapshot(source), {
    message: 'snapshot-sidecars-present',
  });
  assert.equal(hash(source), before);
  rmSync(sidecar);
  const db = new DatabaseSync(source);
  db.exec('PRAGMA journal_mode=WAL');
  db.close();
  await assert.rejects(inspectSitesSnapshot(source), {
    message: 'snapshot-wal-or-unsupported-format',
  });
});

void test('CLI has read-only commands, sanitized errors and distinct review/mismatch exit codes', (t) => {
  const { source, restored, directory } = fixture(t);
  copyFileSync(source, restored);
  const cli = (args: string[]) =>
    spawnSync(process.execPath, ['scripts/check-sites-snapshot.mjs', ...args], {
      encoding: 'utf8',
    });
  assert.equal(cli(['--help']).status, 0);
  assert.equal(cli(['inspect', source]).status, 0);
  assert.equal(cli(['compare', source, restored]).status, 0);
  editFixture(restored, (db) => portal(db, 'invalid-json'));
  assert.equal(cli(['inspect', restored]).status, 2);
  assert.equal(cli(['compare', source, restored]).status, 2);
  const missing = cli(['inspect', join(directory, secret)]);
  assert.equal(missing.status, 1);
  assert.ok(!(missing.stdout + missing.stderr).includes(secret));
  assert.equal(cli(['import', source]).status, 1);
  assert.equal(cli(['inspect', source, '--force']).status, 1);
});

void test('nullable empty values and missing rows cannot disappear from a restore comparison', async (t) => {
  const { source, restored } = fixture(t);
  editFixture(source, (db) => {
    db.prepare('INSERT INTO portal_password_links VALUES(?,?,?,?,?,?,?)').run(
      secret,
      'member',
      'private@example.invalid',
      1000,
      null,
      'admin',
      stamp,
    );
  });
  copyFileSync(source, restored);
  editFixture(restored, (db) => {
    db.prepare('UPDATE portal_password_links SET consumed_by=?').run('');
  });
  assert.deepEqual(
    (await compareSitesSnapshots(source, restored)).changedTables,
    ['portal_password_links'],
  );
  editFixture(restored, (db) => {
    db.exec('DELETE FROM portal_password_links');
  });
  assert.deepEqual(
    (await compareSitesSnapshots(source, restored)).changedTables,
    ['portal_password_links'],
  );
});

void test('unexpected CHECK expressions and views are never used as trusted validation or source rows', async (t) => {
  const { source } = fixture(t);
  let db = new DatabaseSync(source);
  db.function('private_function', (_value) => 1);
  db.exec(
    "CREATE TABLE unsafe(data TEXT CHECK(private_function(data)=1)); INSERT INTO unsafe VALUES('private')",
  );
  db.exec(
    "CREATE VIEW snapshot_view AS SELECT load_extension('private-extension')",
  );
  db.close();
  const before = hash(source);
  const result = await inspectSitesSnapshot(source);
  assert.equal(result.complete, false);
  assert.equal(result.issues['sqlite-integrity-check-skipped-schema-drift'], 1);
  assert.equal(hash(source), before);
  db = new DatabaseSync(source);
  db.exec(
    "DROP TABLE unsafe; DROP VIEW snapshot_view; DROP TABLE portal_login_stats; CREATE VIEW portal_login_stats AS SELECT load_extension('private-extension')",
  );
  db.close();
  const replaced = await inspectSitesSnapshot(source);
  assert.equal(replaced.complete, false);
  assert.equal(replaced.issues['missing-source-tables'], 1);
});

void test('row budget exhaustion fails closed rather than hashing an incomplete prefix', async (t) => {
  const { source } = fixture(t);
  editFixture(source, (db) => {
    db.exec(
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<100001) INSERT INTO portal_login_stats SELECT 'member-'||i,'2026-09-10T00:00:00.000Z',1 FROM n",
    );
  });
  await assert.rejects(inspectSitesSnapshot(source), {
    message: 'snapshot-row-budget-exceeded',
  });
});
