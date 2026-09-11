// Operator-only encrypted backup and local PostgreSQL restore verification.
// There is no remote restore, production-write, credential argv or plaintext dump mode.
import { randomBytes, randomUUID } from 'node:crypto';
import {
  readFile,
  writeFile,
  readdir,
  realpath,
  rename,
  stat,
  rm,
} from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import {
  sealBackup,
  openBackup,
  hashBackupBytes,
} from './supabase-backup-archive.mjs';
import { snapshotSupabaseStorage } from './supabase-backup-storage.mjs';
import {
  readBackupStorageLinks,
  verifyBackupStorageLinks,
} from './supabase-backup-storage-links.mjs';
import {
  fingerprintSupabaseDatabase,
  compareSupabaseFingerprints,
} from './supabase-backup-fingerprint.mjs';
import {
  BACKUP_LIMIT,
  backupAbort,
  checkBackupAbort,
  failBackup,
  captureProcess,
  processEnvironment,
  privateDirectory,
  defaultBackupRoots,
  assertSeparateRoots,
  sourceConnection,
  prepareSnapshot,
  removePrivateRestoreDirectory,
} from './supabase-backup-runtime.mjs';

const projectRef = 'yievsveuxjnbygatvjtb';
const appOrigin = 'https://partner-hub-gamma-five.vercel.app';
const root = fileURLToPath(new URL('..', import.meta.url));
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const pgOptions = {
  prepare: false,
  max: 1,
  connect_timeout: 15,
  idle_timeout: 20,
  max_lifetime: 0,
  fetch_types: false,
  onnotice: false,
};
const activeConnections = new Set();
const interrupt = () => {
  backupAbort.abort();
  for (const client of activeConnections)
    void client.end({ timeout: 1 }).catch(() => {});
};
export async function withBackupSignals(operation) {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
    process.on(signal, interrupt);
  try {
    return await operation();
  } finally {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
      process.removeListener(signal, interrupt);
  }
}

function options(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    if (
      ![
        '--pg-bin',
        '--backup-dir',
        '--key-dir',
        '--archive',
        '--key-file',
      ].includes(args[i]) ||
      !args[i + 1] ||
      args[i + 1].startsWith('--') ||
      Object.hasOwn(result, args[i])
    )
      throw failBackup('backup-usage-invalid');
    result[args[i]] = path.resolve(args[i + 1]);
  }
  if (!result['--pg-bin']) throw failBackup('backup-pg-bin-required');
  return result;
}

async function pgTools(directory) {
  const bin = await realpath(directory);
  if (process.platform === 'win32' && /[^\x20-\x7e]/.test(bin))
    throw failBackup('backup-postgres-tools-need-ascii-path');
  const exe = (name) =>
    path.join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
  const version = (
    await captureProcess(exe('pg_dump'), ['--version'], { limit: 1024 })
  )
    .toString()
    .trim();
  if (!version.startsWith('pg_dump (PostgreSQL) 17.'))
    throw failBackup('backup-postgres-major-mismatch');
  return { exe, version, bin };
}

async function snapshot(client) {
  return await client.begin(
    'isolation level repeatable read read only',
    async (tx) => {
      await prepareSnapshot(tx);
      return await fingerprintSupabaseDatabase(tx, { expectedTableCount: 38 });
    },
  );
}

