import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createSupabaseStorageManifest } from '../lib/supabase-storage-manifest';
import { createSupabasePostgresDatabase } from '../lib/supabase-postgres-database';
import type { R2WireObject } from '../lib/r2-http-protocol';

const key = 'company-source/manifest-test';
function version() {
  const revision = randomUUID();
  const wire: R2WireObject = {
    key,
    version: revision,
    size: 5,
    etag: 'provider-etag',
    httpEtag: '"provider-etag"',
    uploaded: '2026-09-09T00:00:00.000Z',
    httpMetadata: { contentType: 'text/plain' },
    customMetadata: {},
    checksums: { sha256: 'a'.repeat(64) },
    storageClass: '',
  };
  return { revision, path: `partner-hub/objects/v1/${revision}`, wire };
}
function fixture() {
  const observed: { sql: string; parameters: readonly unknown[] }[] = [];
  let transactions = 0;
  let row: Record<string, unknown> | undefined;
  const executor = {
    async unsafe(sql: string, parameters: readonly unknown[] = []) {
      observed.push({ sql, parameters });
      if (sql.startsWith('SELECT'))
        return Object.assign(row ? [row] : [], { command: 'SELECT' });
      return Object.assign([], {
        command: sql.startsWith('INSERT') ? 'INSERT' : 'UPDATE',
        count: 1,
      });
    },
  };
  const db = createSupabasePostgresDatabase({
    ...executor,
    async begin(callback) {
      transactions++;
      return callback(executor);
    },
  });
  return {
    manifest: createSupabaseStorageManifest(db),
    observed,
    transactions: () => transactions,
    row(value: Record<string, unknown>) {
      row = value;
    },
  };
}

void test('Supabase manifest uses the real parameter adapter and one transaction for version + pointer', async () => {
  const f = fixture();
  const saved = version();
  assert.equal(await f.manifest.publish(key, saved, null), true);
  assert.equal(f.transactions(), 1);
  assert.equal(
    f.observed.length,
    5,
    'three transaction limits, immutable insert and CAS',
  );
  assert.deepEqual(f.observed[3].parameters, [
    key,
    saved.revision,
    saved.path,
    JSON.stringify(saved.wire),
  ]);
  assert.deepEqual(f.observed[4].parameters, [key, saved.revision, null]);
  assert.match(f.observed[4].sql, /\$3::text IS NULL OR EXISTS/);
  assert.match(f.observed[4].sql, /WHERE storage_object_heads.revision = \$3/);
  assert.doesNotMatch(f.observed[4].sql, /\?/);
  await f.manifest.publish(key, version(), undefined);
  assert.equal(f.observed.at(-1)!.parameters.length, 2);
  assert.doesNotMatch(f.observed.at(-1)!.sql, /WHERE/);
});

void test('Supabase manifest rejects damaged pointer, metadata version and checksum before exposing an object', async () => {
  const f = fixture();
  const saved = version();
  const row = {
    revision: saved.revision,
    version_revision: saved.revision,
    physical_path: saved.path,
    wire: JSON.stringify(saved.wire),
  };
  f.row(row);
  assert.deepEqual((await f.manifest.read(key))!.version, saved);
  for (const broken of [
    { ...row, version_revision: randomUUID() },
    { ...row, physical_path: 'partner-hub/staging/v1/' + saved.revision },
    { ...row, wire: '{private malformed metadata' },
    { ...row, wire: JSON.stringify({ ...saved.wire, version: randomUUID() }) },
    { ...row, wire: JSON.stringify({ ...saved.wire, checksums: {} }) },
  ]) {
    f.row(broken);
    await assert.rejects(f.manifest.read(key), {
      message: 'SUPABASE_STORAGE_FAILED_OR_OUTCOME_UNKNOWN',
    });
  }
  f.row({ ...row, version_revision: null, physical_path: null, wire: null });
  assert.deepEqual(await f.manifest.read(key), {
    revision: saved.revision,
    version: null,
  });
});
