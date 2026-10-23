import './register-local.mjs';
import { readFile, writeFile, open } from 'node:fs/promises';
import path from 'node:path';
import { readVerificationFile } from './supabase-verification.mjs';
import { verificationError } from './supabase-verification-policy.mjs';
import { backupTarget, assertBackupSource } from './supabase-backup-target.mjs';
import {
  createBackup,
  verifyBackup,
  withBackupSignals,
} from './supabase-backup.mjs';

// Reuses the encrypted, read-only backup and temporary localhost restore.
// This entry point cannot select production or a remote restore destination.
async function main(args) {
  if (args.length !== 4 || args[0] !== '--config' || args[2] !== '--pg-bin')
    throw verificationError('ARGUMENTS');
  const settings = await readVerificationFile(args[1]);
  assertBackupSource(settings.config, backupTarget('verification'));
  const workflow = JSON.parse(
    await readFile(path.join(settings.directory, 'status.json'), 'utf8'),
  );
  if (workflow.status !== 'passed' || workflow.httpWorkflowVerified !== true)
    throw verificationError('HTTP_WORKFLOW_REQUIRED');
  const resultFile = path.join(settings.directory, 'backup-status.json');
  const claim = await open(resultFile, 'wx', 0o600);
  await claim.close();
  const status = {
    status: 'running',
    startedAt: new Date().toISOString(),
    projectRef: settings.target.projectRef,
    syntheticOnly: true,
    sourceWrites: 0,
  };
  const save = () =>
    writeFile(resultFile, JSON.stringify(status, null, 2) + '\n', {
      mode: 0o600,
    });
  try {
    await save();
    status.creation = await createBackup(['--pg-bin', args[3]], {
      scope: 'verification',
      sourceConfig: settings.config,
      reportResult: false,
    });
    await save();
    status.verification = await verifyBackup(
      [
        '--pg-bin',
        args[3],
        '--archive',
        status.creation.archiveFile,
        '--key-file',
        status.creation.keyFile,
      ],
      { scope: 'verification', reportResult: false },
    );
    status.status = 'passed';
    status.completedAt = new Date().toISOString();
    await save();
    console.log(
      JSON.stringify({
        status: status.status,
        projectRef: status.projectRef,
        databaseTables: status.verification.databaseTables,
        databaseRows: status.verification.databaseRows,
        storageObjects: status.verification.storageObjects,
        storageBytes: status.verification.storageBytes,
        schemaAndPermissionsEqual:
          status.verification.schemaAndPermissionsEqual,
        tableContentsEqual: status.verification.tableContentsEqual,
        storageCheck: status.verification.storageCheck,
        localRestorePlaintextRemoved:
          status.verification.localRestorePlaintextRemoved,
        supabaseStorageRestoreVerified: false,
        sourceWrites: 0,
      }),
    );
  } catch (error) {
    status.status = 'failed';
    status.error =
      error.backupCode ?? error.verificationCode ?? 'OPERATION_FAILED';
    await save();
    throw error;
  }
}

await withBackupSignals(() => main(process.argv.slice(2))).catch((error) => {
  console.error(
    JSON.stringify({
      status: 'failed',
      error: error.backupCode ?? error.verificationCode ?? 'OPERATION_FAILED',
    }),
  );
  process.exitCode = 1;
});
