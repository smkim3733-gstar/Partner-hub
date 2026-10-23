import './register-local.mjs';
import { readFile, writeFile, lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { readVerificationFile } from './supabase-verification.mjs';
import { recoveryConnection } from './restore-supabase-verification.mjs';
import {
  recoveryProfile,
  assertRecoveryConfig,
  assertRecoveryPayload,
} from './supabase-recovery-policy.mjs';
import { verificationError } from './supabase-verification-policy.mjs';
import {
  backupTarget,
  assertBackupSource,
  assertBackupMarker,
} from './supabase-backup-target.mjs';
import { openBackup, hashBackupBytes } from './supabase-backup-archive.mjs';
import { prepareSnapshot, BACKUP_LIMIT } from './supabase-backup-runtime.mjs';
import {
  fingerprintSupabaseDatabase,
  compareSupabaseFingerprints,
} from './supabase-backup-fingerprint.mjs';

// Finish only the failed preservation assertion. No login/download replay or DB
// writes. Compare business data with the original archive, not a new baseline.
async function main(args) {
  if (
    args.length !== 4 ||
    args[0] !== '--config' ||
    args[2] !== '--source-config'
  )
    throw verificationError('RECOVERY_PRESERVATION_ARGUMENTS');
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0')
    throw verificationError('TLS_DISABLED');
  const settings = await readVerificationFile(args[1]);
  const binding = JSON.parse(await readFile(args[1], 'utf8')).recovery;
  assertRecoveryConfig(settings.config, binding);
  const source = await readVerificationFile(args[3]);
  assertBackupSource(source.config, backupTarget('verification'));
  const readStatus = async (dir, name) =>
    JSON.parse(await readFile(path.join(dir, name), 'utf8'));
  const app = await readStatus(
    settings.directory,
    'app-restore-reconciled-status.json',
  );
  const reconciliation = await readStatus(
    settings.directory,
    'storage-reconciliation-transaction-status.json',
  );
  const backup = await readStatus(source.directory, 'backup-status.json');
  if (
    app.status !== 'failed' ||
    app.phase !== 'logout_and_preservation' ||
    app.checks !== 84 ||
    app.downloadedFiles !== 7 ||
    app.downloadedBytes !== 55817383 ||
    !app.sessionsAndServerClosed ||
    app.httpFailure ||
    app.projectRef !== recoveryProfile.projectRef ||
    app.archiveSha256 !== recoveryProfile.archiveSha256 ||
    reconciliation.status !== 'passed' ||
    !reconciliation.otherTablesAndSchemaEqual ||
    !reconciliation.immutableTriggerRestoredInSameTransaction ||
    backup.status !== 'passed' ||
    backup.verification?.archiveSha256 !== recoveryProfile.archiveSha256
  )
    throw verificationError('RECOVERY_PRESERVATION_PRIOR_EVIDENCE');
  for (const [file, limit] of [
    [backup.creation.archiveFile, BACKUP_LIMIT],
    [backup.creation.keyFile, 32],
  ]) {
    const stat = await lstat(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.size > limit
    )
      throw verificationError('RECOVERY_PRESERVATION_INPUT');
  }
  const encrypted = await readFile(backup.creation.archiveFile);
  if (hashBackupBytes(encrypted) !== recoveryProfile.archiveSha256)
    throw verificationError('RECOVERY_ARCHIVE_IDENTITY');
  const key = await readFile(backup.creation.keyFile);
  let payload;
  try {
    payload = openBackup(encrypted, key);
  } finally {
    key.fill(0);
  }
  const dump = assertRecoveryPayload(payload, recoveryProfile.archiveSha256);
  dump.fill(0);
  const file = path.join(settings.directory, 'app-preservation-status.json');
  const claim = await open(file, 'wx', 0o600);
  await claim.close();
  const status = {
    status: 'running',
    startedAt: new Date().toISOString(),
    projectRef: recoveryProfile.projectRef,
    sourceProjectRef: recoveryProfile.sourceProjectRef,
    archiveSha256: recoveryProfile.archiveSha256,
    sourceNetworkRequests: 0,
    databaseWrites: 0,
    httpAssertionsAlreadyPassed: 84,
    downloadedFilesAlreadyVerified: 7,
    syntheticOnly: true,
  };
  let sql;
  try {
    sql = postgres(recoveryConnection(settings.config, binding).url, {
      ssl: 'require',
      max: 1,
      prepare: false,
      onnotice: false,
      fetch_types: false,
      connect_timeout: 15,
    });
    await sql.begin('isolation level repeatable read read only', async (tx) => {
      await prepareSnapshot(tx);
      await assertBackupMarker(tx, backupTarget('verification'));
      const current = await fingerprintSupabaseDatabase(tx, {
        expectedTableCount: 39,
      });
      const differences = compareSupabaseFingerprints(
        payload.database.fingerprint,
        current,
      ).differences;
      status.differencesFromOriginalArchive = differences;
      const allowed = new Set([
        'standalone_admin_sessions',
        'standalone_admin_audit',
        'portal_password_sessions',
        'portal_auth_limits',
        'portal_login_stats',
        'storage_object_versions',
      ]);
      if (
        !differences.every(
          (item) => item.kind === 'table-content' && allowed.has(item.table),
        )
      )
        throw verificationError('RECOVERY_PRESERVATION_UNEXPECTED_CHANGE');
      // Restore original timestamps only in a read-only SELECT's values. The
      // resulting complete-row multiset must exactly match the archive digest.
      const columns =
        await tx`SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'partner_hub' AND table_name = 'storage_object_versions' ORDER BY ordinal_position`;
      if (
        JSON.stringify(columns.map((row) => row.column_name)) !==
        JSON.stringify([
          'object_key',
          'revision',
          'physical_path',
          'wire',
          'created_at',
        ])
      )
        throw verificationError('RECOVERY_PRESERVATION_COLUMNS');
      const rows =
        await tx`SELECT object_key, revision, physical_path, wire FROM partner_hub.storage_object_versions`;
      if (rows.length !== 7)
        throw verificationError('RECOVERY_PRESERVATION_COUNT');
      let encodedBytes = 0;
      const digests = [];
      for (const row of rows) {
        const original = payload.storage.objects.find(
          (item) => item.path === row.physical_path,
        );
        const wire = JSON.parse(row.wire);
        if (
          !original ||
          original.size !== wire.size ||
          original.sha256 !== wire.checksums?.sha256 ||
          original.metadata.info.etag !== wire.httpEtag ||
          wire.version !== row.revision ||
          wire.key !== row.object_key
        )
          throw verificationError('RECOVERY_PRESERVATION_WIRE');
        const normalized = JSON.stringify({
          ...wire,
          uploaded: new Date(
            original.metadata.info.last_modified,
          ).toISOString(),
        });
        const [encoded] =
          await tx`SELECT json_build_array(object_key::text, revision::text,
          physical_path::text, ${normalized}::text, created_at::text)::text AS encoded_row
          FROM partner_hub.storage_object_versions WHERE object_key = ${row.object_key} AND revision = ${row.revision}`;
        encodedBytes += Buffer.byteLength(encoded.encoded_row, 'utf8');
        digests.push(
          createHash('sha256').update(encoded.encoded_row).digest('hex'),
        );
      }
      const hash = createHash('sha256').update(
        `partner-hub-multiset-v1\n${digests.length}\n`,
      );
      for (const digest of digests.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
        hash.update(digest).update('\n');
      const originalTable = payload.database.fingerprint.tables.find(
        (table) => table.name === 'storage_object_versions',
      );
      if (
        originalTable.rowCount !== rows.length ||
        originalTable.encodedBytes !== encodedBytes ||
        originalTable.contentSha256 !== hash.digest('hex')
      )
        throw verificationError('RECOVERY_PRESERVATION_NORMALIZED_WIRE');
      status.storageVersionsEqualExceptProviderTimestamp = true;
      status.businessTablesAndSchemaEqual = true;
      status.authAndLoginTelemetryTablesChanged = differences
        .filter((item) => item.table !== 'storage_object_versions')
        .map((item) => item.table);
      status.appAccessVerified = true;
      status.status = 'passed';
      status.completedAt = new Date().toISOString();
    });
  } catch (error) {
    status.status = 'failed';
    status.error = error.verificationCode ?? 'RECOVERY_PRESERVATION_FAILED';
  } finally {
    payload = null;
    await sql?.end({ timeout: 5 });
    await writeFile(file, JSON.stringify(status, null, 2) + '\n', {
      mode: 0o600,
    });
  }
  console.log(JSON.stringify(status));
  if (status.status !== 'passed') process.exitCode = 1;
}
await main(process.argv.slice(2)).catch((error) => {
  console.error(
    JSON.stringify({
      status: 'failed',
      error: error.verificationCode ?? 'RECOVERY_PRESERVATION_FAILED',
    }),
  );
  process.exitCode = 1;
});
