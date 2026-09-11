// Daily operator backup. No retention deletion, remote restore or external upload.
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  writeFile,
  rename,
  readdir,
  lstat,
  realpath,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createBackup,
  verifyBackup,
  withBackupSignals,
} from './supabase-backup.mjs';
import { openBackup, hashBackupBytes } from './supabase-backup-archive.mjs';
import {
  BACKUP_LIMIT,
  defaultBackupRoots,
  protectPrivateDirectory,
  isWithin,
  assertSeparateRoots,
  failBackup,
  checkBackupAbort,
} from './supabase-backup-runtime.mjs';
import {
  backupDay,
  summarizeRetention,
  validateScheduledSuccess,
  safeScheduledError,
} from './supabase-backup-schedule-policy.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const recordName = /^run-[0-9a-f-]{36}\.json$/;
const maxRecordBytes = 32_768;

async function regularFile(file, limit) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit)
    throw failBackup('backup-scheduled-file-invalid');
  return info;
}

async function readRecord(file) {
  await regularFile(file, maxRecordBytes);
  return JSON.parse(await readFile(file, 'utf8'));
}

async function releaseLock(lockFile, owner) {
  const held = await readRecord(lockFile);
  if (held.owner !== owner)
    throw failBackup('backup-scheduled-lock-owner-mismatch');
  await rm(lockFile);
}

async function saveRecord(file, value) {
  const bytes = json(value);
  if (Buffer.byteLength(bytes) > maxRecordBytes)
    throw failBackup('backup-scheduled-record-limit');
  const temporary = file + '.' + randomUUID() + '.partial';
  await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
  await rename(temporary, file);
}

async function controlDirectory(
  backupRoot,
  { protect = protectPrivateDirectory } = {},
) {
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  if ((await lstat(backupRoot)).isSymbolicLink())
    throw failBackup('backup-scheduled-root-link');
  const resolved = await realpath(backupRoot);
  if (isWithin(await realpath(projectRoot), resolved))
    throw failBackup('backup-path-inside-workspace');
  for (const synced of [
    process.env.OneDrive,
    process.env.OneDriveCommercial,
    process.env.OneDriveConsumer,
  ].filter(Boolean))
    if (
      isWithin(
        await realpath(synced).catch(() => path.resolve(synced)),
        resolved,
      )
    )
      throw failBackup('backup-path-inside-synced-folder');
  const directory = path.join(resolved, 'schedule');
  await mkdir(directory, { mode: 0o700 }).catch((error) => {
    if (error.code !== 'EEXIST') throw error;
  });
  if (
    (await lstat(directory)).isSymbolicLink() ||
    (await realpath(directory)) !== directory
  )
    throw failBackup('backup-scheduled-control-link');
  await protect(directory);
  return directory;
}

async function records(directory) {
  const names = (await readdir(directory)).filter((name) =>
    recordName.test(name),
  );
  if (names.length > 10_000) throw failBackup('backup-scheduled-record-limit');
  const runs = [];
  for (const name of names) {
    const record = await readRecord(path.join(directory, name));
    if (
      !['running', 'failed', 'verified', 'revalidated'].includes(
        record.status,
      ) ||
      !Number.isFinite(Date.parse(record.startedAt))
    )
      throw failBackup('backup-scheduled-record-invalid');
    runs.push(record);
  }
  return runs.sort((left, right) =>
    left.startedAt.localeCompare(right.startedAt),
  );
}

function statusSummary(runs, now, locked) {
  const lastAttempt = runs.at(-1) ?? null;
  const lastSuccess =
    runs.filter((run) => run.status === 'verified').at(-1) ?? null;
  const ageHours = lastSuccess
    ? (now.getTime() - Date.parse(lastSuccess.completedAt)) / 3_600_000
    : null;
  const health =
    locked || lastAttempt?.status === 'running'
      ? 'run-incomplete'
      : lastAttempt?.status === 'failed'
        ? 'last-run-failed'
        : !lastSuccess
          ? 'needs-first-run'
          : !Number.isFinite(ageHours) || ageHours < 0 || ageHours > 36
            ? 'backup-overdue'
            : 'healthy';
  return {
    status: 'backup-schedule-status',
    health,
    checkedAt: now.toISOString(),
    timeZone: 'Asia/Seoul',
    lastAttempt: publicRun(lastAttempt),
    lastSuccess: publicRun(lastSuccess),
    ageHours,
    retention: {
      ...summarizeRetention(runs, now),
      inventoryScope: 'scheduled-run-history',
      artifactChecks: 'latest-success-only',
    },
    externalBackupCopyVerified: false,
    separateDeviceKeyCopyVerified: false,
    schedulingManagedBy:
      'Codex thread heartbeat; inspect automation separately',
  };
}

function publicRun(run) {
  if (!run) return null;
  return {
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    failedAt: run.failedAt,
    error: run.error
      ? safeScheduledError({ backupCode: run.error })
      : undefined,
    phase: run.phase,
    archiveSha256: run.archiveSha256,
    databaseTables: run.databaseTables,
    databaseRows: run.databaseRows,
    storageObjects: run.storageObjects,
    storageBytes: run.storageBytes,
    localRestorePlaintextRemoved: run.localRestorePlaintextRemoved,
  };
}

