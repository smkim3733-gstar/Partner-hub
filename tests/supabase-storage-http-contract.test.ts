import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createSupabaseStorageHttp } from '../lib/supabase-storage-http';
import { readR2Bytes } from '../lib/r2-http-protocol';

// Independently checked against the public Supabase Storage source on
// 2026-09-10, not a recording from the configured production project:
// https://github.com/supabase/storage/blob/7d7757dc971ed83e6d8bcc42a61497428b7a84a0/src/storage/renderer/info.ts
// https://github.com/supabase/storage/blob/7d7757dc971ed83e6d8bcc42a61497428b7a84a0/src/storage/renderer/asset.ts
// https://github.com/supabase/storage/blob/7d7757dc971ed83e6d8bcc42a61497428b7a84a0/src/storage/renderer/renderer.ts
// AssetRenderer forwards If-None-Match, but not If-Match. These responses
// intentionally do not enforce the latter on the provider's behalf.
const config = {
  supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
  secretKey: 'sb_secret_synthetic_contract_never_a_real_key',
  storageBucket: 'synthetic-private',
};
const path = 'partner-hub/objects/v1/12345678-1234-4123-8123-123456789abc';
const bytes = new TextEncoder().encode('independent storage contract');
const sha256 = createHash('sha256').update(bytes).digest('hex');
// Provider ETags are opaque, not the application's SHA-256 (including S3
// multipart ETags). Integrity must not depend on their digest algorithm.
const etag = '"6d436114a110885cb58e3fa791d3525e-2"';
const info = {
  id: '87654321-1234-4123-8123-123456789abc',
  name: path,
  version: '87654321-1234-4123-8123-123456789abd',
  bucket_id: config.storageBucket,
  size: bytes.length,
  content_type: 'application/octet-stream',
  cache_control: 'private, no-store',
  etag,
  metadata: {},
  last_modified: '2026-09-10T00:00:00.000Z',
  created_at: '2026-09-10T00:00:00.000Z',
};
const expected = {
  path,
  size: bytes.length,
  contentType: 'application/octet-stream',
  etag,
  uploaded: info.last_modified,
};
const headers = {
  etag,
  'content-length': String(bytes.length),
  'content-type': 'application/octet-stream',
};
const failure = { message: 'SUPABASE_STORAGE_FAILED_OR_OUTCOME_UNKNOWN' };

function transport(
  handle: (route: string, init: RequestInit) => Response,
  bucket: () => Response = () =>
    Response.json({ id: config.storageBucket, public: false }),
) {
  return createSupabaseStorageHttp(config, async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.origin, config.supabaseUrl);
    assert.equal(new Headers(init.headers).get('apikey'), config.secretKey);
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.signal instanceof AbortSignal, true);
    const route = url.pathname.slice('/storage/v1'.length);
    if (route === `/bucket/${config.storageBucket}`) return bucket();
    return handle(route, init);
  });
}

void test('Supabase current info shape and opaque multipart ETag support a verified download', async () => {
  const storage = transport((route, init) => {
    if (route === `/object/info/authenticated/${config.storageBucket}/${path}`)
      return Response.json(info);
    assert.equal(
      route,
      `/object/authenticated/${config.storageBucket}/${path}`,
    );
    assert.equal(new Headers(init.headers).get('if-match'), etag);
    assert.equal(new Headers(init.headers).get('accept-encoding'), 'identity');
    return new Response(bytes, { headers });
  });
  const head = await storage.head(path);
  assert.deepEqual(head, expected);
  assert.deepEqual(
    await readR2Bytes(await storage.get(head!, sha256), bytes.length),
    bytes,
  );
});

void test('Supabase info keeps exact bucket, path, size, MIME and strong ETag checks', async () => {
  const invalid: Record<string, unknown>[] = [
    { bucket_id: undefined },
    { bucket_id: 'another-private-bucket' },
    { name: path.replace('/objects/', '/staging/') },
    { size: String(bytes.length) },
    { size: -1 },
    { size: 0.5 },
    { size: 25 * 1024 * 1024 + 1 },
    { content_type: 'text/plain' },
    { etag: etag.slice(1, -1) },
    { etag: `W/${etag}` },
    { last_modified: null },
    { last_modified: 'invalid' },
    { bucket_id: undefined, bucketId: config.storageBucket },
  ];
  for (const patch of invalid) {
    const storage = transport(() => Response.json({ ...info, ...patch }));
    await assert.rejects(storage.head(path), failure);
  }
});

void test('Supabase absence requires NoSuchKey, not a missing bucket or denied access', async () => {
  for (const status of [400, 404]) {
    const storage = transport(() =>
      Response.json({ code: 'NoSuchKey', statusCode: '404' }, { status }),
    );
    assert.equal(await storage.head(path), null);
  }
  for (const [status, code] of [
    [400, 'NoSuchBucket'],
    [404, 'NoSuchBucket'],
    [401, 'NoSuchKey'],
    [403, 'AccessDenied'],
    [429, 'TooManyRequests'],
    [500, 'NoSuchKey'],
    [404, undefined],
  ] as const) {
    const storage = transport(() =>
      Response.json({ code, message: config.secretKey }, { status }),
    );
    await assert.rejects(storage.head(path), failure);
  }
  let objectRequests = 0;
  const storage = transport(
    () => {
      objectRequests++;
      return Response.json({ code: 'NoSuchKey' }, { status: 404 });
    },
    () => Response.json({ code: 'NoSuchBucket' }, { status: 404 }),
  );
  await assert.rejects(storage.head(path), failure);
  assert.equal(objectRequests, 0);
});

void test('Supabase ignores advisory If-Match: changed 200 responses are cancelled locally', async () => {
  const invalidHeaders: Record<string, string | null>[] = [
    { etag: '"changed-object"' },
    { etag: `W/${etag}` },
    { etag: null },
    { 'content-length': String(bytes.length + 1) },
    { 'content-length': null },
    { 'content-type': 'text/plain' },
    { 'content-encoding': 'gzip' },
  ];
  for (const patch of invalidHeaders) {
    let cancelled = false;
    const actualHeaders = new Headers(headers);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) actualHeaders.delete(key);
      else actualHeaders.set(key, value);
    }
    const storage = transport(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes);
            },
            cancel() {
              cancelled = true;
            },
          }),
          { status: 200, headers: actualHeaders },
        ),
    );
    await assert.rejects(storage.get(expected, sha256), failure);
    assert.equal(cancelled, true);
  }
});

void test('Supabase partial or error downloads do not become successful byte streams', async () => {
  for (const status of [206, 400, 401, 403, 404, 412, 429, 500]) {
    const storage = transport(() => new Response(bytes, { status, headers }));
    await assert.rejects(storage.get(expected, sha256), failure);
  }
});

void test('Supabase matching response headers cannot hide truncated, excess or corrupt bytes', async () => {
  const corrupt = Uint8Array.from(bytes);
  corrupt[0] ^= 1;
  for (const body of [bytes.slice(1), new Uint8Array([...bytes, 0]), corrupt]) {
    const storage = transport(() => new Response(body, { headers }));
    await assert.rejects(async () =>
      readR2Bytes(await storage.get(expected, sha256), bytes.length),
    );
  }
});
