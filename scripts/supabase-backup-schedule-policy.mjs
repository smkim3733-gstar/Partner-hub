const projectRef = 'yievsveuxjnbygatvjtb';
const appOrigin = 'https://partner-hub-gamma-five.vercel.app';
const retentionDays = 30;
const retentionMilliseconds = retentionDays * 24 * 60 * 60 * 1000;
const record = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const checksum = (value) =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const linkFields = [
  'versionCount',
  'activeHeadCount',
  'tombstoneHeadCount',
  'matchedObjects',
  'extraObjects',
  'totalReferencedBytes',
];

function fail(code) {
  const error = new Error(code);
  error.backupCode = code;
  throw error;
}

function canonicalTime(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function clockTime(value) {
  const time =
    value instanceof Date
      ? value.getTime()
      : typeof value === 'number'
        ? value
        : canonicalTime(value)
          ? Date.parse(value)
          : NaN;
  if (
    !Number.isFinite(time) ||
    !Number.isSafeInteger(time) ||
    !Number.isFinite(new Date(time).getTime())
  )
    fail('backup-scheduled-clock-invalid');
  return time;
}

/** Stable calendar key for one daily run, independent of the machine timezone.
 * @param {unknown} [date]
 */
export function backupDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(clockTime(date)));
  const field = (type) => parts.find((part) => part.type === type)?.value;
  return `${field('year')}-${field('month')}-${field('day')}`;
}

/**
 * Inventory only. Old verified runs remain retained; nothing authorizes deletion.
 * Invalid/future success claims count as failures, never as usable backups.
 * @param {unknown} runs
 * @param {unknown} [now]
 */
export function summarizeRetention(runs, now = new Date()) {
  if (!Array.isArray(runs) || runs.length > 100_000)
    fail('backup-scheduled-inventory-invalid');
  const current = clockTime(now);
  let recentVerified = 0;
  let olderVerifiedRetained = 0;
  let failed = 0;
  for (const run of runs) {
    // Rechecking an existing archive is neither a new backup nor a failed run.
    if (record(run) && run.status === 'revalidated') continue;
    if (
      !record(run) ||
      run.status !== 'verified' ||
      !canonicalTime(run.completedAt) ||
      !checksum(run.archiveSha256) ||
      Date.parse(run.completedAt) > current
    ) {
      failed++;
      continue;
    }
    if (current - Date.parse(run.completedAt) <= retentionMilliseconds)
      recentVerified++;
    else olderVerifiedRetained++;
  }
  return {
    recentVerified,
    olderVerifiedRetained,
    failed,
    automaticDeletion: false,
    retentionDays,
  };
}

function validTarget(source) {
  return (
    record(source) &&
    source.projectRef === projectRef &&
    source.appOrigin === appOrigin &&
    source.schema === 'partner_hub' &&
    typeof source.commit === 'string' &&
    /^[a-f0-9]{40}$/.test(source.commit) &&
    typeof source.pgDumpVersion === 'string' &&
    /^pg_dump \(PostgreSQL\) 17\.\d+(?:[ .][A-Za-z0-9 ()._-]+)?$/.test(
      source.pgDumpVersion,
    )
  );
}

function validLinks(report) {
  const links = report.storageLinkCheck;
  return (
    record(links) &&
    linkFields.every((field) => count(links[field])) &&
    links.versionCount === links.matchedObjects &&
    links.matchedObjects + links.extraObjects === report.storageObjects &&
    links.activeHeadCount <= links.versionCount &&
    links.totalReferencedBytes <= report.storageBytes
  );
}

