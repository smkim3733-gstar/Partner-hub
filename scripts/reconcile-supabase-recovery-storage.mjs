import './register-local.mjs';
import { readFile, writeFile, open } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import { readVerificationFile } from './supabase-verification.mjs';
import { recoveryConnection } from './restore-supabase-verification.mjs';
import {
  recoveryProfile,
  assertRecoveryConfig,
  reconcileRecoveryWire,
} from './supabase-recovery-policy.mjs';
import { verificationError } from './supabase-verification-policy.mjs';
import {
  fingerprintSupabaseDatabase,
  compareSupabaseFingerprints,
} from './supabase-backup-fingerprint.mjs';
import { prepareSnapshot } from './supabase-backup-runtime.mjs';
import { backupTarget, assertBackupMarker } from './supabase-backup-target.mjs';
import { readBackupStorageLinks } from './supabase-backup-storage-links.mjs';

// Exactly the approved recovery project, after its successful byte restore.
// Original archive and source remain untouched. Keep the first failed app proof.
async function main(args) {
  if (args.length !== 2 || args[0] !== '--config')
    throw verificationError('RECOVERY_RECONCILE_ARGUMENTS');
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0')
    throw verificationError('TLS_DISABLED');
  const settings = await readVerificationFile(args[1]);
  const binding = JSON.parse(await readFile(args[1], 'utf8')).recovery;
  assertRecoveryConfig(settings.config, binding);
  const restore = JSON.parse(
    await readFile(
      path.join(settings.directory, 'restore-status.json'),
      'utf8',
    ),
  );
  const failed = JSON.parse(
    await readFile(
      path.join(settings.directory, 'app-restore-status.json'),
      'utf8',
    ),
  );
  if (
    restore.status !== 'passed' ||
    !restore.databaseEqual ||
    !restore.storageBytesEqual ||
    restore.projectRef !== recoveryProfile.projectRef ||
    restore.archiveSha256 !== recoveryProfile.archiveSha256 ||
    failed.status !== 'failed' ||
    failed.phase !== 'restored_flow_and_files' ||
    !failed.sessionsAndServerClosed
  )
    throw verificationError('RECOVERY_RECONCILE_EVIDENCE');
  const file = path.join(
    settings.directory,
    'storage-reconciliation-transaction-status.json',
  );
  const claim = await open(file, 'wx', 0o600);
  await claim.close();
  const status = {
    status: 'running',
    startedAt: new Date().toISOString(),
    projectRef: recoveryProfile.projectRef,
    sourceProjectRef: recoveryProfile.sourceProjectRef,
    archiveSha256: recoveryProfile.archiveSha256,
    syntheticOnly: true,
    sourceNetworkRequests: 0,
    sourceWrites: 0,
    changedFields: ['wire.uploaded'],
    verifiedFiles: 0,
    verifiedBytes: 0,
    updatedRows: 0,
  };
  let sql;
  const snapshot = () =>
    sql.begin('isolation level repeatable read read only', async (tx) => {
      await prepareSnapshot(tx);
      await assertBackupMarker(tx, backupTarget('verification'));
      return {
        fingerprint: await fingerprintSupabaseDatabase(tx, {
          expectedTableCount: 39,
        }),
        links: await readBackupStorageLinks(tx),
        rows: await tx`SELECT object_key, revision, physical_path, wire FROM partner_hub.storage_object_versions ORDER BY object_key, revision`,
      };
    });
  try {
    const connection = recoveryConnection(settings.config, binding);
    sql = postgres(connection.url, {
      ssl: 'require',
      max: 1,
      prepare: false,
      onnotice: false,
      fetch_types: false,
      connect_timeout: 15,
    });
    const before = await snapshot();
    if (before.rows.length !== 7)
      throw verificationError('RECOVERY_RECONCILE_COUNT');
    // Dynamic import uses the real local TypeScript loader, not test mocks.
    const { createSupabaseStorageHttp } =
      await import('../lib/supabase-storage-http.ts');
    const { parseR2Object } = await import('../lib/r2-http-protocol.ts');
    const storage = createSupabaseStorageHttp(settings.config);
    const updates = [];
    for (const row of before.rows) {
      assertRecoveryConfig(settings.config, binding);
      const wire = parseR2Object(JSON.parse(row.wire), row.object_key);
      const actual = await storage.head(row.physical_path);
      if (!actual) throw verificationError('RECOVERY_RECONCILE_MISSING');
      const bytes = Buffer.from(
        await new Response(
          await storage.get(actual, wire.checksums.sha256),
        ).arrayBuffer(),
      );
      try {
        const replacement = reconcileRecoveryWire(row, actual, bytes);
        if (actual.uploaded === wire.uploaded)
          throw verificationError('RECOVERY_RECONCILE_ALREADY_CHANGED');
        updates.push({ ...row, replacement, actual });
        status.verifiedFiles++;
        status.verifiedBytes += bytes.length;
      } finally {
        bytes.fill(0);
      }
    }
    if (status.verifiedBytes !== 55817383)
      throw verificationError('RECOVERY_RECONCILE_BYTES');
    // Final provider identity check before any DB write.
    for (const update of updates) {
      const actual = await storage.head(update.physical_path);
      if (JSON.stringify(actual) !== JSON.stringify(update.actual))
        throw verificationError('RECOVERY_RECONCILE_STORAGE_CHANGED');
    }
    assertRecoveryConfig(settings.config, binding);
    await sql.begin(async (tx) => {
      await tx`SET LOCAL lock_timeout = '10s'`;
      await tx`SET LOCAL statement_timeout = '30s'`;
      // Offline restore maintenance only. The exclusive lock keeps other
      // sessions from observing the temporarily suspended immutable trigger.
      // DDL and all seven updates roll back together on any failure.
      await tx`LOCK TABLE partner_hub.storage_object_versions IN ACCESS EXCLUSIVE MODE`;
      const guards = await tx`SELECT t.tgenabled, t.tgtype, p.proname, n.nspname
        FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE t.tgrelid = 'partner_hub.storage_object_versions'::regclass
        AND t.tgname = 'storage_object_versions_immutable' AND NOT t.tgisinternal`;
      if (
        guards.length !== 1 ||
        guards[0].tgenabled !== 'O' ||
        guards[0].tgtype !== 27 ||
        guards[0].proname !== 'reject_storage_version_mutation' ||
        guards[0].nspname !== 'partner_hub'
      )
        throw verificationError('RECOVERY_RECONCILE_TRIGGER');
      await tx`ALTER TABLE partner_hub.storage_object_versions DISABLE TRIGGER storage_object_versions_immutable`;
      for (const update of updates) {
        const rows =
          await tx`UPDATE partner_hub.storage_object_versions SET wire = ${update.replacement}
          WHERE object_key = ${update.object_key} AND revision = ${update.revision}
          AND physical_path = ${update.physical_path} AND wire = ${update.wire} RETURNING revision`;
        if (rows.length !== 1)
          throw verificationError('RECOVERY_RECONCILE_CONFLICT');
      }
      await tx`ALTER TABLE partner_hub.storage_object_versions ENABLE TRIGGER storage_object_versions_immutable`;
      const [guard] = await tx`SELECT tgenabled FROM pg_trigger
        WHERE tgrelid = 'partner_hub.storage_object_versions'::regclass
        AND tgname = 'storage_object_versions_immutable'`;
      if (guard?.tgenabled !== 'O')
        throw verificationError('RECOVERY_RECONCILE_TRIGGER_RESTORE');
    });
    status.updatedRows = updates.length;
    const after = await snapshot();
    const differences = compareSupabaseFingerprints(
      before.fingerprint,
      after.fingerprint,
    ).differences;
    if (
      differences.length !== 1 ||
      differences[0].kind !== 'table-content' ||
      differences[0].table !== 'storage_object_versions' ||
      JSON.stringify(before.links) !== JSON.stringify(after.links) ||
      after.rows.some(
        (row, index) =>
          row.wire !== updates[index].replacement ||
          row.object_key !== updates[index].object_key ||
          row.revision !== updates[index].revision ||
          row.physical_path !== updates[index].physical_path,
      )
    )
      throw verificationError('RECOVERY_RECONCILE_PRESERVATION');
    status.otherTablesAndSchemaEqual = true;
    status.linksAndChecksumsEqual = true;
    status.immutableTriggerRestoredInSameTransaction = true;
    status.status = 'passed';
    status.completedAt = new Date().toISOString();
  } catch (error) {
    status.status = 'failed';
    status.error = error.verificationCode ?? 'RECOVERY_RECONCILE_FAILED';
    if (/^[0-9A-Z]{5}$/.test(error.code ?? ''))
      status.databaseErrorCode = error.code;
  } finally {
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
      error: error.verificationCode ?? 'RECOVERY_RECONCILE_FAILED',
    }),
  );
  process.exitCode = 1;
});
