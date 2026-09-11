import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

const maximumCount = 10_000;
const maximumObjectBytes = 25 * 1024 * 1024;
const maximumTotalBytes = 256 * 1024 * 1024;
const record = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const revision = (value) =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
    value,
  );
const key = (value) =>
  typeof value === 'string' &&
  /^(?:(?:company-source|consulting-flow)\/)?[A-Za-z0-9_-]{1,200}$/.test(value);
const checksum = (value) =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const size = (value) =>
  Number.isSafeInteger(value) && value >= 0 && value <= maximumObjectBytes;
/** @returns {never} */
function fail() {
  // Never include logical keys, physical paths, payloads or database errors.
  throw new Error('SUPABASE_BACKUP_STORAGE_LINKS_FAILED');
}

function validateLinks(links) {
  if (
    !record(links) ||
    links.version !== 1 ||
    !Array.isArray(links.versions) ||
    !Array.isArray(links.heads) ||
    links.versions.length > maximumCount ||
    links.heads.length > maximumCount
  )
    fail();
  const versions = new Map();
  const paths = new Set();
  let totalBytes = 0;
  for (const item of links.versions) {
    if (
      !record(item) ||
      !key(item.objectKey) ||
      !revision(item.revision) ||
      item.path !== `partner-hub/objects/v1/${item.revision}` ||
      !size(item.size) ||
      !checksum(item.sha256)
    )
      fail();
    const id = `${item.objectKey}\n${item.revision}`;
    if (versions.has(id) || paths.has(item.path)) fail();
    versions.set(id, item);
    paths.add(item.path);
    totalBytes += item.size;
    if (totalBytes > maximumTotalBytes) fail();
  }
  const heads = new Set();
  let activeHeadCount = 0;
  for (const item of links.heads) {
    if (
      !record(item) ||
      !key(item.objectKey) ||
      !revision(item.revision) ||
      heads.has(item.objectKey)
    )
      fail();
    heads.add(item.objectKey);
    if (item.versionRevision !== null) {
      if (
        item.versionRevision !== item.revision ||
        !versions.has(`${item.objectKey}\n${item.versionRevision}`)
      )
        fail();
      activeHeadCount++;
    }
  }
  return { versions, paths, activeHeadCount, totalBytes };
}

/** Read only within the caller's consistent, read-only PostgreSQL transaction. */
export async function readBackupStorageLinks(sql) {
  try {
    const state = await sql.unsafe(
      "SELECT current_setting('transaction_read_only') AS read_only, current_setting('transaction_isolation') AS isolation",
    );
    if (
      !Array.isArray(state) ||
      state.length !== 1 ||
      state[0].read_only !== 'on' ||
      !['repeatable read', 'serializable'].includes(state[0].isolation)
    )
      fail();
    const counts = await sql.unsafe(`SELECT
      (SELECT count(*)::text FROM partner_hub.storage_object_versions) AS versions,
      (SELECT count(*)::text FROM partner_hub.storage_object_heads) AS heads`);
    if (!Array.isArray(counts) || counts.length !== 1) fail();
    for (const name of ['versions', 'heads']) {
      if (
        typeof counts[0][name] !== 'string' ||
        !/^(0|[1-9][0-9]*)$/.test(counts[0][name]) ||
        Number(counts[0][name]) > maximumCount
      )
        fail();
    }
    const links = { version: 1, versions: [], heads: [] };
    // Read the wire in bounded batches; retain only the required linkage fields.
    for (let offset = 0; offset < Number(counts[0].versions); offset += 100) {
      const rows = await sql.unsafe(
        `SELECT object_key, revision, physical_path, wire
        FROM partner_hub.storage_object_versions ORDER BY object_key, revision LIMIT 100 OFFSET $1`,
        [offset],
      );
      if (
        !Array.isArray(rows) ||
        rows.length !== Math.min(100, Number(counts[0].versions) - offset)
      )
        fail();
      for (const row of rows) {
        if (
          !record(row) ||
          typeof row.wire !== 'string' ||
          Buffer.byteLength(row.wire) > 16_384
        )
          fail();
        const wire = JSON.parse(row.wire);
        if (
          !record(wire) ||
          wire.key !== row.object_key ||
          wire.version !== row.revision ||
          !record(wire.checksums) ||
          !checksum(wire.checksums.sha256) ||
          !size(wire.size)
        )
          fail();
        links.versions.push({
          objectKey: row.object_key,
          revision: row.revision,
          path: row.physical_path,
          size: wire.size,
          sha256: wire.checksums.sha256,
        });
      }
    }
    const heads =
      await sql.unsafe(`SELECT object_key, revision, version_revision
      FROM partner_hub.storage_object_heads ORDER BY object_key LIMIT 10001`);
    if (!Array.isArray(heads) || heads.length !== Number(counts[0].heads))
      fail();
    links.heads = heads.map((row) => ({
      objectKey: row.object_key,
      revision: row.revision,
      versionRevision: row.version_revision,
    }));
    validateLinks(links);
    return links;
  } catch {
    fail();
  }
}

/**
 * Versions are immutable, including obsolete versions and deleted heads.
 * See 0002_storage_object_versions.sql and createSupabaseStorageManifest.remove.
 * Every retained version must have its original bytes in the bucket snapshot.
 * Unreferenced originals and staging files remain included in the backup.
 */
export function verifyBackupStorageLinks(links, storageSnapshot) {
  try {
    const expected = validateLinks(links);
    if (
      !record(storageSnapshot) ||
      storageSnapshot.version !== 1 ||
      !Array.isArray(storageSnapshot.objects) ||
      storageSnapshot.objects.length > maximumCount
    )
      fail();
    const objects = new Map();
    let totalBytes = 0;
    for (const object of storageSnapshot.objects) {
      if (
        !record(object) ||
        typeof object.path !== 'string' ||
        !object.path ||
        objects.has(object.path) ||
        !size(object.size) ||
        !checksum(object.sha256) ||
        typeof object.bytesBase64 !== 'string' ||
        object.bytesBase64.length > 4 * Math.ceil(maximumObjectBytes / 3)
      )
        fail();
      totalBytes += object.size;
      if (totalBytes > maximumTotalBytes) fail();
      const bytes = Buffer.from(object.bytesBase64, 'base64');
      try {
        if (
          bytes.length !== object.size ||
          bytes.toString('base64') !== object.bytesBase64 ||
          createHash('sha256').update(bytes).digest('hex') !== object.sha256
        )
          fail();
      } finally {
        bytes.fill(0);
      }
      objects.set(object.path, object);
    }
    if (storageSnapshot.totalBytes !== totalBytes) fail();
    for (const version of expected.versions.values()) {
      const object = objects.get(version.path);
      if (
        !object ||
        object.size !== version.size ||
        object.sha256 !== version.sha256
      )
        fail();
    }
    return {
      versionCount: links.versions.length,
      activeHeadCount: expected.activeHeadCount,
      tombstoneHeadCount: links.heads.length - expected.activeHeadCount,
      matchedObjects: links.versions.length,
      extraObjects: objects.size - links.versions.length,
      totalReferencedBytes: expected.totalBytes,
    };
  } catch {
    fail();
  }
}
