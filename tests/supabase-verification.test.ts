import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { writeFile, unlink, rmdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import {
  productionProjectRef,
  productionAppOrigin,
  verificationTarget,
  verificationSettings,
  assertVerificationBucket,
} from '../scripts/supabase-verification-policy.mjs';
import {
  verificationMigrations,
  prepareVerificationSchema,
  prepareVerificationBucket,
  readVerificationFile,
} from '../scripts/supabase-verification.mjs';
import { privateDirectory } from '../scripts/supabase-backup-runtime.mjs';

const projectRef = 'verificationtestabcd';
const target = {
  purpose: 'partner-hub-synthetic-verification',
  projectRef,
  appOrigin: 'https://127.0.0.1:3443',
  storageBucket: 'partner-hub-verification-private',
};
const environment = (ref = projectRef) => ({
  SUPABASE_URL: `https://${ref}.supabase.co`,
  SUPABASE_DATABASE_URL: `postgresql://postgres.${ref}:synthetic-only@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`,
  SUPABASE_SECRET_KEY: 'sb_secret_synthetic_verification_only',
});

void test('private configuration stops before connection when key replacement is pending', async () => {
  const directory = await privateDirectory(
    os.tmpdir(),
    'partner-hub-verification-',
  );
  const file = path.join(directory, 'config.json');
  try {
    await writeFile(
      file,
      JSON.stringify({
        target,
        environment: environment(),
        keyReplacementRequired: true,
      }),
      { flag: 'wx', mode: 0o600 },
    );
    await assert.rejects(
      readVerificationFile(file),
      /KEY_REPLACEMENT_REQUIRED/,
    );
    await assert.rejects(
      readVerificationFile('config.json'),
      /PRIVATE_FILE_REQUIRED/,
    );
  } finally {
    await unlink(file);
    await rmdir(directory);
  }
});

void test('verification rejects production targets, nonloopback origins and ordinary buckets', () => {
  for (const patch of [
    { projectRef: productionProjectRef },
    { appOrigin: productionAppOrigin },
    { appOrigin: 'http://127.0.0.1:3443' },
    { appOrigin: 'https://127.0.0.1.evil.invalid:3443' },
    { appOrigin: 'https://user:password@127.0.0.1:3443' },
    { appOrigin: 'https://127.0.0.1:443' },
    { appOrigin: 'https://127.0.0.1:3443/path' },
    { purpose: 'production' },
    { storageBucket: 'partner-hub-private' },
  ])
    assert.throws(
      () => verificationTarget({ ...target, ...patch }),
      /VERIFICATION_/,
    );
  assert.deepEqual(verificationTarget(target), target);
});

void test('verification rejects mismatched API/database projects before opening a connection', async () => {
  await assert.rejects(
    verificationSettings(target, environment(productionProjectRef)),
    /PROJECT_MISMATCH/,
  );
  await assert.rejects(
    verificationSettings(target, {
      ...environment(),
      SUPABASE_DATABASE_URL:
        environment(productionProjectRef).SUPABASE_DATABASE_URL,
    }),
    /CONNECTION_REJECTED/,
  );
  await assert.rejects(verificationSettings(target, {}), /CONNECTION_REJECTED/);
  const settings = await verificationSettings(target, {
    ...environment(),
    ANTHROPIC_API_KEY: 'must-not-propagate',
    VERCEL: '1',
  });
  assert.equal(settings.config.projectRef, projectRef);
  assert.equal(Object.hasOwn(settings.environment, 'ANTHROPIC_API_KEY'), false);
  assert.equal(Object.hasOwn(settings.environment, 'VERCEL'), false);
});

const bucket = {
  id: target.storageBucket,
  public: false,
  file_size_limit: 26214400,
  allowed_mime_types: ['application/octet-stream'],
};
void test('verification bucket refuses public, oversized and permissive existing buckets', async () => {
  for (const patch of [
    { public: true },
    { file_size_limit: null },
    { file_size_limit: 52428800 },
    { allowed_mime_types: null },
    { allowed_mime_types: ['*/*'] },
  ])
    assert.throws(
      () => assertVerificationBucket({ ...bucket, ...patch }, bucket.id),
      /BUCKET_POLICY/,
    );
  let requests = 0;
  const settings = await verificationSettings(target, environment());
  await assert.rejects(
    prepareVerificationBucket(settings.config, async () => {
      requests++;
      return Response.json([{ ...bucket, public: true }]);
    }),
    /BUCKET_POLICY/,
  );
  assert.equal(requests, 1, 'Never repairs an existing bucket automatically');
});

void test('verification creates an absent private bucket once and verifies provider policy', async () => {
  const settings = await verificationSettings(target, environment());
  const methods: string[] = [];
  const result = await prepareVerificationBucket(
    settings.config,
    async (_url, init = {}) => {
      methods.push(init.method ?? 'GET');
      assert.equal(init.redirect, 'error');
      if (methods.length === 1) return Response.json([]);
      if (methods.length === 2) {
        assert.equal(typeof init.body, 'string');
        const posted = JSON.parse(init.body as string);
        assertVerificationBucket(posted, bucket.id);
        return Response.json({ name: bucket.id });
      }
      return Response.json(bucket);
    },
  );
  assert.equal(result, 'prepared');
  assert.deepEqual(methods, ['GET', 'POST', 'GET']);
});

void test('bucket authentication failure and unknown create outcome are not retried', async () => {
  const settings = await verificationSettings(target, environment());
  let requests = 0;
  await assert.rejects(
    prepareVerificationBucket(settings.config, async () => {
      requests++;
      return new Response('', { status: 401 });
    }),
    /BUCKET_READ_FAILED/,
  );
  assert.equal(requests, 1);
  requests = 0;
  await assert.rejects(
    prepareVerificationBucket(settings.config, async () => {
      requests++;
      return requests === 1
        ? Response.json([])
        : new Response('', { status: 503 });
    }),
    /BUCKET_CREATE_OUTCOME_UNKNOWN/,
  );
  assert.equal(requests, 2);
});

void test('all 19 migrations prepare an empty database atomically; resume checks exact provenance', async () => {
  const engine = await PGlite.create();
  const migrations = await verificationMigrations();
  const connection = {
    begin: (action: (tx: unknown) => Promise<unknown>) =>
      engine.transaction(async (tx) =>
        action({
          unsafe: async (sql: string, parameters?: unknown[]) =>
            parameters
              ? (await tx.query(sql, parameters)).rows
              : (await tx.exec(sql)).at(-1)!.rows,
        }),
      ),
  };
  try {
    await engine.exec(
      'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;',
    );
    assert.equal(
      await prepareVerificationSchema(connection, target, migrations),
      'prepared',
    );
    assert.equal(
      await prepareVerificationSchema(connection, target, migrations),
      'already-prepared',
    );
    assert.equal(
      (
        await engine.query<{ n: number }>(
          'SELECT count(*)::integer AS n FROM partner_hub.schema_migrations',
        )
      ).rows[0].n,
      19,
    );
    await assert.rejects(
      prepareVerificationSchema(
        connection,
        { ...target, projectRef: 'differentprojectabcd' },
        migrations,
      ),
      /EXISTING_SCHEMA_REJECTED/,
    );
    await assert.rejects(
      prepareVerificationSchema(
        connection,
        target,
        migrations.map((m: { sha256: string }, i: number) =>
          i ? m : { ...m, sha256: '0'.repeat(64) },
        ),
      ),
      /EXISTING_SCHEMA_REJECTED/,
    );
  } finally {
    await engine.close();
  }
});

void test('migration failure rolls back schema and marker; preexisting unmarked schema is preserved', async () => {
  const engine = await PGlite.create();
  const connection = {
    begin: (action: (tx: unknown) => Promise<unknown>) =>
      engine.transaction(async (tx) =>
        action({
          unsafe: async (sql: string, parameters?: unknown[]) =>
            parameters
              ? (await tx.query(sql, parameters)).rows
              : (await tx.exec(sql)).at(-1)!.rows,
        }),
      ),
  };
  try {
    await engine.exec(
      'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;',
    );
    const migrations = await verificationMigrations();
    await assert.rejects(
      prepareVerificationSchema(connection, target, [
        migrations[0],
        { ...migrations[1], sql: 'SELECT missing_verification_function()' },
      ]),
    );
    assert.equal(
      (
        await engine.query<{ absent: boolean }>(
          "SELECT to_regnamespace('partner_hub') IS NULL AS absent",
        )
      ).rows[0].absent,
      true,
    );
    await engine.exec(
      'CREATE SCHEMA partner_hub; CREATE TABLE partner_hub.preserve_me(id integer); INSERT INTO partner_hub.preserve_me VALUES (42);',
    );
    await assert.rejects(
      prepareVerificationSchema(connection, target, migrations),
      /EXISTING_SCHEMA_REJECTED/,
    );
    assert.equal(
      (
        await engine.query<{ id: number }>(
          'SELECT id FROM partner_hub.preserve_me',
        )
      ).rows[0].id,
      42,
    );
  } finally {
    await engine.close();
  }
});
