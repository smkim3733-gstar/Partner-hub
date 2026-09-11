import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import os from 'node:os';
import {
  captureProcess,
  processEnvironment,
  sourceConnection,
  assertSeparateRoots,
  isWithin,
  defaultBackupRoots,
} from '../scripts/supabase-backup-runtime.mjs';

void test(
  'Windows default backup roots ignore disposable application package caches',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    const previous = process.env.LOCALAPPDATA;
    const profile = os.homedir();
    const appData = path.join(profile, 'AppData');
    const packageCache = path.join(
      appData,
      'Local',
      'Packages',
      'Synthetic.App_123',
      'LocalCache',
      'Local',
    );
    try {
      process.env.LOCALAPPDATA = packageCache;
      const roots = defaultBackupRoots();
      assert.deepEqual(roots, {
        backupRoot: path.join(profile, 'PartnerHubBackups'),
        keyRoot: path.join(profile, 'PartnerHubRecoveryKeys'),
      });
      assert.equal(isWithin(packageCache, roots.backupRoot), false);
      assert.equal(isWithin(packageCache, roots.keyRoot), false);
      assert.equal(isWithin(appData, roots.backupRoot), false);
      assert.equal(isWithin(appData, roots.keyRoot), false);
      assert.doesNotThrow(() =>
        assertSeparateRoots(roots.backupRoot, roots.keyRoot),
      );
      delete process.env.LOCALAPPDATA;
      assert.deepEqual(defaultBackupRoots(), roots);
    } finally {
      if (previous === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = previous;
    }
  },
);

void test('backup source changes only to the documented session pooler and forces read-only', () => {
  const synthetic = 'synthetic password';
  const source = sourceConnection({
    databaseUrl: `postgresql://postgres.abcdefghijklmnopqrst:${encodeURIComponent(synthetic)}@aws-0-test.pooler.supabase.com:6543/postgres`,
  });
  assert.equal(new URL(source.url).port, '5432');
  assert.equal(source.env.PGPASSWORD, synthetic);
  assert.equal(source.env.PGSSLMODE, 'require');
  assert.match(source.env.PGOPTIONS, /default_transaction_read_only=on/);
  assert.throws(
    () =>
      sourceConnection({
        databaseUrl:
          'postgresql://user:synthetic@unrelated.invalid:6543/postgres',
      }),
    /backup-source-invalid/,
  );
});

void test('subprocess environment omits operator keys and inherited PG destinations', () => {
  const previous = process.env.SUPABASE_SECRET_KEY;
  const oldHost = process.env.PGHOST;
  try {
    process.env.SUPABASE_SECRET_KEY = 'synthetic-not-a-secret';
    process.env.PGHOST = 'production.invalid';
    const env = processEnvironment({ PGHOST: '127.0.0.1' });
    assert.equal(env.SUPABASE_SECRET_KEY, undefined);
    assert.equal(env.PGHOST, '127.0.0.1');
    assert.equal(env.SUPABASE_DATABASE_URL, undefined);
  } finally {
    if (previous === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previous;
    if (oldHost === undefined) delete process.env.PGHOST;
    else process.env.PGHOST = oldHost;
  }
});

void test('recovery keys must be outside the backup tree and prefix siblings remain distinct', () => {
  const root = path.join(os.tmpdir(), 'ph-backup-runtime');
  assert.throws(() => assertSeparateRoots(root, root), /not-separated/);
  assert.throws(
    () => assertSeparateRoots(root, path.join(root, 'keys')),
    /not-separated/,
  );
  assert.throws(
    () => assertSeparateRoots(path.join(root, 'archive'), root),
    /not-separated/,
  );
  assert.doesNotThrow(() => assertSeparateRoots(root, root + '-keys'));
  assert.equal(isWithin(root, root + '-other'), false);
});

void test('subprocess failures redact diagnostic output and successful binary bytes are exact', async () => {
  const body = Buffer.from([0, 1, 127, 128, 255]);
  assert.deepEqual(
    await captureProcess(
      process.execPath,
      ['-e', 'process.stdin.pipe(process.stdout)'],
      { input: body },
    ),
    body,
  );
  await assert.rejects(
    captureProcess(process.execPath, [
      '-e',
      'process.stderr.write("synthetic-private-row"); process.exit(2)',
    ]),
    (error: Error) =>
      error.message === 'backup-process-failed' &&
      !String(error.stack).includes('synthetic-private-row'),
  );
});

void test('subprocess output and execution have hard limits', async () => {
  await assert.rejects(
    captureProcess(
      process.execPath,
      ['-e', 'process.stdout.write("x".repeat(1024))'],
      { limit: 16 },
    ),
    /backup-process-output-limit/,
  );
  await assert.rejects(
    captureProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      timeout: 100,
    }),
    /backup-process-timeout/,
  );
});

void test('background server control can close without inheritable output pipes', async () => {
  assert.deepEqual(
    await captureProcess(
      process.execPath,
      ['-e', 'process.stdout.write("synthetic-control-output")'],
      { quiet: true },
    ),
    Buffer.alloc(0),
  );
  await assert.rejects(
    captureProcess(process.execPath, ['-e', 'process.exit(0)'], {
      quiet: true,
      input: Buffer.from('synthetic-dump'),
    }),
    /backup-quiet-process-input-invalid/,
  );
});