/** Require creation and completed local restore evidence for the SAME archive. */
export function validateScheduledSuccess(created, verified) {
  if (
    !record(created) ||
    !record(verified) ||
    created.status !== 'created-unverified' ||
    verified.status !== 'verified-local-postgresql' ||
    created.restoreVerified !== false
  )
    fail('backup-scheduled-status-invalid');
  if (
    !validTarget(created.source) ||
    !validTarget(verified.source) ||
    ['projectRef', 'appOrigin', 'schema', 'commit', 'pgDumpVersion'].some(
      (field) => created.source[field] !== verified.source[field],
    )
  ) {
    fail('backup-scheduled-target-mismatch');
  }
  if (
    !checksum(created.archiveSha256) ||
    created.archiveSha256 !== verified.archiveSha256
  ) {
    fail('backup-scheduled-archive-mismatch');
  }
  if (
    !canonicalTime(created.startedAt) ||
    !canonicalTime(created.completedAt) ||
    !canonicalTime(verified.verifiedAt) ||
    Date.parse(created.startedAt) > Date.parse(created.completedAt) ||
    Date.parse(created.completedAt) > Date.parse(verified.verifiedAt) ||
    Date.parse(verified.verifiedAt) > Date.now()
  )
    fail('backup-scheduled-time-invalid');
  for (const field of [
    'databaseTables',
    'databaseRows',
    'storageObjects',
    'storageBytes',
  ]) {
    if (!count(created[field]) || created[field] !== verified[field]) {
      fail('backup-scheduled-count-mismatch');
    }
  }
  if (
    created.databaseTables !== 38 ||
    created.databaseRows > 1_000_000 ||
    created.storageObjects > 10_000 ||
    created.storageBytes > 256 * 1024 * 1024 ||
    (created.storageObjects === 0 && created.storageBytes !== 0)
  ) {
    fail('backup-scheduled-count-mismatch');
  }
  if (
    !validLinks(created) ||
    !validLinks(verified) ||
    linkFields.some(
      (field) =>
        created.storageLinkCheck[field] !== verified.storageLinkCheck[field],
    )
  ) {
    fail('backup-scheduled-storage-links-mismatch');
  }
  if (
    created.sourceWrites !== 0 ||
    verified.sourceWrites !== 0 ||
    verified.schemaAndPermissionsEqual !== true ||
    verified.tableContentsEqual !== true ||
    verified.localRestorePlaintextRemoved !== true ||
    verified.remoteRestoreSupported !== false ||
    verified.supabaseStorageRestoreVerified !== false ||
    created.separateDeviceKeyCopyVerified !== false ||
    verified.separateDeviceKeyCopyVerified !== false
  )
    fail('backup-scheduled-verification-incomplete');
  const expectedStorageCheck =
    created.storageObjects === 0
      ? 'empty-inventory-verified-no-file-restore-claim'
      : 'local-byte-restore-verified';
  if (verified.storageCheck !== expectedStorageCheck)
    fail('backup-scheduled-storage-claim-invalid');
  return {
    status: 'verified',
    completedAt: verified.verifiedAt,
    archiveSha256: created.archiveSha256,
    source: {
      projectRef,
      appOrigin,
      schema: 'partner_hub',
      commit: created.source.commit,
    },
    databaseTables: created.databaseTables,
    databaseRows: created.databaseRows,
    storageObjects: created.storageObjects,
    storageBytes: created.storageBytes,
    storageCheck: expectedStorageCheck,
    sourceWrites: 0,
    schemaAndPermissionsEqual: true,
    tableContentsEqual: true,
    localRestorePlaintextRemoved: true,
    remoteRestoreSupported: false,
    supabaseStorageRestoreVerified: false,
    separateDeviceKeyCopyVerified: false,
  };
}

/** Only known, non-sensitive machine codes may reach scheduled reports. */
export function safeScheduledError(error) {
  if (
    typeof error?.backupCode === 'string' &&
    /^backup-[a-z0-9-]{1,100}$/.test(error.backupCode)
  ) {
    return error.backupCode;
  }
  if (
    error?.name === 'SupabaseFingerprintError' &&
    typeof error.code === 'string' &&
    /^[a-z][a-z-]{0,100}$/.test(error.code)
  )
    return error.code;
  if (
    /^(BACKUP_ARCHIVE_INVALID|SUPABASE_BACKUP_STORAGE_(INVALID_CONFIG|FAILED|CHANGED|LIMIT_EXCEEDED|LINKS_FAILED))$/.test(
      error?.message,
    )
  ) {
    return error.message;
  }
  return 'backup-failed-redacted';
}
