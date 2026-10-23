import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  recoveryConnection,
  recoveryRestoreArgs,
} from '../scripts/restore-supabase-verification.mjs';
import {
  recoveryProfile as target,
  assertRecoveryConfig,
  assertRecoveryEmpty,
  recoveryObjectPath,
  compareRecoveredObjects,
  assertRecoveryPayload,
  reconcileRecoveryWire,
} from '../scripts/supabase-recovery-policy.mjs';

const config = {
  projectRef: target.projectRef,
  supabaseUrl: `https://${target.projectRef}.supabase.co`,
  appOrigin: target.appOrigin,
  storageBucket: target.storageBucket,
  databaseUrl: `postgresql://postgres.${target.projectRef}:synthetic-only@${target.databaseHost}:6543/postgres`,
};
const binding = { ...target, purpose: 'partner-hub-synthetic-recovery' };

void test('recovery timestamp reconciliation requires unchanged identity and independently checked bytes', () => {
  const bytes = Buffer.from('synthetic restored file');
  const wire = {
    key: 'consulting-flow/example',
    version: 'test-revision',
    size: bytes.length,
    etag: 'same',
    httpEtag: '"same"',
    uploaded: '2026-10-14T00:00:00.000Z',
    checksums: { sha256: createHash('sha256').update(bytes).digest('hex') },
    customMetadata: { original: 'preserve' },
    httpMetadata: { contentType: 'text/plain' },
  };
  const row = {
    object_key: wire.key,
    revision: wire.version,
    physical_path: `partner-hub/objects/v1/${wire.version}`,
    wire: JSON.stringify(wire),
  };
  const actual = {
    path: row.physical_path,
    size: bytes.length,
    etag: wire.httpEtag,
    contentType: 'application/octet-stream',
    uploaded: '2026-10-15T00:00:00.000Z',
  };
  assert.deepEqual(JSON.parse(reconcileRecoveryWire(row, actual, bytes)), {
    ...wire,
    uploaded: actual.uploaded,
  });
  assert.equal(JSON.parse(row.wire).uploaded, wire.uploaded);
  assert.throws(
    () => reconcileRecoveryWire(row, actual, Buffer.alloc(bytes.length)),
    /RECONCILIATION_IDENTITY/,
  );
  for (const change of [
    { path: 'other' },
    { etag: '"new"' },
    { size: 0 },
    { uploaded: 'invalid' },
  ])
    assert.throws(
      () => reconcileRecoveryWire(row, { ...actual, ...change }, bytes),
      /RECONCILIATION_IDENTITY/,
    );
  assert.throws(
    () => reconcileRecoveryWire({ ...row, revision: 'other' }, actual, bytes),
    /RECONCILIATION_IDENTITY/,
  );
});

void test('remote restore connects only to the approved session endpoint with atomic non-destructive flags', () => {
  const connection = recoveryConnection(config, binding);
  assert.equal(new URL(connection.url).port, '5432');
  assert.equal(connection.env.PGUSER, `postgres.${target.projectRef}`);
  assert.equal(connection.env.PGHOST, target.databaseHost);
  assert.equal(connection.env.PGSSLMODE, 'require');
  assert.equal(connection.env.SUPABASE_SECRET_KEY, undefined);
  assert.deepEqual(recoveryRestoreArgs, [
    '--exit-on-error',
    '--single-transaction',
    '--no-password',
    '--dbname',
    'postgres',
  ]);
  assert.throws(() =>
    recoveryConnection(
      { ...config, projectRef: target.sourceProjectRef },
      binding,
    ),
  );
});

void test('recovery rejects production, source, mismatched endpoints and unbound destinations', () => {
  assert.doesNotThrow(() => assertRecoveryConfig(config, binding));
  for (const ref of [
    'yievsveuxjnbygatvjtb',
    target.sourceProjectRef,
    'a'.repeat(20),
  ]) {
    assert.throws(() =>
      assertRecoveryConfig({ ...config, projectRef: ref }, binding),
    );
    assert.throws(() =>
      assertRecoveryConfig(
        {
          ...config,
          databaseUrl: config.databaseUrl.replace(target.projectRef, ref),
        },
        binding,
      ),
    );
    assert.throws(() =>
      assertRecoveryConfig(
        { ...config, supabaseUrl: `https://${ref}.supabase.co` },
        binding,
      ),
    );
  }
  for (const databaseUrl of [
    config.databaseUrl + '?host=other.invalid',
    config.databaseUrl.replace(':6543/', ':5432/'),
    config.databaseUrl.replace(target.databaseHost, 'other.invalid'),
  ])
    assert.throws(() =>
      assertRecoveryConfig({ ...config, databaseUrl }, binding),
    );
  assert.throws(() =>
    assertRecoveryConfig(config, { ...binding, archiveSha256: '0'.repeat(64) }),
  );
  assert.throws(
    () => assertRecoveryPayload({}, '0'.repeat(64)),
    /ARCHIVE_IDENTITY/,
  );
});

void test('existing schema, public data, auth users or storage stop all recovery writes', () => {
  const empty = {
    schemaPresent: false,
    publicTables: 0,
    authUsers: 0,
    storageBuckets: 0,
    storageObjects: 0,
  };
  assert.doesNotThrow(() => assertRecoveryEmpty(empty));
  for (const field of Object.keys(empty)) {
    assert.throws(
      () =>
        assertRecoveryEmpty({
          ...empty,
          [field]: field === 'schemaPresent' ? true : 1,
        }),
      /NOT_EMPTY/,
    );
    assert.throws(
      () => assertRecoveryEmpty({ ...empty, [field]: undefined }),
      /NOT_EMPTY/,
    );
  }
});

void test('recovery paths cannot traverse or escape the synthetic bucket prefix', () => {
  assert.equal(
    recoveryObjectPath('partner-hub/objects/v1/example'),
    'partner-hub/objects/v1/example',
  );
  for (const path of [
    '../object',
    'partner-hub/../private',
    'partner-hub//object',
    'partner-hub/%2e%2e/object',
    'partner-hub/a?x=1',
    'partner-hub\\object',
    'other/object',
  ])
    assert.throws(() => recoveryObjectPath(path), /OBJECT_PATH/);
});

void test('restored storage allows new provider IDs but rejects missing or different bytes', () => {
  const original = {
    totalBytes: 3,
    objects: [
      { path: 'partner-hub/a', size: 3, sha256: 'a'.repeat(64), id: 'old' },
    ],
  };
  const restored = {
    ...original,
    objects: [{ ...original.objects[0], id: 'new' }],
  };
  assert.doesNotThrow(() => compareRecoveredObjects(original, restored));
  assert.throws(() =>
    compareRecoveredObjects(original, { ...restored, objects: [] }),
  );
  assert.throws(() =>
    compareRecoveredObjects(original, {
      ...restored,
      objects: [{ ...restored.objects[0], sha256: 'b'.repeat(64) }],
    }),
  );
  assert.throws(() =>
    compareRecoveredObjects(original, { ...restored, totalBytes: 4 }),
  );
});
