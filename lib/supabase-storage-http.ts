import { createHash } from 'node:crypto';
import type { SupabaseBackendConfig } from './supabase-backend-config';
import { MAX_COMPANY_FILE_BYTES } from './company-file-policy';
import {
  guardedR2Body,
  r2HttpLimits,
  r2Record,
  readR2Bytes,
} from './r2-http-protocol';

export const supabaseStorageFailure = (): never => {
  throw new Error('SUPABASE_STORAGE_FAILED_OR_OUTCOME_UNKNOWN');
};
const uuid =
  '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const pathPattern = new RegExp(`^partner-hub/(objects|staging)/v1/${uuid}$`);
export function assertSupabaseObjectPath(path: string) {
  if (!pathPattern.test(path)) supabaseStorageFailure();
}
export type SupabaseStoredObject = {
  path: string;
  size: number;
  etag: string;
  contentType: string;
  uploaded: string;
};
type StorageConfig = Pick<
  SupabaseBackendConfig,
  'supabaseUrl' | 'secretKey' | 'storageBucket'
>;

/** Server-owned transport. No provider URL, header, error or credential is
 * accepted from a browser. Physical objects are create-only; PostgreSQL owns
 * the logical object CAS. No automatic retries of writes with unknown results. */
export function createSupabaseStorageHttp(
  config: StorageConfig,
  fetcher: typeof fetch = fetch,
) {
  const { supabaseUrl, secretKey, storageBucket } = config;
  if (
    !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(supabaseUrl) ||
    !/^sb_secret_[A-Za-z0-9_-]{16,512}$/.test(secretKey) ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(storageBucket)
  )
    supabaseStorageFailure();
  const base = `${supabaseUrl}/storage/v1`;
  async function request(path: string, init: RequestInit = {}) {
    try {
      const headers = new Headers(init.headers);
      headers.set('apikey', secretKey);
      return await fetcher(`${base}${path}`, {
        ...init,
        headers,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(r2HttpLimits.timeoutMs),
      });
    } catch {
      return supabaseStorageFailure();
    }
  }
  async function json(response: Response): Promise<Record<string, unknown>> {
    try {
      const bytes = await readR2Bytes(response.body, r2HttpLimits.jsonBytes);
      const value: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      );
      if (!r2Record(value)) return supabaseStorageFailure();
      return value;
    } catch {
      return supabaseStorageFailure();
    }
  }
  async function assertPrivateBucket() {
    const response = await request(`/bucket/${storageBucket}`);
    const value = await json(response);
    if (!response.ok || value.id !== storageBucket || value.public !== false)
      supabaseStorageFailure();
    return value;
  }
  async function assertStagingBucket() {
    const value = await assertPrivateBucket();
    // Signed upload capabilities cannot bind a descriptor's exact size/hash.
    // The provider enforces the global ceiling; finish checks exact bytes.
    if (
      !Number.isSafeInteger(value.file_size_limit) ||
      (value.file_size_limit as number) <= 0 ||
      (value.file_size_limit as number) > MAX_COMPANY_FILE_BYTES ||
      !Array.isArray(value.allowed_mime_types) ||
      value.allowed_mime_types.length !== 1 ||
      value.allowed_mime_types[0] !== 'application/octet-stream'
    )
      supabaseStorageFailure();
  }
  async function info(path: string): Promise<SupabaseStoredObject | null> {
    assertSupabaseObjectPath(path);
    const response = await request(
      `/object/info/authenticated/${storageBucket}/${path}`,
    );
    const value = await json(response);
    if (!response.ok) {
      // Permission failures and a missing bucket are not evidence of absence.
      if ([400, 404].includes(response.status) && value.code === 'NoSuchKey')
        return null;
      return supabaseStorageFailure();
    }
    if (
      value.name !== path ||
      value.bucket_id !== storageBucket ||
      !Number.isSafeInteger(value.size) ||
      (value.size as number) < 0 ||
      (value.size as number) > r2HttpLimits.objectBytes ||
      typeof value.etag !== 'string' ||
      !/^"[^"\r\n]{1,256}"$/.test(value.etag) ||
      value.content_type !== 'application/octet-stream' ||
      typeof value.last_modified !== 'string' ||
      !Number.isFinite(Date.parse(value.last_modified))
    )
      return supabaseStorageFailure();
    return {
      path,
      size: value.size as number,
      etag: value.etag,
      contentType: value.content_type,
      uploaded: new Date(value.last_modified).toISOString(),
    };
  }
  async function head(path: string) {
    assertSupabaseObjectPath(path);
    await assertPrivateBucket();
    return info(path);
  }
  async function get(expected: SupabaseStoredObject, sha256: string) {
    assertSupabaseObjectPath(expected.path);
    if (
      !/^[a-f0-9]{64}$/.test(sha256) ||
      !Number.isSafeInteger(expected.size) ||
      expected.size < 0 ||
      expected.size > r2HttpLimits.objectBytes ||
      !/^"[^"\r\n]{1,256}"$/.test(expected.etag)
    )
      return supabaseStorageFailure();
    await assertPrivateBucket();
    // Supabase's AssetRenderer does not currently forward If-Match to its
    // backend. Treat it as advisory: compare the actual response below and
    // verify streamed bytes against the caller's independently stored SHA-256.
    const response = await request(
      `/object/authenticated/${storageBucket}/${expected.path}`,
      {
        headers: { 'if-match': expected.etag, 'accept-encoding': 'identity' },
      },
    );
    if (
      response.status !== 200 ||
      response.headers.get('etag') !== expected.etag ||
      response.headers.get('content-length') !== String(expected.size) ||
      response.headers.get('content-type') !== 'application/octet-stream' ||
      (response.headers.get('content-encoding') ?? 'identity') !== 'identity' ||
      !response.body
    ) {
      await response.body?.cancel().catch(() => {});
      return supabaseStorageFailure();
    }
    return guardedR2Body(
      response.body,
      expected.size,
      Date.now() + r2HttpLimits.timeoutMs,
      sha256,
    );
  }
  async function put(path: string, bytes: Uint8Array) {
    assertSupabaseObjectPath(path);
    if (
      !path.startsWith('partner-hub/objects/') ||
      bytes.length > r2HttpLimits.objectBytes
    )
      return supabaseStorageFailure();
    await assertPrivateBucket();
    const response = await request(`/object/${storageBucket}/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'cache-control': 'private, no-store',
        'x-upsert': 'false',
      },
      body: Uint8Array.from(bytes),
    });
    const value = await json(response);
    if (!response.ok || value.Key !== `${storageBucket}/${path}`)
      return supabaseStorageFailure();
    const saved = await info(path);
    if (!saved || saved.size !== bytes.length) return supabaseStorageFailure();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    // Never publish a logical pointer based only on a successful upload reply.
    await readR2Bytes(await get(saved, sha256), saved.size);
    return { ...saved, sha256 };
  }
  async function signStagingUpload(path: string) {
    assertSupabaseObjectPath(path);
    if (!path.startsWith('partner-hub/staging/'))
      return supabaseStorageFailure();
    await assertStagingBucket();
    const response = await request(
      `/object/upload/sign/${storageBucket}/${path}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-upsert': 'false' },
        body: '{}',
      },
    );
    const value = await json(response);
    if (
      !response.ok ||
      typeof value.url !== 'string' ||
      value.url.length > 8192
    )
      return supabaseStorageFailure();
    // Validate the provider response against the exact requested destination.
    // Returning credentials, off-project URLs, extra query fields or a final
    // object upload capability would cross the server/browser boundary.
    const prefix = `/object/upload/sign/${storageBucket}/${path}?token=`;
    if (!value.url.startsWith(prefix)) return supabaseStorageFailure();
    const token = value.url.slice(prefix.length);
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))
      return supabaseStorageFailure();
    return {
      url: `${base}${value.url}`,
      path,
      method: 'PUT' as const,
      headers: { 'content-type': 'application/octet-stream' },
    };
  }
  return {
    assertPrivateBucket,
    assertStagingBucket,
    head,
    get,
    put,
    signStagingUpload,
  };
}
export type SupabaseStorageHttp = ReturnType<typeof createSupabaseStorageHttp>;
