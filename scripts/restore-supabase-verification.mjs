import './register-local.mjs';
import { readFile, writeFile, open, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { readVerificationFile } from './supabase-verification.mjs';
import {
  verificationError,
  assertVerificationBucket,
} from './supabase-verification-policy.mjs';
import {
  backupTarget,
  assertBackupSource,
  assertBackupMarker,
} from './supabase-backup-target.mjs';
import { openBackup, hashBackupBytes } from './supabase-backup-archive.mjs';
import {
  fingerprintSupabaseDatabase,
  compareSupabaseFingerprints,
} from './supabase-backup-fingerprint.mjs';
import {
  readBackupStorageLinks,
  verifyBackupStorageLinks,
} from './supabase-backup-storage-links.mjs';
import { snapshotSupabaseStorage } from './supabase-backup-storage.mjs';
import {
  processEnvironment,
  captureProcess,
  prepareSnapshot,
  checkBackupAbort,
  BACKUP_LIMIT,
} from './supabase-backup-runtime.mjs';
import { withBackupSignals } from './supabase-backup.mjs';
import {
  recoveryProfile,
  assertRecoveryConfig,
  assertRecoveryPayload,
  assertRecoveryEmpty,
  recoveryObjectPath,
  compareRecoveredObjects,
} from './supabase-recovery-policy.mjs';

// One existing synthetic archive -> one specifically approved empty project.
// No source network calls, --clean, deletion, upsert, credential reset or retry.
export function recoveryConnection(config, binding) {
  assertRecoveryConfig(config, binding);
  const url = new URL(config.databaseUrl);
  url.port = '5432';
  return {
    url: url.toString(),
    env: processEnvironment({
      PGHOST: recoveryProfile.databaseHost,
      PGPORT: '5432',
      PGDATABASE: 'postgres',
      PGUSER: `postgres.${recoveryProfile.projectRef}`,
      PGPASSWORD: decodeURIComponent(url.password),
      PGSSLMODE: 'require',
      PGCONNECT_TIMEOUT: '15',
      PGAPPNAME: 'partner-hub-synthetic-recovery',
      PGOPTIONS: '-c statement_timeout=180000 -c lock_timeout=10000',
    }),
  };
}

export const recoveryRestoreArgs = Object.freeze([
  '--exit-on-error',
  '--single-transaction',
  '--no-password',
  '--dbname',
  'postgres',
]);

export async function recoveryStorageRequest(
  config,
  binding,
  route,
  init = {},
) {
  assertRecoveryConfig(config, binding);
  if (!route.startsWith('/bucket') && !route.startsWith('/object/'))
    throw verificationError('RECOVERY_STORAGE_ROUTE');
  checkBackupAbort();
  const response = await fetch(`${config.supabaseUrl}/storage/v1${route}`, {
    ...init,
    headers: { apikey: config.secretKey, ...init.headers },
    redirect: 'error',
    credentials: 'omit',
    cache: 'no-store',
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw verificationError('RECOVERY_STORAGE_REQUEST');
  }
  const body = await response.text();
  if (body.length > 65536) throw verificationError('RECOVERY_STORAGE_RESPONSE');
  return JSON.parse(body);
}

async function readEmptyTarget(sql) {
  return sql.begin('isolation level repeatable read read only', async (tx) => {
    const [row] = await tx.unsafe(`SELECT
      current_database() AS database, current_user AS username,
      current_setting('server_version') AS version,
      to_regnamespace('partner_hub') IS NOT NULL AS schema_present,
      (SELECT count(*)::int FROM pg_tables WHERE schemaname='public') AS public_tables,
      (SELECT count(*)::int FROM auth.users) AS auth_users,
      (SELECT count(*)::int FROM storage.buckets) AS storage_buckets,
      (SELECT count(*)::int FROM storage.objects) AS storage_objects`);
    if (
      row.database !== 'postgres' ||
      row.username !== 'postgres' ||
      !row.version.startsWith('17.')
    )
      throw verificationError('RECOVERY_DATABASE_IDENTITY');
    const result = {
      schemaPresent: row.schema_present,
      publicTables: row.public_tables,
      authUsers: row.auth_users,
      storageBuckets: row.storage_buckets,
      storageObjects: row.storage_objects,
    };
    assertRecoveryEmpty(result);
    return result;
  });
}

async function restoredSnapshot(sql) {
  return sql.begin('isolation level repeatable read read only', async (tx) => {
    await prepareSnapshot(tx);
    // The restored source marker remains unchanged; the private status binds
    // the destination separately. Changing a marker would falsify equality.
    await assertBackupMarker(tx, backupTarget('verification'));
    return {
      fingerprint: await fingerprintSupabaseDatabase(tx, {
        expectedTableCount: 39,
      }),
      links: await readBackupStorageLinks(tx),
    };
  });
}

export async function restoreVerification(args) {
  if (
    args.length !== 6 ||
    args[0] !== '--config' ||
    args[2] !== '--source-config' ||
    args[4] !== '--pg-bin'
  )
    throw verificationError('RECOVERY_ARGUMENTS');
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0')
    throw verificationError('TLS_DISABLED');
  const destination = await readVerificationFile(args[1]);
  const binding = JSON.parse(await readFile(args[1], 'utf8')).recovery;
  assertRecoveryConfig(destination.config, binding);
  const source = await readVerificationFile(args[3]);
  assertBackupSource(source.config, backupTarget('verification'));
  const prior = JSON.parse(
    await readFile(path.join(source.directory, 'backup-status.json'), 'utf8'),
  );
  if (
    prior.status !== 'passed' ||
    prior.projectRef !== recoveryProfile.sourceProjectRef ||
    prior.verification?.archiveSha256 !== recoveryProfile.archiveSha256 ||
    prior.verification?.localRestorePlaintextRemoved !== true
  )
    throw verificationError('RECOVERY_BACKUP_EVIDENCE');
  for (const [file, maximum] of [
    [prior.creation.archiveFile, BACKUP_LIMIT],
    [prior.creation.keyFile, 32],
  ]) {
    const stat = await lstat(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.size > maximum
    )
      throw verificationError('RECOVERY_INPUT_FILE');
  }
  const pgRestore = path.join(
    await realpath(args[5]),
    process.platform === 'win32' ? 'pg_restore.exe' : 'pg_restore',
  );
  const version = (
    await captureProcess(pgRestore, ['--version'], { limit: 1024 })
  )
    .toString()
    .trim();
  if (!version.startsWith('pg_restore (PostgreSQL) 17.'))
    throw verificationError('RECOVERY_PG_VERSION');
  const encrypted = await readFile(prior.creation.archiveFile);
  const archiveHash = hashBackupBytes(encrypted);
  if (archiveHash !== recoveryProfile.archiveSha256)
    throw verificationError('RECOVERY_ARCHIVE_IDENTITY');
  const key = await readFile(prior.creation.keyFile);
  let payload;
  try {
    payload = openBackup(encrypted, key);
  } finally {
    key.fill(0);
  }
  const dump = assertRecoveryPayload(payload, archiveHash);
  const resultFile = path.join(destination.directory, 'restore-status.json');
  const claim = await open(resultFile, 'wx', 0o600);
  await claim.close();
  const status = {
    status: 'running',
    startedAt: new Date().toISOString(),
    phase: 'preflight',
    sourceProjectRef: recoveryProfile.sourceProjectRef,
    projectRef: recoveryProfile.projectRef,
    archiveSha256: archiveHash,
    syntheticOnly: true,
    sourceWrites: 0,
    sourceNetworkRequests: 0,
    databaseRestored: false,
    databaseEqual: false,
    storageRestored: false,
    appAccessVerified: false,
  };
  const save = async () => {
    await writeFile(resultFile, JSON.stringify(status, null, 2) + '\n', {
      mode: 0o600,
    });
    console.log(
      JSON.stringify({
        phase: status.phase,
        status: status.status,
        uploaded: status.uploaded ?? 0,
      }),
    );
  };
  let sql;
  try {
    await save();
    const connection = recoveryConnection(destination.config, binding);
    sql = postgres(connection.url, {
      ssl: 'require',
      prepare: false,
      max: 1,
      connect_timeout: 15,
      idle_timeout: 20,
      max_lifetime: 0,
      fetch_types: false,
      onnotice: false,
    });
    status.emptyTarget = await readEmptyTarget(sql);
    const buckets = await recoveryStorageRequest(
      destination.config,
      binding,
      '/bucket',
    );
    if (!Array.isArray(buckets) || buckets.length !== 0)
      throw verificationError('RECOVERY_BUCKETS_NOT_EMPTY');
    status.phase = 'database_restore';
    await save();
    assertRecoveryConfig(destination.config, binding);
    await captureProcess(pgRestore, [...recoveryRestoreArgs], {
      env: connection.env,
      input: dump,
      limit: 32768,
    });
    status.databaseRestored = true;
    const restored = await restoredSnapshot(sql);
    const compared = compareSupabaseFingerprints(
      payload.database.fingerprint,
      restored.fingerprint,
    );
    if (!compared.equal) {
      status.differences = compared.differences;
      throw verificationError('RECOVERY_DATABASE_DIFFERENT');
    }
    status.databaseEqual = true;
    status.databaseTables = restored.fingerprint.tables.length;
    status.databaseRows = restored.fingerprint.totalRows;
    status.storageLinkCheck = verifyBackupStorageLinks(
      restored.links,
      payload.storage,
    );
    status.phase = 'storage_restore';
    await save();
    await recoveryStorageRequest(destination.config, binding, '/bucket', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: recoveryProfile.storageBucket,
        name: recoveryProfile.storageBucket,
        public: false,
        file_size_limit: 26214400,
        allowed_mime_types: ['application/octet-stream'],
      }),
    });
    assertVerificationBucket(
      await recoveryStorageRequest(
        destination.config,
        binding,
        `/bucket/${recoveryProfile.storageBucket}`,
      ),
      recoveryProfile.storageBucket,
    );
    status.uploaded = 0;
    for (const object of payload.storage.objects) {
      const bytes = Buffer.from(object.bytesBase64, 'base64');
      try {
        await recoveryStorageRequest(
          destination.config,
          binding,
          `/object/${recoveryProfile.storageBucket}/${recoveryObjectPath(object.path)}`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/octet-stream',
              'x-upsert': 'false',
              'cache-control': 'private, no-store',
            },
            body: bytes,
          },
        );
      } finally {
        bytes.fill(0);
      }
      status.uploaded++;
      await save();
    }
    status.phase = 'storage_verify';
    await save();
    assertRecoveryConfig(destination.config, binding);
    const recoveredObjects = await snapshotSupabaseStorage(destination.config);
    compareRecoveredObjects(payload.storage, recoveredObjects);
    verifyBackupStorageLinks(restored.links, recoveredObjects);
    const after = await restoredSnapshot(sql);
    if (
      !compareSupabaseFingerprints(
        payload.database.fingerprint,
        after.fingerprint,
      ).equal
    )
      throw verificationError('RECOVERY_DATABASE_CHANGED');
    status.storageObjects = recoveredObjects.objects.length;
    status.storageBytes = recoveredObjects.totalBytes;
    status.storageRestored = true;
    status.storageBytesEqual = true;
    status.storageProviderMetadataPreserved = false;
    status.plaintextFilesWritten = 0;
    status.status = 'passed';
    status.phase = 'db_storage_verified';
    status.completedAt = new Date().toISOString();
    await save();
  } catch (error) {
    status.status = 'failed';
    status.error =
      error.verificationCode ??
      error.backupCode ??
      'RECOVERY_OPERATION_FAILED_OR_OUTCOME_UNKNOWN';
    await save();
    throw verificationError(status.error);
  } finally {
    dump.fill(0);
    payload = null;
    await sql?.end({ timeout: 5 });
  }
  return status;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await withBackupSignals(() =>
    restoreVerification(process.argv.slice(2)),
  ).catch((error) => {
    console.error(
      JSON.stringify({
        status: 'failed',
        error:
          error.verificationCode ??
          error.backupCode ??
          'RECOVERY_OPERATION_FAILED_OR_OUTCOME_UNKNOWN',
      }),
    );
    process.exitCode = 1;
  });
}
