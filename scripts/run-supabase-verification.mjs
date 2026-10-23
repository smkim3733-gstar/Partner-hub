import './register-local.mjs';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, access, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import postgres from 'postgres';
import {
  readVerificationFile,
  verificationMigrations,
  prepareVerificationSchema,
  prepareVerificationBucket,
} from './supabase-verification.mjs';
import { verificationError } from './supabase-verification-policy.mjs';
import {
  processEnvironment,
  captureProcess,
} from './supabase-backup-runtime.mjs';
import { ownedNextProcess } from '../tests/owned-next-process.mjs';
import { verifyLiveWorkflow } from './supabase-verification-flow.mjs';

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function main(args) {
  if (args.length === 0 || args[0] === '--help') {
    console.log(
      'Run real isolated Supabase HTTP workflow: --config <absolute private JSON> [--retry-after-review].\nRequires a prepared verification project. All data are synthetic. No deployment, external messages, paid AI or browser/mobile completion claim.',
    );
    return;
  }
  if (
    args[0] !== '--config' ||
    ![2, 3].includes(args.length) ||
    (args[2] && args[2] !== '--retry-after-review')
  )
    throw verificationError('ARGUMENTS');
  for (const file of [
    '.env',
    '.env.local',
    '.env.development',
    '.env.development.local',
  ]) {
    if (await exists(file)) throw verificationError('WORKSPACE_ENV_PRESENT');
  }
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0')
    throw verificationError('TLS_DISABLED');
  const settings = await readVerificationFile(args[1]);
  const directory = settings.directory;
  const statusFile = path.join(directory, 'status.json');
  if (await exists(statusFile)) {
    const previous = JSON.parse(await readFile(statusFile, 'utf8'));
    if (previous.status !== 'failed' || args[2] !== '--retry-after-review')
      throw verificationError('PREVIOUS_RUN_REVIEW_REQUIRED');
  }
  const lockPath = path.join(directory, 'run.lock');
  const lock = await open(lockPath, 'wx');
  let raw,
    server,
    journal,
    phase = 'prepare';
  const originalTrust = getCACertificates('default');
  const runId = randomUUID();
  const saveStatus = (value) =>
    writeFile(
      statusFile,
      JSON.stringify({ runId, at: new Date().toISOString(), ...value }) + '\n',
      { mode: 0o600 },
    );
  try {
    await saveStatus({ status: 'running', phase });
    journal = await open(
      path.join(directory, `run-${runId}.jsonl`),
      'wx',
      0o600,
    );
    const record = async (event) => {
      await journal.writeFile(
        JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n',
      );
      await journal.sync();
      console.log(JSON.stringify(event));
    };
    const { createSupabaseDatabaseClient } =
      await import('../lib/supabase-postgres-client.ts');
    const { provisionStandaloneAdmin } =
      await import('../lib/standalone-admin-store.ts');
    const { PORTAL_OWNER_EMAIL } = await import('../lib/member-email.ts');
    const { verifyPassword } = await import('../lib/password-crypto.ts');
    const { portalStateId } = await import('../db/schema.ts');
    const { emptyPortalStateBaseline } =
      await import('../lib/pilot-readiness.ts');
    const db = createSupabaseDatabaseClient(
      settings.config.databaseUrl,
      (url, options) => (raw = postgres(url, options)),
    );
    // A runner cannot initialize an unmarked database. Preparation is separate.
    const marker = await raw.unsafe(
      "SELECT to_regclass('partner_hub.verification_environment') IS NOT NULL AS present",
    );
    if (!marker[0].present) throw verificationError('PREPARATION_REQUIRED');
    await prepareVerificationSchema(
      raw,
      settings.target,
      await verificationMigrations(),
    );
    await prepareVerificationBucket(settings.config);

    phase = 'bootstrap';
    const credentialsFile = path.join(directory, 'accounts.json');
    let credentials;
    const currentAdmin = await db
      .prepare(
        'SELECT email,password_hash FROM standalone_admin_accounts WHERE id = ?1',
      )
      .bind('primary-admin')
      .first();
    if (await exists(credentialsFile)) {
      credentials = JSON.parse(await readFile(credentialsFile, 'utf8'));
      if (
        credentials.projectRef !== settings.target.projectRef ||
        credentials.adminEmail !== PORTAL_OWNER_EMAIL
      )
        throw verificationError('ACCOUNT_TARGET_MISMATCH');
    } else {
      if (currentAdmin) throw verificationError('EXISTING_ADMIN_REJECTED');
      credentials = {
        projectRef: settings.target.projectRef,
        adminEmail: PORTAL_OWNER_EMAIL,
        adminPassword: `Verification-${randomUUID()}!`,
      };
      await writeFile(credentialsFile, JSON.stringify(credentials), {
        flag: 'wx',
        mode: 0o600,
      });
    }
    if (currentAdmin) {
      if (
        currentAdmin.email !== credentials.adminEmail ||
        !verifyPassword(credentials.adminPassword, currentAdmin.password_hash)
      )
        throw verificationError('EXISTING_ADMIN_REJECTED');
    } else
      await provisionStandaloneAdmin(db, {
        email: credentials.adminEmail,
        password: credentials.adminPassword,
        deployment: 'remote',
      });
    const currentState = await db
      .prepare('SELECT payload FROM portal_state WHERE id = ?1')
      .bind(portalStateId)
      .first();
    if (!currentState)
      await db
        .prepare(
          'INSERT INTO portal_state(payload,updated_at,id) VALUES (?1,?2,?3)',
        )
        .bind(
          JSON.stringify(emptyPortalStateBaseline()),
          new Date().toISOString(),
          portalStateId,
        )
        .run();
    const accounts = {
      ...credentials,
      runId,
      partners: ['담당', '비담당'].map((name, index) => ({
        name: `합성${name}-${runId.slice(0, 6)}`,
        email: `verification-${index}-${runId}@example.invalid`,
        password: `Verification-${randomUUID()}!`,
      })),
    };
    await writeFile(
      path.join(directory, `accounts-${runId}.json`),
      JSON.stringify(accounts),
      { flag: 'wx', mode: 0o600 },
    );
    await record({ phase, status: 'passed', syntheticOnly: true });

    phase = 'https_server';
    const certPath = path.join(directory, 'localhost-cert.pem');
    const keyPath = path.join(directory, 'localhost-key.pem');
    if (!(await exists(certPath)) && !(await exists(keyPath))) {
      await captureProcess(
        process.platform === 'win32'
          ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe'
          : 'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-days',
          '2',
          '-keyout',
          keyPath,
          '-out',
          certPath,
          '-subj',
          '/CN=127.0.0.1',
          '-addext',
          'subjectAltName=IP:127.0.0.1,DNS:localhost',
        ],
        { env: processEnvironment(), quiet: true },
      );
    }
    const cert = await readFile(certPath, 'utf8');
    setDefaultCACertificates([...originalTrust, cert]);
    const port = Number(new URL(settings.target.appOrigin).port);
    const environment = processEnvironment({
      ...settings.environment,
      NODE_ENV: 'development',
      NEXT_TELEMETRY_DISABLED: '1',
      NODE_EXTRA_CA_CERTS: certPath,
      ANTHROPIC_EXTERNAL_PROCESSING_ENABLED: 'false',
    });
    server = ownedNextProcess(
      [
        'dev',
        '--hostname',
        '127.0.0.1',
        '--port',
        String(port),
        '--experimental-https',
        '--experimental-https-key',
        keyPath,
        '--experimental-https-cert',
        certPath,
        '--experimental-https-ca',
        certPath,
      ],
      environment,
      port,
    );
    await server.ready();
    await record({
      phase,
      status: 'passed',
      origin: settings.target.appOrigin,
    });
    phase = 'workflow';
    const result = await verifyLiveWorkflow(settings, accounts, record);
    await saveStatus({ status: 'passed', ...result });
    console.log(JSON.stringify({ status: 'passed', ...result }));
  } catch (error) {
    const code =
      error.verificationCode ?? 'OPERATION_FAILED_OR_OUTCOME_UNKNOWN';
    await saveStatus({ status: 'failed', phase, code });
    throw verificationError(code);
  } finally {
    await server?.stop().catch(() => {
      process.exitCode = 1;
    });
    await raw?.end({ timeout: 5 });
    setDefaultCACertificates(originalTrust);
    await journal?.close();
    await lock.close();
    await unlink(lockPath);
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(
    `Verification stopped: ${error.verificationCode ?? 'OPERATION_FAILED_OR_OUTCOME_UNKNOWN'}`,
  );
  process.exitCode = 1;
});
