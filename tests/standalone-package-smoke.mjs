// Verify the actual generated files, not an alternate in-memory build.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
  realpath,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createD1HttpDatabase } from '../lib/d1-http-client.ts';
import { createR2HttpBucket } from '../lib/r2-http-client.ts';
import { deploymentArtifacts } from '../scripts/deployment-target.mjs';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
const work = path.join(root, 'work');
await mkdir(work, { recursive: true });
assert.equal(path.relative(await realpath(root), await realpath(work)), 'work');
const fixture = await mkdtemp(path.join(work, 'deployment-test-'));
const targetPath = path.join(fixture, 'target.json');
const target = {
  version: 1,
  environment: 'preview',
  vercel: {
    projectId: 'prj_synthetic1234',
    orgId: 'team_synthetic1234',
    appOrigin: 'https://app.synthetic.invalid',
  },
  cloudflare: {
    accountId: 'a'.repeat(32),
    workersSubdomain: 'synthetic',
    databaseId: '12345678-1234-1234-1234-123456789abc',
    databaseName: 'synthetic-db',
    bucketName: 'synthetic-bucket',
    workers: {
      d1: 'synthetic-d1',
      r2: 'synthetic-r2',
      files: 'synthetic-files',
    },
  },
};
await writeFile(targetPath, JSON.stringify(target), { flag: 'wx' });
const env = {
  ...process.env,
  WRANGLER_SEND_METRICS: 'false',
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
  CLOUDFLARE_API_TOKEN: '',
  CLOUDFLARE_API_KEY: '',
  CLOUDFLARE_EMAIL: '',
  CLOUDFLARE_ACCOUNT_ID: '',
  ANTHROPIC_API_KEY: '',
};
const options = {
  cwd: root,
  env,
  windowsHide: true,
  timeout: 120_000,
  maxBuffer: 1024 * 1024,
};
const cli = path.join(root, 'scripts/prepare-standalone-deployment.mjs');
const before = await readdir(work);
const check = JSON.parse(
  (
    await run(
      process.execPath,
      [cli, '--target', targetPath, '--check'],
      options,
    )
  ).stdout,
);
assert.equal(check.writes, 0);
assert.equal(check.providerAccessVerified, false);
assert.deepEqual(await readdir(work), before);
const result = JSON.parse(
  (await run(process.execPath, [cli, '--target', targetPath], options)).stdout,
);
assert.equal(result.status, 'prepared-disabled');
assert.equal(result.deployments, 0);
const directory = result.directory;
assert.equal(path.dirname(directory), work);
assert.ok(path.basename(directory).startsWith('standalone-'));
const manifest = JSON.parse(
  await readFile(path.join(directory, 'manifest.json'), 'utf8'),
);
assert.equal(manifest.providerAccessVerified, false);
assert.equal(manifest.deployed, false);
assert.equal(
  manifest.files.filter((entry) => entry.path.startsWith('schema/original/'))
    .length,
  99,
);
assert.equal(
  manifest.files.filter((entry) => entry.path.startsWith('schema/standalone/'))
    .length,
  2,
);
for (const entry of manifest.files) {
  assert.ok(!entry.path.includes('..') && !path.isAbsolute(entry.path));
  const bytes = await readFile(path.join(directory, entry.path));
  assert.equal(bytes.length, entry.size);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  if (entry.path.startsWith('schema/')) {
    const original = entry.path.startsWith('schema/original/')
      ? path.join(root, 'drizzle', path.basename(entry.path))
      : path.join(
          root,
          'infra/standalone/migrations',
          path.basename(entry.path),
        );
    assert.deepEqual(bytes, await readFile(original));
  }
}
console.log(
  'PASS exact artifact SHA-256/size, 99 original SQL + standalone schema, no preparation writes in check-only mode.',
);
const configs = {};
const scripts = {};
for (const role of ['d1', 'r2', 'files']) {
  configs[role] = JSON.parse(
    await readFile(path.join(directory, role, 'wrangler.json'), 'utf8'),
  );
  assert.deepEqual(configs[role], deploymentArtifacts(target).configs[role]);
  scripts[role] = await readFile(
    path.join(directory, role, 'worker.mjs'),
    'utf8',
  );
  assert.doesNotMatch(
    scripts[role],
    /from ["'](?:@\/|next\/|server-only|wrangler|miniflare)/,
  );
  const dryRun = await run(
    process.execPath,
    [
      path.join(root, 'node_modules/wrangler/bin/wrangler.js'),
      'deploy',
      '--dry-run',
      '--no-autoconfig',
      '--config',
      path.join(directory, role, 'wrangler.json'),
      '--outdir',
      path.join(fixture, `dry-run-${role}`),
    ],
    {
      ...options,
      env: {
        ...env,
        WRANGLER_LOG_PATH: path.join(fixture, `wrangler-${role}.log`),
      },
    },
  );
  assert.match(dryRun.stdout, /dry-run.*exiting/i);
  console.log(
    `PASS Wrangler dry-run accepts exact ${role} package, with no upload.`,
  );
}
const wrangler = require.resolve('wrangler');
const { Miniflare, convertV4MiniflareOptions } = require(
  require.resolve('miniflare', { paths: [wrangler] }),
);
const { unstable_splitSqlQuery } = require('wrangler');
const secrets = Object.fromEntries(
  ['d1', 'r2', 'files'].map((role) => [role, randomBytes(32).toString('hex')]),
);
let outboundRequests = 0;
function workers(enabled) {
  return ['d1', 'r2', 'files'].map((role) => ({
    name: role,
    script: scripts[role],
    modules: true,
    compatibilityDate: configs[role].compatibility_date,
    compatibilityFlags: configs[role].compatibility_flags,
    bindings: {
      ...configs[role].vars,
      [role === 'd1'
        ? 'D1_BRIDGE_ENABLED'
        : role === 'r2'
          ? 'R2_BRIDGE_ENABLED'
          : 'FILE_TRANSFER_ENABLED']: enabled ? '1' : '0',
      [configs[role].secrets.required[0]]: secrets[role],
    },
    ...(configs[role].d1_databases
      ? { d1Databases: { DB: 'isolated-package-db' } }
      : {}),
    ...(configs[role].r2_buckets
      ? { r2Buckets: { AI_SOURCE_FILES: 'isolated-package-r2' } }
      : {}),
    outboundService: () => {
      outboundRequests++;
      throw new Error('External calls forbidden.');
    },
  }));
}
const mf = new Miniflare(
  convertV4MiniflareOptions({ workers: workers(false) }),
);
try {
  for (const role of ['d1', 'r2', 'files']) {
    const worker = await mf.getWorker(role);
    assert.equal(
      (await worker.fetch(`https://${role}.synthetic.invalid/`)).status,
      503,
    );
  }
  console.log(
    'PASS each packaged Worker fails closed in its generated disabled configuration.',
  );
  await mf.setOptions(convertV4MiniflareOptions({ workers: workers(true) }));
  const nativeDb = await mf.getD1Database('DB', 'd1');
  for (const entry of manifest.files.filter((entry) =>
    entry.path.startsWith('schema/'),
  )) {
    const sql = await readFile(path.join(directory, entry.path), 'utf8');
    await nativeDb.batch(
      unstable_splitSqlQuery(sql).map((statement) =>
        nativeDb.prepare(statement),
      ),
    );
  }
  const d1Worker = await mf.getWorker('d1');
  const db = createD1HttpDatabase({
    origin: 'https://d1.synthetic.invalid',
    secret: secrets.d1,
    fetcher: (input, init) => d1Worker.fetch(input, init),
  });
  assert.equal(
    await db
      .prepare('SELECT COUNT(*) AS n FROM standalone_admin_accounts')
      .first('n'),
    0,
  );
  await db.batch([
    db.prepare(
      'CREATE TABLE package_probe (id TEXT PRIMARY KEY, value INTEGER NOT NULL)',
    ),
    db
      .prepare('INSERT INTO package_probe (id,value) VALUES (?1,?2)')
      .bind('synthetic', 1),
  ]);
  await assert.rejects(
    db.batch([
      db.prepare('UPDATE package_probe SET value=2'),
      db
        .prepare('INSERT INTO package_probe (id,value) VALUES (?1,?2)')
        .bind('synthetic', 3),
    ]),
  );
  assert.equal(
    await db.prepare('SELECT value FROM package_probe').first('value'),
    1,
  );
  const r2Worker = await mf.getWorker('r2');
  const bucket = createR2HttpBucket({
    origin: 'https://r2.synthetic.invalid',
    secret: secrets.r2,
    fetcher: (input, init) => r2Worker.fetch(input, init),
  });
  const bytes = new TextEncoder().encode('합성 배포 패키지 원본');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const key = 'company-source/package-synthetic';
  await bucket.put(key, bytes, {
    sha256,
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: 'text/plain' },
  });
  assert.equal((await bucket.head(key)).checksums.toJSON().sha256, sha256);
  assert.deepEqual(
    new Uint8Array(await (await bucket.get(key)).arrayBuffer()),
    bytes,
  );
  await bucket.delete(key);
  assert.equal(await bucket.get(key), null);
  assert.equal(outboundRequests, 0);
  console.log(
    'PASS packaged schema + D1 atomic rollback + R2 SHA-256/bytes/conditional storage in native Workers.',
  );
} finally {
  await mf.dispose();
}
const fileChecks = await run(
  process.execPath,
  [
    '--import',
    './scripts/register-local.mjs',
    'tests/file-transfer-worker-smoke.mjs',
    '--worker-file',
    path.join(directory, 'files/worker.mjs'),
  ],
  { ...options, timeout: 240_000 },
);
assert.match(fileChecks.stdout, /"checksPassed":40/);
assert.match(fileChecks.stdout, /"outboundRequests":0/);
console.log(
  'PASS exact packaged file Worker: all 40 native permission, integrity and FLOW checks.',
);
console.log(
  JSON.stringify({
    status: 'verified-offline-package',
    directory,
    dryRuns: 3,
    fileWorkerChecks: 40,
    providerAccessVerified: false,
    deployed: false,
    liveDataWrites: 0,
  }),
);
