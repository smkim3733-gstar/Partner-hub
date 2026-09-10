import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient } from '@libsql/client';
import { createTursoDatabase } from '../lib/turso-database';
import {
  createVercelBlobBucket,
  vercelObjectPath,
} from '../lib/vercel-blob-bucket';
import { readVercelStorageConfig } from '../lib/vercel-storage-config';
import { vercelStorageSelected } from '../lib/vercel-storage-policy.mjs';
import {
  applyVercelMigrations,
  checkVercelMigrations,
  vercelMigrations,
} from '../scripts/vercel-migrations.mjs';
import { blobFixture } from './blob-sdk-fixture';
import { guardTursoSchema } from '../lib/vercel-schema-guard';

void test('native runtime refuses missing, partial or mismatched schema before any application write', async () => {
  const client = createClient({ url: 'file::memory:' });
  try {
    const guarded = guardTursoSchema(client);
    await assert.rejects(
      guarded.batch(['CREATE TABLE forbidden(id INTEGER)'], 'write'),
      /VERCEL_SCHEMA_NOT_READY/,
    );
    assert.equal(
      (
        await client.execute(
          "SELECT name FROM sqlite_master WHERE name='forbidden'",
        )
      ).rows.length,
      0,
    );
    await applyVercelMigrations(client);
    assert.equal(
      (await guarded.batch(['SELECT 1 AS ready'], 'write'))[0].rows[0].ready,
      1,
    );
    await client.execute(
      "UPDATE _partner_hub_migrations SET sha256='changed' WHERE sequence=0",
    );
    await assert.rejects(
      guardTursoSchema(client).batch(['SELECT 1'], 'write'),
      /VERCEL_SCHEMA_NOT_READY/,
    );
  } finally {
    client.close();
  }
});

void test('Legacy Turso/Blob storage requires explicit selection; credentials and target fail closed', () => {
  assert.equal(vercelStorageSelected({ VERCEL: '1' }), false);
  assert.equal(
    vercelStorageSelected({
      VERCEL: '1',
      PARTNER_HUB_NEXT_BACKEND: 'disabled',
    }),
    false,
  );
  const env = {
    PARTNER_HUB_NEXT_BACKEND: 'vercel-storage-v1',
    PARTNER_HUB_BACKEND_ENABLED: '1',
    PARTNER_HUB_APP_ORIGIN: 'https://app.example.test',
    TURSO_DATABASE_URL: 'libsql://synthetic.turso.io',
    TURSO_AUTH_TOKEN: 'synthetic-auth-token',
    BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_synthetic_secret',
  };
  assert.equal(
    readVercelStorageConfig(env).databaseUrl,
    env.TURSO_DATABASE_URL,
  );
  for (const key of [
    'TURSO_DATABASE_URL',
    'TURSO_AUTH_TOKEN',
    'BLOB_READ_WRITE_TOKEN',
    'PARTNER_HUB_APP_ORIGIN',
  ])
    assert.throws(() => readVercelStorageConfig({ ...env, [key]: '' }));
  for (const url of [
    'file:private.db',
    'http://127.0.0.1',
    'libsql://evil.test',
    'https://synthetic.turso.io.evil.test',
    'libsql://user:pass@synthetic.turso.io',
    'libsql://synthetic.turso.io/?auth=secret',
  ])
    assert.throws(() =>
      readVercelStorageConfig({ ...env, TURSO_DATABASE_URL: url }),
    );
  assert.throws(() =>
    readVercelStorageConfig({ ...env, PARTNER_HUB_LOCAL_STORAGE: '1' }),
  );
  assert.throws(() =>
    readVercelStorageConfig({ ...env, PARTNER_HUB_BACKEND_ENABLED: '0' }),
  );
});

void test('real libSQL SDK: numbered bindings, plain rows, atomic batches and trigger rollback', async () => {
  const client = createClient({ url: 'file::memory:' });
  const db = createTursoDatabase(client);
  try {
    await client.executeMultiple(
      "CREATE TABLE test(id INTEGER PRIMARY KEY, value TEXT); CREATE TRIGGER guard BEFORE UPDATE ON test BEGIN SELECT RAISE(ABORT, 'immutable'); END;",
    );
    const results = await db.batch([
      db.prepare('INSERT INTO test VALUES(?1,?2)').bind(1, '한국'),
      db.prepare('SELECT ?1 AS repeated, ?1 AS same, value FROM test').bind(3),
    ]);
    assert.equal(results[0].meta.changes, 1);
    assert.deepEqual(results[1].results, [
      { repeated: 3, same: 3, value: '한국' },
    ]);
    await assert.rejects(
      db.batch([
        db.prepare("INSERT INTO test VALUES(2,'rollback')"),
        db.prepare("UPDATE test SET value = 'bad' WHERE id = 1"),
      ]),
    );
    assert.equal(
      await db.prepare('SELECT COUNT(*) AS count FROM test').first('count'),
      1,
    );
    assert.equal(
      await db.prepare('SELECT * FROM test WHERE id = 9').first(),
      null,
    );
    assert.throws(() =>
      db.batch([createTursoDatabase(client).prepare('SELECT 1')]),
    );
    assert.throws(() => db.exec('SELECT 1'));
  } finally {
    client.close();
  }
});

