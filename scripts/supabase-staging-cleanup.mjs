// Expired direct-upload staging cleanup for the Supabase backend.
// Storage API contract (supabase/storage-api, checked 2026-10-24):
// POST /object/list/{bucket} lists one directory level with pagination,
// GET /object/info/authenticated/{bucket}/{path} reports one object and
// DELETE /object/{bucket}/{path} removes one object.
// Only exact `partner-hub/staging/v1/<uuid>` objects recorded in
// `supabase_file_transfers` whose retention plus grace has passed are removed.
// Final originals (`partner-hub/objects/v1/`) are never listed or touched.
// Transfer rows are immutable and stay as the reservation ledger.
export const supabaseStagingCleanupLimits = Object.freeze({
  pageSize: 100,
  maxScanned: 10_000,
  maxDeletes: 100,
  // retain_until already covers the two-hour provider signature, the signing
  // request timeout and clock margin. Add the same grace as the Blob cleanup.
  graceMs: 900_000,
  requestTimeoutMs: 30_000,
  maxJsonBytes: 1024 * 1024,
});

const stagingPrefix = 'partner-hub/staging/v1';
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const codes = new Set([
  'staging-config-invalid',
  'staging-bucket-unsafe',
  'staging-storage-failed',
  'staging-inventory-unexpected',
  'staging-ledger-invalid',
  'staging-delete-unconfirmed',
]);
export class StagingCleanupError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
/** @returns {never} */
function fail(code = 'staging-storage-failed') {
  throw new StagingCleanupError(code);
}
const record = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const time = (value) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? Date.parse(value)
    : fail('staging-inventory-unexpected');

function settings(overrides = {}) {
  if (!record(overrides)) fail('staging-config-invalid');
  for (const [key, value] of Object.entries(overrides)) {
    if (
      !Object.hasOwn(supabaseStagingCleanupLimits, key) ||
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      (key !== 'graceMs' && value > supabaseStagingCleanupLimits[key]) ||
      // Grace may be raised for caution, never lowered below the default.
      (key === 'graceMs' && value < supabaseStagingCleanupLimits.graceMs)
    )
      fail('staging-config-invalid');
  }
  return { ...supabaseStagingCleanupLimits, ...overrides };
}

/** Server-only Storage transport. Provider URLs, bodies and error text are
 * never returned to the caller; every failure becomes a fixed code. */
