import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { nextLocalStorageEnabled } from '../lib/next-local-storage-policy.mjs';

const environment = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PARTNER_HUB_LOCAL_STORAGE: '1',
  PARTNER_HUB_LOCAL_D1_HTTP: process.argv.includes('--d1-http') ? '1' : '0',
  PARTNER_HUB_LOCAL_R2_HTTP: process.argv.includes('--r2-http') ? '1' : '0',
  PARTNER_HUB_LOCAL_FILE_HTTP: process.argv.includes('--file-http') ? '1' : '0',
  PARTNER_HUB_LOCAL_APP_ORIGIN: 'http://127.0.0.1:3001',
};
if (!nextLocalStorageEnabled(environment))
  throw new Error(
    'This command is for local development only, never production or Vercel.',
  );
const require = createRequire(import.meta.url);
const child = spawn(
  process.execPath,
  [
    require.resolve('next/dist/bin/next'),
    'dev',
    '--hostname',
    '127.0.0.1',
    '--port',
    '3001',
  ],
  { env: environment, stdio: 'inherit', windowsHide: true },
);
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