void test('all 102 migrations apply through actual libSQL; history is idempotent, hashed, atomic and refuses unmanaged DB', async () => {
  const client = createClient({ url: 'file::memory:' });
  try {
    const migrations = await vercelMigrations();
    assert.equal(migrations.length, 102);
    assert.deepEqual(await applyVercelMigrations(client, migrations), {
      applied: 102,
      total: 102,
      remaining: 0,
    });
    assert.equal(
      (await applyVercelMigrations(client, migrations)).remaining,
      0,
    );
    assert.ok(
      Number(
        (
          await client.execute(
            "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger'",
          )
        ).rows[0].n,
      ) > 100,
    );
    assert.equal(
      (await client.execute('PRAGMA foreign_key_check')).rows.length,
      0,
    );
    assert.deepEqual((await client.execute('PRAGMA quick_check')).rows, [
      { quick_check: 'ok' },
    ]);
    await assert.rejects(
      checkVercelMigrations(client, [
        { ...migrations[0], sha256: 'bad' },
        ...migrations.slice(1),
      ]),
    );
    const invalid = [
      ...migrations,
      {
        path: 'synthetic-invalid.sql',
        sha256: 'invalid',
        sql: 'CREATE TABLE rolled_back(id INTEGER); SELECT nonexistent FROM missing;',
      },
    ];
    await assert.rejects(applyVercelMigrations(client, invalid));
    assert.equal(
      (
        await client.execute(
          "SELECT name FROM sqlite_master WHERE name='rolled_back'",
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (await checkVercelMigrations(client, migrations)).remaining,
      0,
    );
  } finally {
    client.close();
  }
  const unmanaged = createClient({ url: 'file::memory:' });
  try {
    await unmanaged.execute('CREATE TABLE existing(id INTEGER)');
    await assert.rejects(applyVercelMigrations(unmanaged));
  } finally {
    unmanaged.close();
  }
});

void test('private Blob atomic envelope preserves metadata, SHA and provider ETag; CAS and deletes are scoped', async () => {
  const fixture = blobFixture(),
    bucket = createVercelBlobBucket('synthetic', fixture.sdk);
  const key = 'company-source/synthetic-file';
  const bytes = new TextEncoder().encode('한글 synthetic original');
  const saved = await bucket.put(key, bytes, {
    onlyIf: { etagDoesNotMatch: '*' },
    customMetadata: { owner: 'synthetic' },
    httpMetadata: { contentType: 'text/plain' },
  });
  assert.ok(saved);
  assert.equal(saved.size, bytes.length);
  assert.equal(saved.httpMetadata?.contentType, 'text/plain');
  assert.deepEqual(saved.customMetadata, { owner: 'synthetic' });
  assert.equal((await bucket.head(key))!.etag, saved.etag);
  assert.equal(
    await bucket.put(key, bytes, { onlyIf: { etagDoesNotMatch: '*' } }),
    null,
  );
  assert.equal(
    await bucket.put(key, bytes, { onlyIf: { etagMatches: 'stale' } }),
    null,
  );
  const loaded = await bucket.get(key);
  assert.ok(loaded);
  assert.deepEqual(new Uint8Array(await loaded.arrayBuffer()), bytes);
  assert.equal(
    loaded.checksums.toJSON().sha256,
    saved.checksums.toJSON().sha256,
  );
  fixture.objects.get(vercelObjectPath(key))![8192] ^= 1;
  const corrupted = await bucket.get(key);
  assert.ok(corrupted);
  await assert.rejects(corrupted.arrayBuffer());
  await assert.rejects(bucket.put(key, bytes, { sha256: '0'.repeat(64) }));
  await assert.rejects(bucket.get('https://evil.test/private'));
  await bucket.delete(key);
  assert.equal(await bucket.head(key), null);
});

void test('Blob untyped errors never become not-found or false preconditions, writes are attempted once', async () => {
  const fixture = blobFixture();
  let writes = 0;
  fixture.sdk.put = async () => {
    writes++;
    throw new Error('provider secret must not escape');
  };
  const bucket = createVercelBlobBucket('synthetic', fixture.sdk);
  await assert.rejects(
    bucket.put('company-source/unknown', 'bytes'),
    /^Error: VERCEL_BLOB_FAILED_OR_OUTCOME_UNKNOWN$/,
  );
  assert.equal(writes, 1);
  assert.equal(process.env.VERCEL_BLOB_RETRIES, '0');
  fixture.sdk.get = async () => {
    throw new Error('network unavailable');
  };
  await assert.rejects(bucket.head('company-source/missing'));
});