export async function createBackup(args, { reportResult = true } = {}) {
  const selected = options(args);
  if (selected['--archive'] || selected['--key-file'])
    throw failBackup('backup-usage-invalid');
  await import('./register-local.mjs');
  const { readSupabaseBackendConfig } =
    await import('../lib/supabase-backend-config.ts');
  const config = readSupabaseBackendConfig({
    ...process.env,
    PARTNER_HUB_BACKEND_ENABLED: '1',
  });
  if (config.projectRef !== projectRef || config.appOrigin !== appOrigin)
    throw failBackup('backup-source-target-mismatch');
  const tools = await pgTools(selected['--pg-bin']);
  const defaults = defaultBackupRoots();
  const backupRoot = selected['--backup-dir'] || defaults.backupRoot;
  const keyRoot = selected['--key-dir'] || defaults.keyRoot;
  assertSeparateRoots(backupRoot, keyRoot);
  const backupDirectory = await privateDirectory(backupRoot, 'backup-');
  const keyDirectory = await privateDirectory(keyRoot, 'key-');
  assertSeparateRoots(await realpath(backupRoot), await realpath(keyRoot));
  const source = sourceConnection(config);
  const client = postgres(source.url, {
    ...pgOptions,
    ssl: 'require',
    connection: {
      default_transaction_read_only: 'on',
      application_name: 'partner-hub-readonly-backup',
    },
  });
  activeConnections.add(client);
  try {
    const startedAt = new Date().toISOString();
    console.log('백업 원본의 읽기 전용 스냅샷을 확인합니다.');
    const database = await client.begin(
      'isolation level repeatable read read only',
      async (tx) => {
        await prepareSnapshot(tx);
        const [{ version }] = await tx.unsafe(
          "SELECT current_setting('server_version') AS version",
        );
        if (!version.startsWith('17.'))
          throw failBackup('backup-source-version-mismatch');
        const fingerprint = await fingerprintSupabaseDatabase(tx, {
          expectedTableCount: 38,
        });
        const storageLinks = await readBackupStorageLinks(tx);
        const [{ snapshot_id: snapshotId }] = await tx.unsafe(
          'SELECT pg_export_snapshot() AS snapshot_id',
        );
        if (!/^[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+$/.test(snapshotId))
          throw failBackup('backup-snapshot-invalid');
        const dump = await captureProcess(
          tools.exe('pg_dump'),
          [
            '--format=custom',
            '--schema=partner_hub',
            '--strict-names',
            '--no-password',
            '--lock-wait-timeout=10s',
            `--snapshot=${snapshotId}`,
          ],
          { env: source.env, limit: 256 * 1024 * 1024 },
        );
        if (dump.subarray(0, 5).toString() !== 'PGDMP')
          throw failBackup('backup-dump-format-invalid');
        return {
          serverVersion: version,
          fingerprint,
          storageLinks,
          sha256: hashBackupBytes(dump),
          bytesBase64: dump.toString('base64'),
        };
      },
    );
    console.log('비공개 첨부파일 목록과 내용을 확인합니다.');
    const storage = await snapshotSupabaseStorage(config);
    const storageLinkCheck = verifyBackupStorageLinks(
      database.storageLinks,
      storage,
    );
    const after = await snapshot(client);
    checkBackupAbort();
    if (!compareSupabaseFingerprints(database.fingerprint, after).equal)
      throw failBackup('backup-source-changed-during-storage-read');
    const migrations = [];
    for (const name of (
      await readdir(path.join(root, 'supabase', 'migrations'))
    )
      .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
      .sort()) {
      const bytes = await readFile(
        path.join(root, 'supabase', 'migrations', name),
      );
      migrations.push({
        name,
        sha256: hashBackupBytes(bytes),
        sql: bytes.toString('utf8'),
      });
    }
    const commit = (
      await captureProcess('git', ['rev-parse', 'HEAD'], { limit: 1024 })
    )
      .toString()
      .trim();
    const payload = {
      format: 'partner-hub-backup-v1',
      startedAt,
      completedAt: new Date().toISOString(),
      source: {
        projectRef,
        appOrigin,
        schema: 'partner_hub',
        commit,
        pgDumpVersion: tools.version,
      },
      database,
      storage,
      storageLinkCheck,
      migrations,
      consistency: {
        databaseSnapshotExported: true,
        sourceUnchangedDuringStorageRead: true,
        storageInventoryCheckedTwice: true,
        crossServiceAtomicSnapshot: false,
      },
    };
    const key = randomBytes(32);
    const archive = sealBackup(payload, key);
    const keyFile = path.join(keyDirectory, 'recovery.key');
    const archiveFile = path.join(backupDirectory, 'partner-hub.phbackup');
    await writeFile(keyFile, key, { flag: 'wx', mode: 0o600 });
    key.fill(0);
    checkBackupAbort();
    await writeFile(archiveFile + '.partial', archive, {
      flag: 'wx',
      mode: 0o600,
    });
    await rename(archiveFile + '.partial', archiveFile);
    const report = {
      status: 'created-unverified',
      source: payload.source,
      startedAt,
      completedAt: payload.completedAt,
      archiveFile,
      archiveSha256: hashBackupBytes(archive),
      keyFile,
      databaseTables: database.fingerprint.tables.length,
      databaseRows: database.fingerprint.totalRows,
      storageObjects: storage.objects.length,
      storageBytes: storage.totalBytes,
      storageLinkCheck,
      sourceWrites: 0,
      restoreVerified: false,
      separateDeviceKeyCopyVerified: false,
      scheduledBackupConfigured: false,
    };
    await writeFile(
      path.join(backupDirectory, 'creation-report.json'),
      json(report),
      { flag: 'wx', mode: 0o600 },
    );
    if (reportResult) console.log(json(report));
    return report;
  } finally {
    activeConnections.delete(client);
    await client.end({ timeout: 5 });
  }
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

export async function verifyBackup(args, { reportResult = true } = {}) {
  const selected = options(args);
  if (
    !selected['--archive'] ||
    !selected['--key-file'] ||
    selected['--backup-dir'] ||
    selected['--key-dir']
  )
    throw failBackup('backup-usage-invalid');
  const tools = await pgTools(selected['--pg-bin']);
  if (
    (await stat(selected['--archive'])).size > BACKUP_LIMIT ||
    (await stat(selected['--key-file'])).size !== 32
  )
    throw failBackup('backup-input-size-invalid');
  const encrypted = await readFile(selected['--archive']);
  const key = await readFile(selected['--key-file']);
  const payload = openBackup(encrypted, key);
  key.fill(0);
  if (
    payload?.format !== 'partner-hub-backup-v1' ||
    payload.source?.projectRef !== projectRef ||
    payload.source?.appOrigin !== appOrigin ||
    payload.source?.schema !== 'partner_hub' ||
    !payload.database?.serverVersion?.startsWith('17.')
  )
    throw failBackup('backup-payload-invalid');
  const dump = Buffer.from(payload.database.bytesBase64, 'base64');
  if (
    dump.toString('base64') !== payload.database.bytesBase64 ||
    hashBackupBytes(dump) !== payload.database.sha256 ||
    dump.subarray(0, 5).toString() !== 'PGDMP'
  )
    throw failBackup('backup-dump-integrity-failed');
  if (
    !Array.isArray(payload.storage?.objects) ||
    payload.storage.objects.length > 10_000
  )
    throw failBackup('backup-storage-invalid');
  const directory = await privateDirectory(os.tmpdir(), 'partner-hub-restore-');
  const cluster = path.join(directory, 'cluster');
  const passwordFile = path.join(directory, 'local-password');
  const password = randomBytes(32).toString('base64url');
  let stopLocalServer;
  let admin;
  let restored;
  let report;
  let clean = false;
  let operationFailure;
  let cleanupFailure;
  try {
    await writeFile(passwordFile, password, { flag: 'wx', mode: 0o600 });
    await captureProcess(
      tools.exe('initdb'),
      [
        '--pgdata',
        cluster,
        '--username=postgres',
        '--encoding=UTF8',
        '--locale=C',
        '--auth=scram-sha-256',
        '--pwfile',
        passwordFile,
      ],
      { limit: 32_768, cwd: tools.bin },
    );
    await rm(passwordFile);
    const port = await unusedPort();
    checkBackupAbort();
    let stopPromise;
    stopLocalServer = () =>
      (stopPromise ??= (async () => {
        try {
          await captureProcess(
            tools.exe('pg_ctl'),
            ['-D', cluster, 'stop', '-m', 'fast', '-w', '-t', '15'],
            { limit: 32_768, cwd: tools.bin, signal: null, quiet: true },
          );
        } catch {
          const pidRemains = await stat(
            path.join(cluster, 'postmaster.pid'),
          ).then(
            () => true,
            (error) => {
              if (error.code === 'ENOENT') return false;
              throw error;
            },
          );
          if (pidRemains) throw failBackup('backup-local-server-stop-failed');
        }
      })());
    // pg_ctl uses a restricted process token on Windows. Direct postgres.exe
    // startup is rejected when the operator has administrative permissions.
    // Finish bounded startup before observing cancellation: stopping before
    // postmaster.pid exists could otherwise miss a server that starts later.
    console.log('임시 PostgreSQL 서버를 기동합니다.');
    await captureProcess(
      tools.exe('pg_ctl'),
      [
        '-D',
        cluster,
        '-l',
        path.join(directory, 'postgres.log'),
        '-o',
        `-h 127.0.0.1 -p ${port} -c log_statement=none -c log_min_error_statement=panic -c log_min_messages=panic -c max_connections=10`,
        '-w',
        '-t',
        '20',
        'start',
      ],
      {
        limit: 32_768,
        cwd: tools.bin,
        quiet: true,
        signal: null,
        timeout: 30_000,
      },
    );
    const connect = (database) =>
      postgres({
        ...pgOptions,
        host: '127.0.0.1',
        port,
        database,
        username: 'postgres',
        password,
        ssl: false,
        connect_timeout: 2,
      });
    for (let attempt = 0; attempt < 50; attempt++) {
      checkBackupAbort();
      const probe = connect('postgres');
      try {
        const [{ data_directory: actual }] = await probe.unsafe(
          "SELECT current_setting('data_directory') AS data_directory",
        );
        if ((await realpath(actual)) !== (await realpath(cluster)))
          throw failBackup('backup-local-server-identity-mismatch');
        admin = probe;
        activeConnections.add(admin);
        break;
      } catch (error) {
        await probe.end({ timeout: 1 });
        if (error.backupCode) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    if (!admin) throw failBackup('backup-local-server-start-failed');
    checkBackupAbort();
    const database = `ph_verify_${randomUUID().replaceAll('-', '')}`;
    await admin.unsafe('CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS');
    await admin.unsafe(
      'CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS',
    );
    await admin.unsafe(
      'CREATE ROLE service_role NOLOGIN NOSUPERUSER BYPASSRLS',
    );
    await admin.unsafe(`CREATE DATABASE ${database}`);
    const localEnv = processEnvironment({
      PGHOST: '127.0.0.1',
      PGPORT: String(port),
      PGDATABASE: database,
      PGUSER: 'postgres',
      PGPASSWORD: password,
      PGSSLMODE: 'disable',
      PGCONNECT_TIMEOUT: '5',
    });
    console.log(
      '새 로컬 PostgreSQL에 복원하고 38개 테이블·권한·규칙을 대조합니다.',
    );
    await captureProcess(
      tools.exe('pg_restore'),
      [
        '--exit-on-error',
        '--single-transaction',
        '--no-password',
        '--dbname',
        database,
      ],
      { env: localEnv, input: dump, limit: 32_768 },
    );
    restored = connect(database);
    activeConnections.add(restored);
    const fingerprint = await snapshot(restored);
    const compared = compareSupabaseFingerprints(
      payload.database.fingerprint,
      fingerprint,
    );
    const restoredLinks = await restored.begin(
      'isolation level repeatable read read only',
      readBackupStorageLinks,
    );
    const storageLinkCheck = verifyBackupStorageLinks(
      restoredLinks,
      payload.storage,
    );
    checkBackupAbort();
    if (!compared.equal) {
      console.log(
        json({
          status: 'restore-different',
          differences: compared.differences,
        }),
      );
      throw failBackup('backup-restored-database-mismatch');
    }
    // Only immutable bytes are materialized to opaque local filenames. Never
    // interpret an object name from a backup as a filesystem path.
    const seen = new Set();
    let totalBytes = 0;
    for (const [index, object] of payload.storage.objects.entries()) {
      checkBackupAbort();
      if (
        typeof object.path !== 'string' ||
        seen.has(object.path) ||
        typeof object.bytesBase64 !== 'string'
      )
        throw failBackup('backup-storage-invalid');
      seen.add(object.path);
      const bytes = Buffer.from(object.bytesBase64, 'base64');
      if (
        bytes.toString('base64') !== object.bytesBase64 ||
        bytes.length !== object.size ||
        hashBackupBytes(bytes) !== object.sha256
      )
        throw failBackup('backup-storage-integrity-failed');
      totalBytes += bytes.length;
      const file = path.join(directory, `object-${index}.bin`);
      await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
      if (hashBackupBytes(await readFile(file)) !== object.sha256)
        throw failBackup('backup-restored-file-mismatch');
    }
    if (totalBytes !== payload.storage.totalBytes)
      throw failBackup('backup-storage-size-mismatch');
    report = {
      status: 'verified-local-postgresql',
      verifiedAt: new Date().toISOString(),
      archiveSha256: hashBackupBytes(encrypted),
      source: payload.source,
      databaseTables: fingerprint.tables.length,
      databaseRows: fingerprint.totalRows,
      schemaAndPermissionsEqual: true,
      tableContentsEqual: true,
      storageObjects: payload.storage.objects.length,
      storageBytes: totalBytes,
      storageLinkCheck,
      storageCheck:
        payload.storage.objects.length === 0
          ? 'empty-inventory-verified-no-file-restore-claim'
          : 'local-byte-restore-verified',
      supabaseStorageRestoreVerified: false,
      sourceWrites: 0,
      remoteRestoreSupported: false,
      separateDeviceKeyCopyVerified: false,
      scheduledBackupConfigured: false,
    };
  } catch (error) {
    operationFailure = error;
  } finally {
    await Promise.allSettled([
      restored?.end({ timeout: 5 }),
      admin?.end({ timeout: 5 }),
    ]);
    activeConnections.delete(restored);
    activeConnections.delete(admin);
    try {
      await stopLocalServer?.();
      await removePrivateRestoreDirectory(directory);
      clean = true;
    } catch {
      console.error(
        json({ status: 'local-cleanup-required', privateDirectory: directory }),
      );
      cleanupFailure = failBackup('backup-local-cleanup-failed');
    }
  }
  if (cleanupFailure) throw cleanupFailure;
  if (operationFailure) throw operationFailure;
  checkBackupAbort();
  if (report && clean) {
    report.localRestorePlaintextRemoved = true;
    const reportPath = path.join(
      path.dirname(selected['--archive']),
      `verification-${Date.now()}.json`,
    );
    await writeFile(reportPath, json(report), { flag: 'wx', mode: 0o600 });
    if (reportResult) console.log(json({ ...report, reportPath }));
    return { ...report, reportPath };
  }
}

async function main() {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === '--help' && args.length === 0)
      console.log(
        'create --pg-bin <PostgreSQL17/bin> [--backup-dir <absolute-root>] [--key-dir <separate-absolute-root>]\nverify --pg-bin <PostgreSQL17/bin> --archive <encrypted.phbackup> --key-file <recovery.key>\ncreate loads operator environment; verify only creates a private, temporary loopback PostgreSQL cluster. No remote restore. Keys must be copied separately to secure offline storage for device-loss recovery.',
      );
    else if (command === 'create') await createBackup(args);
    else if (command === 'verify') await verifyBackup(args);
    else throw failBackup('backup-usage-invalid');
  } catch (error) {
    const code =
      typeof error?.backupCode === 'string'
        ? error.backupCode
        : error?.name === 'SupabaseFingerprintError' &&
            /^[a-z-]+$/.test(error.code)
          ? error.code
          : /^(BACKUP_ARCHIVE_INVALID|SUPABASE_BACKUP_STORAGE_(INVALID_CONFIG|FAILED|CHANGED|LIMIT_EXCEEDED))$/.test(
                error?.message,
              )
            ? error.message
            : 'backup-failed-redacted';
    console.error(json({ status: 'failed', error: code }));
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await withBackupSignals(main);
