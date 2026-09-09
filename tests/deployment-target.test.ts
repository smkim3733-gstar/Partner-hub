import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  validateDeploymentTarget,
  deploymentArtifacts,
  assertDeploymentIsolation,
  DeploymentTargetError,
} from '../scripts/deployment-target.mjs';

const target = () => ({
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
});
const invalid = (error: unknown) =>
  error instanceof DeploymentTargetError &&
  /^DEPLOYMENT_TARGET_INVALID: [a-zA-Z0-9.]+$/.test(error.message);
void test('deployment target is explicit and normalized without reading secrets or provider credentials', () => {
  const input = target();
  assert.deepEqual(validateDeploymentTarget(input), input);
  const result = validateDeploymentTarget(input);
  input.cloudflare.workers.files = 'later-edit';
  assert.equal(result.cloudflare.workers.files, 'synthetic-files');
});
void test('blank target example cannot be used as a real deployment target', () => {
  const value = JSON.parse(
    readFileSync(
      new URL('../infra/standalone/target.example.json', import.meta.url),
      'utf8',
    ),
  );
  assert.throws(() => validateDeploymentTarget(value), invalid);
});
void test('Vercel upload exclusions explicitly cover local stores, exports and credentials', () => {
  const policy = new Set(
    readFileSync(new URL('../.vercelignore', import.meta.url), 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#')),
  );
  for (const pattern of [
    '.wrangler/',
    'work/',
    'outputs/',
    'private/',
    'backups/',
    'data/',
    'uploads/',
    '.env',
    '.env.*',
    '.dev.vars',
    '.dev.vars.*',
    '*.pem',
    '*.key',
    '*.sqlite',
    '*.db',
  ])
    assert.ok(
      policy.has(pattern),
      `Missing explicit upload exclusion: ${pattern}`,
    );
  assert.ok([...policy].every((pattern) => !pattern.startsWith('!')));
});
void test('unknown fields and embedded secrets fail without echoing their values', () => {
  for (const field of ['root', 'vercel', 'cloudflare', 'workers']) {
    const value = target();
    const object =
      field === 'root'
        ? value
        : field === 'vercel'
          ? value.vercel
          : field === 'cloudflare'
            ? value.cloudflare
            : value.cloudflare.workers;
    Object.assign(object, { secret: 'do-not-print-this-private-value' });
    assert.throws(() => validateDeploymentTarget(value), invalid);
  }
});
void test('account/resource IDs and names are mandatory; auto-provisioning placeholders are rejected', () => {
  for (const [field, value] of [
    ['accountId', ''],
    ['accountId', '0'.repeat(32)],
    ['accountId', 'not-an-account'],
    ['databaseId', ''],
    ['databaseId', '00000000-0000-0000-0000-000000000000'],
    ['databaseName', '../other'],
    ['bucketName', ''],
    ['bucketName', 'Uppercase'],
    ['workersSubdomain', 'other.workers.dev'],
  ]) {
    const input = target();
    Object.assign(input.cloudflare, { [field]: value });
    assert.throws(() => validateDeploymentTarget(input), invalid);
  }
  const input = target();
  input.cloudflare.workers.files = input.cloudflare.workers.d1;
  assert.throws(() => validateDeploymentTarget(input), invalid);
});
void test('app URL cannot redirect preparation to Sites, plain HTTP, paths, credentials or loopback', () => {
  for (const appOrigin of [
    'http://app.example.test',
    'https://127.0.0.1',
    'https://app.localhost',
    'https://app.test/',
    'https://app.test?secret=no',
    'https://user:password@app.test',
    'https://keve-partner-hub.smkim3733.chatgpt.site',
    'https://synthetic-d1.synthetic.workers.dev',
  ]) {
    const input = target();
    input.vercel.appOrigin = appOrigin;
    assert.throws(() => validateDeploymentTarget(input), invalid);
  }
});
void test('generated configs pin native resources, disable activation/extra routes/logging and omit all secrets', () => {
  const artifacts = deploymentArtifacts(target());
  assert.equal(artifacts.nextEnvironment.PARTNER_HUB_BACKEND_ENABLED, '0');
  assert.equal(
    artifacts.nextEnvironment.PARTNER_HUB_D1_ORIGIN,
    'https://synthetic-d1.synthetic.workers.dev',
  );
  assert.equal(
    artifacts.configs.d1.d1_databases?.[0].database_id,
    target().cloudflare.databaseId,
  );
  assert.equal(
    artifacts.configs.files.d1_databases?.[0].database_id,
    artifacts.configs.d1.d1_databases?.[0].database_id,
  );
  assert.equal(
    artifacts.configs.files.r2_buckets?.[0].bucket_name,
    artifacts.configs.r2.r2_buckets?.[0].bucket_name,
  );
  for (const config of Object.values(artifacts.configs)) {
    assert.equal(config.no_bundle, true);
    assert.equal(config.find_additional_modules, false);
    assert.equal(config.preview_urls, false);
    assert.equal(config.observability.enabled, false);
    assert.equal(config.secrets.required.length, 1);
    assert.ok(
      Object.entries(config.vars).some(
        ([key, value]) => key.endsWith('_ENABLED') && value === '0',
      ),
    );
    for (const field of [
      'routes',
      'route',
      'build',
      'assets',
      'env',
      'triggers',
    ])
      assert.equal(field in config, false);
    assert.ok(
      Object.keys(config.vars).every((key) => !key.endsWith('_SECRET')),
    );
  }
});
void test('preview and production comparison refuses shared data, worker names or app origin', () => {
  const preview = target();
  const production = target();
  production.environment = 'production';
  production.vercel.appOrigin = 'https://production.synthetic.invalid';
  production.cloudflare.databaseId = '87654321-4321-4321-4321-cba987654321';
  production.cloudflare.bucketName = 'synthetic-production';
  production.cloudflare.workers = {
    d1: 'prod-d1',
    r2: 'prod-r2',
    files: 'prod-files',
  };
  assert.doesNotThrow(() => assertDeploymentIsolation(preview, production));
  for (const field of ['databaseId', 'bucketName']) {
    const copied = structuredClone(production);
    Object.assign(copied.cloudflare, {
      [field]: Reflect.get(preview.cloudflare, field),
    });
    assert.throws(() => assertDeploymentIsolation(preview, copied), invalid);
  }
  production.cloudflare.workers.files = preview.cloudflare.workers.d1;
  assert.throws(() => assertDeploymentIsolation(preview, production), invalid);
  assert.throws(() => assertDeploymentIsolation(preview, preview), invalid);
});
void test('preparation CLI has no deploy/activation mode and safely rejects an incomplete template', () => {
  const script = fileURLToPath(
    new URL('../scripts/prepare-standalone-deployment.mjs', import.meta.url),
  );
  const example = fileURLToPath(
    new URL('../infra/standalone/target.example.json', import.meta.url),
  );
  for (const args of [
    [],
    ['--deploy'],
    ['--target', example, '--enable'],
    ['--target', example, '--check'],
    ['--target', example, '--compare-target'],
    ['--target', example, '--target', 'do-not-print-this-private-value'],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DEPLOYMENT_TARGET_INVALID/);
    assert.doesNotMatch(result.stderr, /do-not-print-this-private-value/);
  }
});