export function createStagingStorage(config, fetcher = fetch, overrides = {}) {
  const limits = settings(overrides);
  if (
    !record(config) ||
    !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(config.supabaseUrl) ||
    !/^sb_secret_[A-Za-z0-9_-]{16,512}$/.test(config.secretKey) ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(config.storageBucket) ||
    typeof fetcher !== 'function'
  )
    fail('staging-config-invalid');
  const { supabaseUrl, secretKey, storageBucket } = config;
  const base = `${supabaseUrl}/storage/v1`;
  async function request(path, init = {}) {
    try {
      const headers = new Headers(init.headers);
      headers.set('apikey', secretKey);
      return await fetcher(`${base}${path}`, {
        ...init,
        headers,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(limits.requestTimeoutMs),
      });
    } catch {
      return fail();
    }
  }
  async function json(response) {
    try {
      const length = response.headers.get('content-length');
      if (length !== null && Number(length) > limits.maxJsonBytes) fail();
      const text = await response.text();
      if (text.length > limits.maxJsonBytes) fail();
      return JSON.parse(text);
    } catch {
      return fail();
    }
  }
  const assertStagingPath = (path) =>
    typeof path === 'string' &&
    path.startsWith(`${stagingPrefix}/`) &&
    uuid.test(path.slice(stagingPrefix.length + 1))
      ? path
      : fail('staging-inventory-unexpected');
  return {
    async assertPrivateBucket() {
      const response = await request(`/bucket/${storageBucket}`);
      const value = await json(response);
      if (
        !response.ok ||
        !record(value) ||
        value.id !== storageBucket ||
        value.public !== false
      )
        fail('staging-bucket-unsafe');
    },
    async listPage(offset) {
      const response = await request(`/object/list/${storageBucket}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prefix: stagingPrefix,
          limit: limits.pageSize,
          offset,
          sortBy: { column: 'name', order: 'asc' },
        }),
      });
      const value = await json(response);
      if (
        !response.ok ||
        !Array.isArray(value) ||
        value.length > limits.pageSize
      )
        fail();
      return value;
    },
    /** @returns {Promise<{ size: number, lastModified: number } | null>} */
    async info(path) {
      assertStagingPath(path);
      const response = await request(
        `/object/info/authenticated/${storageBucket}/${path}`,
      );
      const value = await json(response);
      if (!response.ok) {
        // Permission failures and a missing bucket are not evidence of absence.
        if (
          [400, 404].includes(response.status) &&
          record(value) &&
          value.code === 'NoSuchKey'
        )
          return null;
        return fail();
      }
      if (
        !record(value) ||
        value.name !== path ||
        value.bucket_id !== storageBucket ||
        !Number.isSafeInteger(value.size) ||
        value.size < 0
      )
        fail();
      return { size: value.size, lastModified: time(value.last_modified) };
    },
    async remove(path) {
      assertStagingPath(path);
      const response = await request(`/object/${storageBucket}/${path}`, {
        method: 'DELETE',
      });
      // The outcome is confirmed by a fresh info read, never by this reply.
      await response.body?.cancel().catch(() => {});
    },
  };
}

function ledgerTime(value) {
  const text = typeof value === 'bigint' ? value.toString() : value;
  if (typeof text !== 'string' || !/^[1-9][0-9]{0,15}$/.test(text))
    fail('staging-ledger-invalid');
  const number = Number(text);
  if (!Number.isSafeInteger(number)) fail('staging-ledger-invalid');
  return number;
}

async function ledger(client, paths) {
  if (!paths.length) return new Map();
  const marks = paths.map((_, index) => `$${index + 1}`).join(',');
  const rows = await client.unsafe(
    `SELECT id, file_path, audio_path, retain_until::text AS retain_until
     FROM partner_hub.supabase_file_transfers
     WHERE file_path IN (${marks}) OR audio_path IN (${marks})`,
    paths,
  );
  const found = new Map();
  for (const row of rows) {
    if (!record(row) || typeof row.id !== 'string' || !uuid.test(row.id))
      fail('staging-ledger-invalid');
    const retainUntil = ledgerTime(row.retain_until);
    for (const path of [row.file_path, row.audio_path]) {
      if (path === null || !paths.includes(path)) continue;
      // file_path and audio_path are each unique, and never equal per row.
      if (found.has(path)) fail('staging-ledger-invalid');
      found.set(path, { transferId: row.id, retainUntil });
    }
  }
  return found;
}

/**
 * Classify every listed staging object, then optionally delete up to
 * `maxDeletes` expired ones. Unrecorded, still-retained or anomalous objects
 * are reported and kept. No automatic retry of an uncertain delete.
 * @param {{ client: { unsafe(query: string, values?: unknown[]): Promise<Record<string, unknown>[]> },
 *   storage: ReturnType<typeof createStagingStorage>, apply?: boolean,
 *   now?: () => number, limits?: Partial<typeof supabaseStagingCleanupLimits> }} options
 */
export async function runSupabaseStagingCleanup(options) {
  try {
    const limits = settings(options.limits ?? {});
    const now = options.now ?? Date.now;
    const { client, storage } = options;
    await storage.assertPrivateBucket();
    const report = {
      scanned: 0,
      expired: 0,
      retained: 0,
      unrecorded: 0,
      anomalous: 0,
      unrecognized: 0,
      truncated: false,
      deleted: 0,
      alreadyAbsent: 0,
      remaining: 0,
    };
    const candidates = [];
    const seen = new Set();
    const cutoff = () => now() - limits.graceMs;
    for (let offset = 0; ;) {
      if (report.scanned >= limits.maxScanned) {
        report.truncated = true;
        break;
      }
      const page = await storage.listPage(offset);
      if (!page.length) break;
      offset += page.length;
      const files = [];
      for (const item of page) {
        if (
          !record(item) ||
          typeof item.name !== 'string' ||
          !item.name ||
          item.name.includes('/')
        )
          fail('staging-inventory-unexpected');
        // The app only writes flat UUID objects here. A nested folder means
        // something else uses this prefix: stop rather than guess.
        if (item.id === null) fail('staging-inventory-unexpected');
        const path = `${stagingPrefix}/${item.name}`;
        if (seen.has(path)) fail('staging-inventory-unexpected');
        seen.add(path);
        report.scanned++;
        if (!uuid.test(item.name)) {
          report.unrecognized++;
          continue;
        }
        files.push({
          path,
          written: Math.max(time(item.created_at), time(item.updated_at)),
        });
      }
      const found = await ledger(
        client,
        files.map((file) => file.path),
      );
      for (const file of files) {
        const entry = found.get(file.path);
        if (!entry) report.unrecorded++;
        else if (entry.retainUntil > cutoff()) report.retained++;
        // No signature could have written after retention ended.
        else if (file.written > entry.retainUntil) report.anomalous++;
        else candidates.push({ ...file, ...entry });
      }
    }
    report.expired = candidates.length;
    report.remaining = candidates.length;
    if (!options.apply) return report;
    for (const candidate of candidates.slice(0, limits.maxDeletes)) {
      // Re-read the immutable ledger and the object right before deletion.
      const entry = (await ledger(client, [candidate.path])).get(
        candidate.path,
      );
      if (
        !entry ||
        entry.transferId !== candidate.transferId ||
        entry.retainUntil !== candidate.retainUntil ||
        entry.retainUntil > cutoff()
      )
        fail('staging-ledger-invalid');
      const before = await storage.info(candidate.path);
      report.remaining--;
      if (!before) {
        report.alreadyAbsent++;
        continue;
      }
      if (before.lastModified > entry.retainUntil) {
        report.anomalous++;
        continue;
      }
      await storage.remove(candidate.path);
      if ((await storage.info(candidate.path)) !== null)
        fail('staging-delete-unconfirmed');
      report.deleted++;
    }
    return report;
  } catch (error) {
    // Never forward provider URLs, SQL details, credentials or error text.
    fail(
      error instanceof StagingCleanupError && codes.has(error.code)
        ? error.code
        : 'staging-storage-failed',
    );
  }
}
