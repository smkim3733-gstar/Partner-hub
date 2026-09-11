import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

// Read-only Storage API contract, checked against official sources 2026-09-11:
// https://supabase.com/docs/reference/javascript/file-buckets-list
// https://github.com/supabase/storage-js/blob/main/src/packages/StorageFileApi.ts
// Folder entries have null id/metadata; list is a read-only POST with pagination.
// No bucket creation, upload, signed URL, update or delete operation exists here.
export const supabaseBackupStorageLimits = Object.freeze({
  pageSize: 100,
  maxObjects: 10_000,
  maxDirectories: 2_000,
  maxPages: 5_000,
  maxDepth: 32,
  maxPathBytes: 1_024,
  maxObjectBytes: 25 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxInventoryBytes: 16 * 1024 * 1024,
  maxJsonBytes: 1024 * 1024,
  requestTimeoutMs: 120_000,
  totalTimeoutMs: 15 * 60_000,
});

const failureCodes = new Set([
  'SUPABASE_BACKUP_STORAGE_INVALID_CONFIG',
  'SUPABASE_BACKUP_STORAGE_FAILED',
  'SUPABASE_BACKUP_STORAGE_CHANGED',
  'SUPABASE_BACKUP_STORAGE_LIMIT_EXCEEDED',
]);
/** @returns {never} */
function fail(code = 'SUPABASE_BACKUP_STORAGE_FAILED') {
  throw new Error(code);
}
const record = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = (value) =>
  JSON.stringify(value, function (_key, item) {
    return record(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item;
  });
const digest = (value) => createHash('sha256').update(value).digest('hex');
const date = (value) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const uuid = (value) =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const etag = (value) =>
  typeof value === 'string' && /^"[^"\r\n]{1,256}"$/.test(value);

function settings(config, overrides) {
  if (
    !record(config) ||
    !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(config.supabaseUrl) ||
    !/^sb_secret_[A-Za-z0-9_-]{16,512}$/.test(config.secretKey) ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(config.storageBucket) ||
    !record(overrides)
  )
    fail('SUPABASE_BACKUP_STORAGE_INVALID_CONFIG');
  for (const [key, value] of Object.entries(overrides)) {
    if (
      !Object.hasOwn(supabaseBackupStorageLimits, key) ||
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > supabaseBackupStorageLimits[key]
    )
      fail('SUPABASE_BACKUP_STORAGE_INVALID_CONFIG');
  }
  return { ...supabaseBackupStorageLimits, ...overrides };
}

/**
 * Snapshot one configured private bucket into an in-memory archive payload.
 * The caller must encrypt the result before persistence and must never log it.
 * Limits can be lowered, not raised. No runtime configuration/secrets are read.
 * Two inventory scans plus object version checks detect observed concurrent
 * changes; this is not an atomic transaction with the application's database.
 */
