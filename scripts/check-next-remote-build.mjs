// Build + verify the explicit remote candidate with synthetic secrets only.
// Never deploy, read operator dotenv files or contact an external backend.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const vercelStorage = process.argv.includes('--vercel');
for (const file of [
  '.env',
  '.env.local',
  '.env.production',
  '.env.production.local',
]) {
  const exists = await access(file).then(
    () => true,
    (error) => {
      if (error.code !== 'ENOENT') throw error;
      return false;
    },
  );
  assert.equal(exists, false, `Refusing to load operator environment: ${file}`);
}
const env = {
  ...process.env,
  NODE_ENV: 'production',
  NEXT_TELEMETRY_DISABLED: '1',
  PARTNER_HUB_NEXT_BACKEND: 'cloudflare-http-v1',
  PARTNER_HUB_BACKEND_ENABLED: '0',
  PARTNER_HUB_LOCAL_STORAGE: '0',
  PARTNER_HUB_LOCAL_D1_HTTP: '0',
  PARTNER_HUB_LOCAL_R2_HTTP: '0',
  PARTNER_HUB_LOCAL_FILE_HTTP: '0',
  PARTNER_HUB_APP_ORIGIN: 'https://app.synthetic.invalid',
  PARTNER_HUB_D1_ORIGIN: 'https://d1.synthetic.invalid',
  PARTNER_HUB_R2_ORIGIN: 'https://r2.synthetic.invalid',
  PARTNER_HUB_FILE_ORIGIN: 'https://files.synthetic.invalid',
  PARTNER_HUB_D1_SECRET: randomBytes(32).toString('hex'),
  PARTNER_HUB_R2_SECRET: randomBytes(32).toString('hex'),
  PARTNER_HUB_FILE_SECRET: randomBytes(32).toString('hex'),
  ANTHROPIC_API_KEY: '',
  ANTHROPIC_EXTERNAL_PROCESSING_ENABLED: 'false',
};
if (vercelStorage) {
  env.PARTNER_HUB_NEXT_BACKEND = 'vercel-storage-v1';
  env.TURSO_DATABASE_URL = 'libsql://synthetic.turso.io';
  env.TURSO_AUTH_TOKEN = randomBytes(32).toString('hex');
  env.BLOB_READ_WRITE_TOKEN = `vercel_blob_rw_synthetic_${randomBytes(32).toString('hex')}`;
  for (const key of [
    'PARTNER_HUB_D1_ORIGIN',
    'PARTNER_HUB_R2_ORIGIN',
    'PARTNER_HUB_FILE_ORIGIN',
    'PARTNER_HUB_D1_SECRET',
    'PARTNER_HUB_R2_SECRET',
    'PARTNER_HUB_FILE_SECRET',
  ])
    delete env[key];
}
for (const args of [
  [require.resolve('next/dist/bin/next'), 'build'],
  [
    'scripts/check-next-foundation.mjs',
    vercelStorage ? '--vercel' : '--remote',
  ],
]) {
  const child = spawn(process.execPath, args, {
    env,
    windowsHide: true,
    stdio: 'inherit',
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  assert.equal(code, 0, 'Remote production verification failed.');
}
