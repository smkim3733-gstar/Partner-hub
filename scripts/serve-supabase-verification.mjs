import './register-local.mjs';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readVerificationFile } from './supabase-verification.mjs';
import { verificationError } from './supabase-verification-policy.mjs';
import { processEnvironment } from './supabase-backup-runtime.mjs';
import { ownedNextProcess } from '../tests/owned-next-process.mjs';

// A bounded browser preview of the already verified synthetic environment.
// No provisioning, account changes, credential output, or deployment.
async function main(args) {
  if (args.length !== 2 || args[0] !== '--config')
    throw verificationError('ARGUMENTS');
  for (const file of [
    '.env',
    '.env.local',
    '.env.development',
    '.env.development.local',
  ]) {
    try {
      await access(file);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    throw verificationError('WORKSPACE_ENV_PRESENT');
  }
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0')
    throw verificationError('TLS_DISABLED');
  const settings = await readVerificationFile(args[1]);
  const status = JSON.parse(
    await readFile(path.join(settings.directory, 'status.json'), 'utf8'),
  );
  if (status.status !== 'passed' || status.httpWorkflowVerified !== true)
    throw verificationError('HTTP_WORKFLOW_REQUIRED');
  const cert = path.join(settings.directory, 'localhost-cert.pem');
  const key = path.join(settings.directory, 'localhost-key.pem');
  await Promise.all([access(cert), access(key)]);
  const port = Number(new URL(settings.target.appOrigin).port);
  const server = ownedNextProcess(
    [
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(port),
      '--experimental-https',
      '--experimental-https-key',
      key,
      '--experimental-https-cert',
      cert,
      '--experimental-https-ca',
      cert,
    ],
    processEnvironment({
      ...settings.environment,
      NODE_ENV: 'development',
      NEXT_TELEMETRY_DISABLED: '1',
      NODE_EXTRA_CA_CERTS: cert,
      ANTHROPIC_EXTERNAL_PROCESSING_ENABLED: 'false',
    }),
    port,
  );
  let timer;
  try {
    await server.ready();
    console.log(
      JSON.stringify({
        preview: 'ready',
        origin: settings.target.appOrigin,
        syntheticOnly: true,
        expiresInMinutes: 30,
        stopInstruction: 'Send stop followed by a newline or Ctrl+C.',
      }),
    );
    await new Promise((resolve) => {
      const finish = () => resolve();
      timer = setTimeout(finish, 30 * 60 * 1000);
      process.once('SIGINT', finish);
      process.once('SIGTERM', finish);
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        if (chunk.trim() === 'stop') finish();
      });
      process.stdin.resume();
    });
  } finally {
    clearTimeout(timer);
    process.stdin.pause();
    await server.stop();
  }
  console.log(JSON.stringify({ preview: 'stopped' }));
}

main(process.argv.slice(2)).catch((error) => {
  console.error(
    `Preview stopped: ${error.verificationCode ?? 'OPERATION_FAILED'}`,
  );
  process.exitCode = 1;
});
