import {
  backupTarget,
  assertBackupPayload,
} from './supabase-backup-target.mjs';
import { hashBackupBytes } from './supabase-backup-archive.mjs';
import { verificationError } from './supabase-verification-policy.mjs';

// The only approved destination, observed in the dashboard after user creation.
// Never accept a destination supplied by an archive, environment or CLI flag.
export const recoveryProfile = Object.freeze({
  projectRef: 'fkbxfdowgazmqoqykwyc',
  projectName: 'partner-hub-recovery-20261015',
  sourceProjectRef: 'oaqodendjnztzcqaahaq',
  archiveSha256:
    '97fb9424bf7fef79e5c87c93009ed210b46d1775c6a46e381a640f868f74c5cf',
  databaseHost: 'aws-0-ap-southeast-1.pooler.supabase.com',
  storageBucket: 'partner-hub-verification-private',
  appOrigin: 'https://127.0.0.1:3443',
});
const require = (condition, code) => {
  if (!condition) throw verificationError(`RECOVERY_${code}`);
};

export function assertRecoveryConfig(config, binding) {
  let url;
  try {
    url = new URL(config.databaseUrl);
  } catch {
    throw verificationError('RECOVERY_DESTINATION');
  }
  require(config.projectRef === recoveryProfile.projectRef &&
    config.supabaseUrl ===
      `https://${recoveryProfile.projectRef}.supabase.co` &&
    config.appOrigin === recoveryProfile.appOrigin &&
    config.storageBucket === recoveryProfile.storageBucket &&
    ['postgres:', 'postgresql:'].includes(url.protocol) &&
    decodeURIComponent(url.username) ===
      `postgres.${recoveryProfile.projectRef}` &&
    url.hostname === recoveryProfile.databaseHost &&
    url.port === '6543' &&
    url.pathname === '/postgres' &&
    url.password &&
    !url.search &&
    !url.hash, 'DESTINATION');
  require(binding?.purpose === 'partner-hub-synthetic-recovery' &&
    binding.projectName === recoveryProfile.projectName &&
    binding.sourceProjectRef === recoveryProfile.sourceProjectRef &&
    binding.archiveSha256 === recoveryProfile.archiveSha256 &&
    binding.databaseHost === recoveryProfile.databaseHost, 'BINDING');
}

export function recoveryObjectPath(value) {
  require(typeof value === 'string' &&
    value.startsWith('partner-hub/') &&
    value.length <= 1024 &&
    /^[A-Za-z0-9_./-]+$/.test(value) &&
    value
      .split('/')
      .every((part) => part && part !== '.' && part !== '..'), 'OBJECT_PATH');
  return value.split('/').map(encodeURIComponent).join('/');
}

// Recovery can change the provider timestamp, never an object's content or
// logical identity. A changed ETag needs a separately reviewed migration.
export function reconcileRecoveryWire(row, actual, bytes) {
  const wire = JSON.parse(row.wire);
  require(actual &&
    wire.key === row.object_key &&
    wire.version === row.revision &&
    row.physical_path === `partner-hub/objects/v1/${row.revision}` &&
    actual.path === row.physical_path &&
    actual.size === wire.size &&
    bytes.length === wire.size &&
    actual.etag === wire.httpEtag &&
    wire.httpEtag === `"${wire.etag}"` &&
    hashBackupBytes(bytes) === wire.checksums?.sha256 &&
    actual.contentType === 'application/octet-stream' &&
    typeof actual.uploaded === 'string' &&
    Number.isFinite(Date.parse(actual.uploaded)) &&
    new Date(actual.uploaded).toISOString() ===
      actual.uploaded, 'RECONCILIATION_IDENTITY');
  return JSON.stringify({ ...wire, uploaded: actual.uploaded });
}

export function assertRecoveryPayload(payload, archiveHash) {
  require(archiveHash === recoveryProfile.archiveSha256, 'ARCHIVE_IDENTITY');
  assertBackupPayload(payload, backupTarget('verification'));
  const dump = Buffer.from(payload.database.bytesBase64, 'base64');
  require(dump.toString('base64') === payload.database.bytesBase64 &&
    dump.subarray(0, 5).toString() === 'PGDMP' &&
    hashBackupBytes(dump) === payload.database.sha256 &&
    payload.database.fingerprint.tables.length === 39 &&
    payload.database.fingerprint.totalRows === 108, 'DUMP');
  require(Array.isArray(payload.storage.objects) &&
    payload.storage.objects.length === 14, 'OBJECTS');
  let total = 0;
  const seen = new Set();
  for (const object of payload.storage.objects) {
    recoveryObjectPath(object.path);
    require(!seen.has(object.path), 'DUPLICATE_OBJECT');
    seen.add(object.path);
    const bytes = Buffer.from(object.bytesBase64, 'base64');
    try {
      require(bytes.toString('base64') === object.bytesBase64 &&
        bytes.length <= 26214400 &&
        bytes.length === object.size &&
        hashBackupBytes(bytes) === object.sha256, 'OBJECT_BYTES');
      total += bytes.length;
    } finally {
      bytes.fill(0);
    }
  }
  require(total === 111634766 &&
    total === payload.storage.totalBytes, 'TOTAL_BYTES');
  return dump;
}

export function assertRecoveryEmpty(value) {
  require(value?.schemaPresent === false &&
    value.publicTables === 0 &&
    value.authUsers === 0 &&
    value.storageBuckets === 0 &&
    value.storageObjects === 0, 'DESTINATION_NOT_EMPTY');
}

// New Storage object IDs/timestamps are expected; compare logical paths and bytes.
export function compareRecoveredObjects(original, restored) {
  require(original.objects.length === restored.objects.length &&
    original.totalBytes === restored.totalBytes, 'STORAGE_DIFFERENT');
  const objects = new Map(
    restored.objects.map((object) => [object.path, object]),
  );
  require(objects.size === restored.objects.length, 'STORAGE_DIFFERENT');
  for (const before of original.objects) {
    const after = objects.get(before.path);
    require(after?.sha256 === before.sha256 &&
      after.size === before.size, 'STORAGE_DIFFERENT');
  }
}