async function validateStoredBackup(run, backupRoot, keyRoot) {
  const created = run.creation;
  const verified = run.verification;
  const checked = validateScheduledSuccess(created, verified);
  if (
    run.archiveSha256 !== checked.archiveSha256 ||
    run.completedAt !== checked.completedAt
  )
    throw failBackup('backup-scheduled-record-invalid');
  const archive = await realpath(created.archiveFile);
  const key = await realpath(created.keyFile);
  if (
    !isWithin(await realpath(backupRoot), archive) ||
    !isWithin(await realpath(keyRoot), key)
  )
    throw failBackup('backup-scheduled-record-path-invalid');
  await regularFile(archive, BACKUP_LIMIT);
  if ((await regularFile(key, 32)).size !== 32)
    throw failBackup('backup-scheduled-key-invalid');
  const bytes = await readFile(archive);
  if (hashBackupBytes(bytes) !== checked.archiveSha256)
    throw failBackup('backup-scheduled-archive-changed');
  const keyBytes = await readFile(key);
  try {
    const payload = openBackup(bytes, keyBytes);
    if (
      payload.source?.projectRef !== checked.source.projectRef ||
      payload.source?.appOrigin !== checked.source.appOrigin ||
      payload.source?.commit !== checked.source.commit
    )
      throw failBackup('backup-scheduled-source-mismatch');
  } finally {
    keyBytes.fill(0);
  }
}

export async function scheduledBackup(
  { command, pgBin, backupRoot, keyRoot },
  dependencies = {},
) {
  const now = dependencies.now ?? (() => new Date());
  const create = dependencies.create ?? createBackup;
  const verify = dependencies.verify ?? verifyBackup;
  const validateStored = dependencies.validateStored ?? validateStoredBackup;
  assertSeparateRoots(backupRoot, keyRoot);
  const directory = await controlDirectory(backupRoot, dependencies);
  const lockFile = path.join(directory, 'active.lock');
  const isLocked = () =>
    lstat(lockFile).then(
      () => true,
      (error) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      },
    );
  if (command === 'status') {
    const runs = await records(directory);
    const latest = runs.filter((run) => run.status === 'verified').at(-1);
    if (latest) await validateStored(latest, backupRoot, keyRoot);
    return statusSummary(runs, now(), await isLocked());
  }
  if (command !== 'run' || !pgBin)
    throw failBackup('backup-scheduled-usage-invalid');
  const owner = randomUUID();
  let lock;
  try {
    lock = await open(lockFile, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST')
      throw failBackup('backup-scheduled-lock-present');
    throw error;
  }
  let run;
  let runFile;
  try {
    await lock.writeFile(
      json({ owner, pid: process.pid, startedAt: now().toISOString() }),
    );
    await lock.close();
    lock = null;
    const previous = await records(directory);
    const today = backupDay(now());
    const duplicate = previous
      .filter(
        (item) =>
          item.status === 'verified' &&
          backupDay(new Date(item.completedAt)) === today,
      )
      .at(-1);
    if (duplicate) {
      await validateStored(duplicate, backupRoot, keyRoot);
      runFile = path.join(directory, 'run-' + randomUUID() + '.json');
      run = {
        status: 'revalidated',
        startedAt: now().toISOString(),
        completedAt: now().toISOString(),
        archiveSha256: duplicate.archiveSha256,
        phase: 'existing-backup-checked',
      };
      await saveRecord(runFile, run);
      return {
        status: 'already-verified-today',
        backupDay: today,
        archiveSha256: duplicate.archiveSha256,
        completedAt: duplicate.completedAt,
      };
    }
    run = {
      status: 'running',
      startedAt: now().toISOString(),
      backupDay: today,
      phase: 'creating',
    };
    runFile = path.join(directory, 'run-' + randomUUID() + '.json');
    await saveRecord(runFile, run);
    checkBackupAbort();
    const created = await create(
      ['--pg-bin', pgBin, '--backup-dir', backupRoot, '--key-dir', keyRoot],
      { reportResult: false },
    );
    run = { ...run, phase: 'verifying', creation: created };
    await saveRecord(runFile, run);
    checkBackupAbort();
    const verified = await verify(
      [
        '--pg-bin',
        pgBin,
        '--archive',
        created.archiveFile,
        '--key-file',
        created.keyFile,
      ],
      { reportResult: false },
    );
    const success = validateScheduledSuccess(created, verified);
    run = { ...run, ...success, phase: 'complete', verification: verified };
    await saveRecord(runFile, run);
    return {
      ...statusSummary([...previous, run], now(), false),
      status: 'verified-scheduled-backup',
      runFile,
    };
  } catch (error) {
    runFile ??= path.join(directory, 'run-' + randomUUID() + '.json');
    run = {
      startedAt: now().toISOString(),
      phase: 'checking-existing-backup',
      ...run,
      status: 'failed',
      failedAt: now().toISOString(),
      error: safeScheduledError(error),
    };
    await saveRecord(runFile, run);
    throw error;
  } finally {
    await lock?.close();
    // Never evict a stale or foreign lock. A crash requires operator inspection.
    await releaseLock(lockFile, owner);
  }
}

async function main() {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === '--help') {
      console.log(
        'run --pg-bin <PostgreSQL17/bin> | status\nUses default local backup roots. Daily deduplication uses Asia/Seoul. Retention inventory only; no deletion or external upload.',
      );
      return;
    }
    if (
      !['run', 'status'].includes(command) ||
      (command === 'run'
        ? args.length !== 2 ||
          args[0] !== '--pg-bin' ||
          !path.isAbsolute(args[1])
        : args.length !== 0)
    )
      throw failBackup('backup-scheduled-usage-invalid');
    const report = await scheduledBackup({
      command,
      pgBin: args[1],
      ...defaultBackupRoots(),
    });
    console.log(json(report));
    if (command === 'status' && report.health !== 'healthy')
      process.exitCode = 1;
  } catch (error) {
    console.error(json({ status: 'failed', error: safeScheduledError(error) }));
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await withBackupSignals(main);
