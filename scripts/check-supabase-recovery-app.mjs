import './register-local.mjs';
import { readFile, writeFile, open, access } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import postgres from 'postgres';
import { readVerificationFile } from './supabase-verification.mjs';
import {
  backupTarget,
  assertBackupSource,
  assertBackupMarker,
} from './supabase-backup-target.mjs';
import {
  recoveryProfile,
  assertRecoveryConfig,
} from './supabase-recovery-policy.mjs';
import { recoveryConnection } from './restore-supabase-verification.mjs';
import { verificationError } from './supabase-verification-policy.mjs';
import {
  processEnvironment,
  prepareSnapshot,
} from './supabase-backup-runtime.mjs';
import {
  fingerprintSupabaseDatabase,
  compareSupabaseFingerprints,
} from './supabase-backup-fingerprint.mjs';
import { readBackupStorageLinks } from './supabase-backup-storage-links.mjs';
import { ownedNextProcess } from '../tests/owned-next-process.mjs';

// Existing restored accounts and files only; no account provisioning, business
// workflow replay, browser certificate change, uploads or external messages.
async function main(args) {
  if (
    ![4, 5].includes(args.length) ||
    args[0] !== '--config' ||
    args[2] !== '--source-config' ||
    (args.length === 5 && args[4] !== '--after-storage-reconciliation')
  )
    throw verificationError('RECOVERY_APP_ARGUMENTS');
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0')
    throw verificationError('TLS_DISABLED');
  for (const name of [
    '.env',
    '.env.local',
    '.env.development',
    '.env.development.local',
  ]) {
    try {
      await access(name);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    throw verificationError('WORKSPACE_ENV_PRESENT');
  }
  const settings = await readVerificationFile(args[1]);
  const binding = JSON.parse(await readFile(args[1], 'utf8')).recovery;
  assertRecoveryConfig(settings.config, binding);
  const source = await readVerificationFile(args[3]);
  assertBackupSource(source.config, backupTarget('verification'));
  const restore = JSON.parse(
    await readFile(
      path.join(settings.directory, 'restore-status.json'),
      'utf8',
    ),
  );
  if (
    restore.status !== 'passed' ||
    !restore.databaseEqual ||
    !restore.storageBytesEqual ||
    restore.projectRef !== recoveryProfile.projectRef ||
    restore.archiveSha256 !== recoveryProfile.archiveSha256
  )
    throw verificationError('RECOVERY_APP_RESTORE_REQUIRED');
  const workflow = JSON.parse(
    await readFile(path.join(source.directory, 'status.json'), 'utf8'),
  );
  const twoSlot = JSON.parse(
    await readFile(path.join(source.directory, 'two-slot-status.json'), 'utf8'),
  );
  if (workflow.status !== 'passed' || twoSlot.status !== 'passed')
    throw verificationError('RECOVERY_APP_SOURCE_EVIDENCE');
  const accounts = JSON.parse(
    await readFile(
      path.join(source.directory, `accounts-${workflow.runId}.json`),
      'utf8',
    ),
  );
  if (
    accounts.projectRef !== recoveryProfile.sourceProjectRef ||
    accounts.partners.length !== 2
  )
    throw verificationError('RECOVERY_APP_ACCOUNT_SOURCE');
  const reconciled = args.length === 5;
  if (reconciled) {
    const proof = JSON.parse(
      await readFile(
        path.join(
          settings.directory,
          'storage-reconciliation-transaction-status.json',
        ),
        'utf8',
      ),
    );
    if (
      proof.status !== 'passed' ||
      proof.projectRef !== recoveryProfile.projectRef ||
      proof.archiveSha256 !== recoveryProfile.archiveSha256 ||
      !proof.otherTablesAndSchemaEqual ||
      !proof.linksAndChecksumsEqual ||
      !proof.immutableTriggerRestoredInSameTransaction
    )
      throw verificationError('RECOVERY_APP_RECONCILIATION_REQUIRED');
  }
  const resultFile = path.join(
    settings.directory,
    reconciled
      ? 'app-restore-reconciled-status.json'
      : 'app-restore-status.json',
  );
  const claim = await open(resultFile, 'wx', 0o600);
  await claim.close();
  const status = {
    status: 'running',
    startedAt: new Date().toISOString(),
    phase: 'prepare',
    checks: 0,
    projectRef: recoveryProfile.projectRef,
    sourceProjectRef: recoveryProfile.sourceProjectRef,
    archiveSha256: recoveryProfile.archiveSha256,
    syntheticOnly: true,
    downloadedFiles: 0,
    downloadedBytes: 0,
    sourceNetworkRequests: 0,
    businessWrites: 0,
    browserVerified: false,
    operatingSystemTrustChanged: false,
  };
  const save = async () => {
    await writeFile(resultFile, JSON.stringify(status, null, 2) + '\n', {
      mode: 0o600,
    });
    console.log(
      JSON.stringify({
        phase: status.phase,
        checks: status.checks,
        downloadedFiles: status.downloadedFiles,
        status: status.status,
      }),
    );
  };
  const check = (condition) => {
    if (!condition)
      throw verificationError(`RECOVERY_APP_${status.phase.toUpperCase()}`);
    status.checks++;
  };
  const origin = settings.target.appOrigin;
  const request = (endpoint, options = {}) => {
    const url = new URL(endpoint, origin);
    if (url.origin !== origin || !url.pathname.startsWith('/api/'))
      throw verificationError('RECOVERY_APP_ROUTE');
    return fetch(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(120000),
    });
  };
  const send = (endpoint, body, cookie = '') =>
    request(endpoint, {
      method: 'POST',
      headers: { origin, cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const expect = async (response, code = 200) => {
    if (response.status !== code)
      status.httpFailure = { expected: code, actual: response.status };
    check(response.status === code);
    return response;
  };
  const cookies = [];
  const originalTrust = getCACertificates('default');
  let sql, server, baseline;
  const snapshot = () =>
    sql.begin('isolation level repeatable read read only', async (tx) => {
      await prepareSnapshot(tx);
      await assertBackupMarker(tx, backupTarget('verification'));
      return {
        fingerprint: await fingerprintSupabaseDatabase(tx, {
          expectedTableCount: 39,
        }),
        links: await readBackupStorageLinks(tx),
      };
    });
  try {
    await save();
    const connection = recoveryConnection(settings.config, binding);
    sql = postgres(connection.url, {
      ssl: 'require',
      max: 1,
      prepare: false,
      connect_timeout: 15,
      fetch_types: false,
      onnotice: false,
    });
    baseline = await snapshot();
    const certPath = path.join(source.directory, 'localhost-cert.pem');
    const keyPath = path.join(source.directory, 'localhost-key.pem');
    setDefaultCACertificates([
      ...originalTrust,
      await readFile(certPath, 'utf8'),
    ]);
    const port = Number(new URL(origin).port);
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
      processEnvironment({
        ...settings.environment,
        NODE_ENV: 'development',
        NEXT_TELEMETRY_DISABLED: '1',
        NODE_EXTRA_CA_CERTS: certPath,
        ANTHROPIC_EXTERNAL_PROCESSING_ENABLED: 'false',
      }),
      port,
    );
    await server.ready();
    status.phase = 'login_and_permissions';
    await save();
    await expect(await request('/api/state'), 401);
    const login = async (email, password) => {
      const response = await expect(
        await send('/api/auth/login', { email, password }),
      );
      const header = response.headers.get('set-cookie');
      check(
        /^__Host-keve_session=[a-f0-9]{64};/.test(header ?? '') &&
          header.includes('Secure'),
      );
      const cookie = header.split(';')[0];
      cookies.push(cookie);
      return cookie;
    };
    const admin = await login(accounts.adminEmail, accounts.adminPassword);
    const partner = await login(
      accounts.partners[0].email,
      accounts.partners[0].password,
    );
    const outsider = await login(
      accounts.partners[1].email,
      accounts.partners[1].password,
    );
    const state = async (cookie) =>
      (
        await expect(await request('/api/state', { headers: { cookie } }))
      ).json();
    const adminState = await state(admin);
    const partnerState = await state(partner);
    const outsiderState = await state(outsider);
    check(adminState.currentUser.role === 'admin');
    check(
      partnerState.currentUser.memberId !== outsiderState.currentUser.memberId,
    );
    await expect(
      await request('/api/admin/file-inventory', {
        headers: { cookie: partner },
      }),
      403,
    );
    status.phase = 'restored_flow_and_files';
    await save();
    const expectedFiles = new Map(
      baseline.links.versions.map((item) => [item.objectKey, item]),
    );
    const downloaded = new Set();
    for (const caseId of [workflow.caseId, twoSlot.caseId]) {
      check(typeof caseId === 'string' && caseId.startsWith('verification-'));
      const endpoint = `/api/consulting-flow/${encodeURIComponent(caseId)}`;
      const adminFlow = (
        await (
          await expect(await request(endpoint, { headers: { cookie: admin } }))
        ).json()
      ).flow;
      const partnerFlow = (
        await (
          await expect(
            await request(endpoint, { headers: { cookie: partner } }),
          )
        ).json()
      ).flow;
      check(
        adminFlow.revision === partnerFlow.revision &&
          JSON.stringify(adminFlow.files) === JSON.stringify(partnerFlow.files),
      );
      if (caseId === workflow.caseId)
        check(
          Boolean(partnerFlow.aftercare) &&
            Boolean(partnerFlow.contract?.signedFileId),
        );
      check(
        [403, 404].includes(
          (await request(endpoint, { headers: { cookie: outsider } })).status,
        ),
      );
      for (const file of partnerFlow.files) {
        const expected = expectedFiles.get(`consulting-flow/${file.id}`);
        check(Boolean(expected) && !downloaded.has(file.id));
        const endpointFile = `${endpoint}/files/${encodeURIComponent(file.id)}`;
        const response = await expect(
          await request(endpointFile, { headers: { cookie: partner } }),
        );
        const bytes = Buffer.from(await response.arrayBuffer());
        try {
          check(
            bytes.length === expected.size &&
              createHash('sha256').update(bytes).digest('hex') ===
                expected.sha256,
          );
        } finally {
          bytes.fill(0);
        }
        check(
          [403, 404].includes(
            (await request(endpointFile, { headers: { cookie: outsider } }))
              .status,
          ),
        );
        downloaded.add(file.id);
        status.downloadedFiles++;
        status.downloadedBytes += expected.size;
      }
      await save();
    }
    check(downloaded.size === 7 && status.downloadedBytes === 55817383);
    const inventory = await (
      await expect(
        await request('/api/admin/file-inventory?status=all', {
          headers: { cookie: admin },
        }),
      )
    ).json();
    check(inventory.nextCursor === null);
    for (const fileId of downloaded) {
      const item = inventory.items.find(
        (item) => item.id === fileId || item.id === `flow:${fileId}`,
      );
      check(Boolean(item));
      const presence = await (
        await expect(
          await request(
            `/api/admin/file-inventory/${encodeURIComponent(item.id)}/presence`,
            { headers: { cookie: admin } },
          ),
        )
      ).json();
      check(
        presence.exists && presence.sizeMatches && presence.integrityMatches,
      );
    }
    check((await state(admin)).stateRevision === adminState.stateRevision);
    status.phase = 'logout_and_preservation';
    await save();
    for (const cookie of cookies) {
      await expect(await send('/api/auth/logout', {}, cookie));
      await expect(await request('/api/state', { headers: { cookie } }), 401);
    }
    cookies.length = 0;
    const after = await snapshot();
    const differences = compareSupabaseFingerprints(
      baseline.fingerprint,
      after.fingerprint,
    ).differences;
    const allowed = new Set([
      'standalone_admin_sessions',
      'standalone_admin_audit',
      'portal_password_sessions',
      'portal_auth_limits',
      'portal_login_stats',
    ]);
    status.preservationDifferences = differences;
    check(
      differences.every(
        (item) => item.kind === 'table-content' && allowed.has(item.table),
      ),
    );
    status.authTablesChanged = differences.map((item) => item.table);
    status.businessTablesEqual = true;
    status.appAccessVerified = true;
    status.status = 'passed';
    status.phase = 'verified';
    status.completedAt = new Date().toISOString();
  } catch (error) {
    status.status = 'failed';
    status.error = error.verificationCode ?? 'RECOVERY_APP_FAILED';
  } finally {
    let cleanup = true;
    for (const cookie of cookies) {
      try {
        if (!(await send('/api/auth/logout', {}, cookie)).ok) cleanup = false;
      } catch {
        cleanup = false;
      }
    }
    try {
      await server?.stop();
    } catch {
      cleanup = false;
    }
    try {
      await sql?.end({ timeout: 5 });
    } catch {
      cleanup = false;
    }
    setDefaultCACertificates(originalTrust);
    status.sessionsAndServerClosed = cleanup;
    if (!cleanup) {
      status.status = 'failed';
      status.error = 'RECOVERY_APP_CLEANUP';
    }
    await save();
  }
  if (status.status !== 'passed') throw verificationError(status.error);
}

await main(process.argv.slice(2)).catch((error) => {
  console.error(
    JSON.stringify({
      status: 'failed',
      error: error.verificationCode ?? 'RECOVERY_APP_FAILED',
    }),
  );
  process.exitCode = 1;
});