export async function snapshotSupabaseStorage(config, options = {}) {
  try {
    const limits = settings(config, options.limits ?? {});
    const fetcher = options.fetcher ?? fetch;
    if (typeof fetcher !== 'function')
      fail('SUPABASE_BACKUP_STORAGE_INVALID_CONFIG');
    const { supabaseUrl, secretKey, storageBucket } = config;
    const end = Date.now() + limits.totalTimeoutMs;
    const base = `${supabaseUrl}/storage/v1`;

    async function bounded(promise, deadline) {
      let timer;
      try {
        return await Promise.race([
          promise,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('SUPABASE_BACKUP_STORAGE_FAILED')),
              Math.max(0, deadline - Date.now()),
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    async function request(path, init = {}) {
      if (Date.now() >= end) fail();
      const deadline = Math.min(end, Date.now() + limits.requestTimeoutMs);
      const headers = new Headers(init.headers);
      headers.set('apikey', secretKey);
      const response = await bounded(
        fetcher(`${base}${path}`, {
          ...init,
          headers,
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        }),
        deadline,
      );
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => {});
        fail();
      }
      return { response, deadline };
    }
    async function bytes(reply, maxBytes) {
      const { response, deadline } = reply;
      const length = response.headers.get('content-length');
      if (
        length !== null &&
        (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > maxBytes)
      ) {
        await response.body?.cancel().catch(() => {});
        fail('SUPABASE_BACKUP_STORAGE_LIMIT_EXCEEDED');
      }
      if (!response.body) fail();
      const reader = response.body.getReader();
      let total = 0;
      const chunks = [];
      try {
        for (;;) {
          const part = await bounded(reader.read(), deadline);
          if (part.done) break;
          if (!(part.value instanceof Uint8Array)) fail();
          total += part.value.byteLength;
          if (total > maxBytes) fail('SUPABASE_BACKUP_STORAGE_LIMIT_EXCEEDED');
          chunks.push(Buffer.from(part.value));
        }
        if (length !== null && Number(length) !== total) fail();
        return Buffer.concat(chunks, total);
      } catch (error) {
        void reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader.releaseLock();
        for (const chunk of chunks) chunk.fill(0);
      }
    }
    async function json(path, init) {
      const body = await bytes(await request(path, init), limits.maxJsonBytes);
      try {
        return JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(body),
        );
      } finally {
        body.fill(0);
      }
    }
    function validatePath(path) {
      if (
        typeof path !== 'string' ||
        !path ||
        path.includes('\\') ||
        Array.from(path).some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ) ||
        path
          .split('/')
          .some((part) => !part || part === '.' || part === '..') ||
        path.split('/').length > limits.maxDepth ||
        Buffer.byteLength(path) > limits.maxPathBytes
      )
        fail();
    }
    function objectRoute(path, info = false) {
      validatePath(path);
      const encoded = path.split('/').map(encodeURIComponent).join('/');
      return `/object/${info ? 'info/' : ''}authenticated/${storageBucket}/${encoded}`;
    }
    async function bucket() {
      const value = await json(`/bucket/${storageBucket}`);
      if (
        !record(value) ||
        value.id !== storageBucket ||
        value.name !== storageBucket ||
        value.public !== false ||
        !Number.isSafeInteger(value.file_size_limit) ||
        value.file_size_limit <= 0 ||
        value.file_size_limit > limits.maxObjectBytes ||
        !Array.isArray(value.allowed_mime_types) ||
        value.allowed_mime_types.length !== 1 ||
        value.allowed_mime_types[0] !== 'application/octet-stream'
      )
        fail();
      return value;
    }
    async function inventory() {
      const directories = [''];
      const entries = new Map();
      const ids = new Set();
      let pageCount = 0;
      let totalBytes = 0;
      let inventoryBytes = 0;
      const files = [];
      for (let index = 0; index < directories.length; index++) {
        const prefix = directories[index];
        let offset = 0;
        for (;;) {
          if (++pageCount > limits.maxPages)
            fail('SUPABASE_BACKUP_STORAGE_LIMIT_EXCEEDED');
          const page = await json(`/object/list/${storageBucket}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              prefix,
              limit: limits.pageSize,
              offset,
              sortBy: { column: 'name', order: 'asc' },
            }),
          });
          if (!Array.isArray(page) || page.length > limits.pageSize) fail();
          if (page.length === 0) break;
          for (const item of page) {
            if (
              !record(item) ||
              typeof item.name !== 'string' ||
              item.name.includes('/')
            )
              fail();
            const path = prefix ? `${prefix}/${item.name}` : item.name;
            validatePath(path);
            if (entries.has(path)) fail('SUPABASE_BACKUP_STORAGE_CHANGED');
            // Access timestamps may change because this backup downloads files.
            // Preserve the first value in the archive but omit it from equality.
            const stable = { ...item, path };
            delete stable.last_accessed_at;
            const serialized = canonical(stable);
            inventoryBytes += Buffer.byteLength(serialized);
            if (inventoryBytes > limits.maxInventoryBytes)
              fail('SUPABASE_BACKUP_STORAGE_LIMIT_EXCEEDED');
            entries.set(path, serialized);
            if (item.id === null) {
              if (
                item.metadata !== null ||
                item.created_at !== null ||
                item.updated_at !== null ||
                item.last_accessed_at !== null
              )
                fail();
              directories.push(path);
              if (directories.length > limits.maxDirectories)
                fail('SUPABASE_BACKUP_STORAGE_LIMIT_EXCEEDED');
            } else {
              if (
                !uuid(item.id) ||
                ids.has(item.id) ||
                !date(item.created_at) ||
                !date(item.updated_at) ||
                !record(item.metadata) ||
                !Number.isSafeInteger(item.metadata.size) ||
                item.metadata.size < 0 ||
                item.metadata.size > limits.maxObjectBytes ||
                !etag(item.metadata.eTag) ||
                item.metadata.mimetype !== 'application/octet-stream'
              )
                fail();
              ids.add(item.id);
              totalBytes += item.metadata.size;
              files.push({ ...item, path });
              if (
                files.length > limits.maxObjects ||
                totalBytes > limits.maxTotalBytes
              )
                fail('SUPABASE_BACKUP_STORAGE_LIMIT_EXCEEDED');
            }
          }
          // Continue to an empty page even if a provider returns a short page.
          offset += page.length;
        }
      }
      files.sort((left, right) =>
        left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
      );
      return {
        files,
        totalBytes,
        fingerprint: digest(
          canonical(
            [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
          ),
        ),
      };
    }
    async function info(file) {
      const value = await json(objectRoute(file.path, true));
      if (
        !record(value) ||
        value.id !== file.id ||
        value.name !== file.path ||
        value.bucket_id !== storageBucket ||
        value.size !== file.metadata.size ||
        value.etag !== file.metadata.eTag ||
        value.content_type !== 'application/octet-stream' ||
        !date(value.last_modified) ||
        !date(value.created_at) ||
        !record(value.metadata) ||
        typeof value.version !== 'string' ||
        !value.version ||
        value.version.length > 256
      )
        fail('SUPABASE_BACKUP_STORAGE_CHANGED');
      return value;
    }

    const firstBucket = await bucket();
    const first = await inventory();
    const objects = [];
    let metadataBytes = 0;
    for (const file of first.files) {
      const before = await info(file);
      const reply = await request(objectRoute(file.path), {
        headers: { 'if-match': before.etag, 'accept-encoding': 'identity' },
      });
      const headers = reply.response.headers;
      if (
        headers.get('etag') !== before.etag ||
        headers.get('content-length') !== String(before.size) ||
        headers.get('content-type') !== before.content_type ||
        (headers.get('content-encoding') ?? 'identity') !== 'identity'
      ) {
        await reply.response.body?.cancel().catch(() => {});
        fail('SUPABASE_BACKUP_STORAGE_CHANGED');
      }
      const body = await bytes(reply, before.size);
      try {
        const after = await info(file);
        if (canonical(before) !== canonical(after))
          fail('SUPABASE_BACKUP_STORAGE_CHANGED');
        const metadata = { listing: file, info: before };
        metadataBytes += Buffer.byteLength(canonical(metadata));
        if (metadataBytes > limits.maxInventoryBytes)
          fail('SUPABASE_BACKUP_STORAGE_LIMIT_EXCEEDED');
        objects.push({
          path: file.path,
          id: file.id,
          size: body.length,
          sha256: digest(body),
          bytesBase64: body.toString('base64'),
          metadata,
        });
      } finally {
        body.fill(0);
      }
    }
    const last = await inventory();
    const lastBucket = await bucket();
    if (
      first.fingerprint !== last.fingerprint ||
      canonical(firstBucket) !== canonical(lastBucket)
    )
      fail('SUPABASE_BACKUP_STORAGE_CHANGED');
    return {
      version: 1,
      bucket: firstBucket,
      objects,
      totalBytes: first.totalBytes,
      inventorySha256: first.fingerprint,
    };
  } catch (error) {
    // Never forward provider URLs, request bodies, credentials or error text.
    fail(
      error instanceof Error && failureCodes.has(error.message)
        ? error.message
        : 'SUPABASE_BACKUP_STORAGE_FAILED',
    );
  }
}
