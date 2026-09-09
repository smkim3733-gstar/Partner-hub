import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSupabaseStorageHttp } from '../lib/supabase-storage-http';

// Storage HTTP contract fixture, not a live Supabase service. Both browser
// staging PUT and server-only authenticated reads use the same byte map.
export function supabaseStorageHttpFixture() {
  const config = {
    supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
    secretKey: 'sb_secret_synthetic_never_a_real_key',
    storageBucket: 'synthetic-private',
  };
  const objects = new Map<string, Uint8Array>();
  const calls: { path: string; method: string; browser: boolean }[] = [];
  const bucket: Record<string, unknown> = {
    id: config.storageBucket,
    public: false,
    file_size_limit: 25 * 1024 * 1024,
    allowed_mime_types: ['application/octet-stream'],
  };
  let onRead: ((path: string) => Promise<void>) | undefined;
  let onSign: (() => Promise<void>) | undefined;
  let failSign = false;
  let corruptRead = false;
  const sha = (data: Uint8Array) =>
    createHash('sha256').update(data).digest('hex');
  const etag = (data: Uint8Array) => `"${sha(data)}"`;
  const uploaded = '2026-09-10T00:00:00.000Z';
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.origin, config.supabaseUrl);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('apikey'), config.secretKey);
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.credentials, 'omit');
    const path = url.pathname.slice('/storage/v1'.length);
    const method = init?.method ?? 'GET';
    calls.push({ method, path, browser: false });
    if (path === `/bucket/${config.storageBucket}`)
      return Response.json(bucket);
    if (path.startsWith('/object/upload/sign/')) {
      assert.equal(method, 'POST');
      assert.equal(headers.get('x-upsert'), 'false');
      await onSign?.();
      if (failSign)
        return Response.json({ secret: config.secretKey }, { status: 500 });
      return Response.json({ url: `${path}?token=header.payload.signature` });
    }
    const key = path.replace(
      /^\/object\/(info\/authenticated\/|authenticated\/)?synthetic-private\//,
      '',
    );
    if (method === 'POST') {
      assert.equal(headers.get('x-upsert'), 'false');
      assert.ok(key.startsWith('partner-hub/objects/v1/'));
      if (objects.has(key))
        return Response.json({ code: 'Duplicate' }, { status: 409 });
      objects.set(
        key,
        new Uint8Array(await new Response(init?.body).arrayBuffer()),
      );
      return Response.json({ Key: `${config.storageBucket}/${key}` });
    }
    const bytes = objects.get(key);
    if (!bytes) return Response.json({ code: 'NoSuchKey' }, { status: 404 });
    if (path.startsWith('/object/info/'))
      return Response.json({
        name: key,
        bucket_id: config.storageBucket,
        size: bytes.length,
        etag: etag(bytes),
        content_type: 'application/octet-stream',
        last_modified: uploaded,
      });
    assert.equal(headers.get('if-match'), etag(bytes));
    await onRead?.(key);
    const body = Uint8Array.from(bytes);
    if (corruptRead && body.length) body[0] ^= 1;
    return new Response(body, {
      headers: {
        etag: etag(bytes),
        'content-length': String(bytes.length),
        'content-type': 'application/octet-stream',
      },
    });
  };
  const browserUpload: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.origin, config.supabaseUrl);
    assert.equal(url.search, '?token=header.payload.signature');
    assert.equal(init?.method, 'PUT');
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.referrerPolicy, 'no-referrer');
    assert.deepEqual(
      [...new Headers(init?.headers)],
      [['content-type', 'application/octet-stream']],
    );
    const prefix = `/storage/v1/object/upload/sign/${config.storageBucket}/`;
    assert.ok(url.pathname.startsWith(prefix));
    const path = url.pathname.slice(prefix.length);
    assert.ok(path.startsWith('partner-hub/staging/v1/'));
    calls.push({ method: 'PUT', path, browser: true });
    if (objects.has(path))
      return Response.json({ code: 'Duplicate' }, { status: 409 });
    const bytes = new Uint8Array(await new Response(init?.body).arrayBuffer());
    if (bytes.length > Number(bucket.file_size_limit))
      return new Response(null, { status: 413 });
    objects.set(path, bytes);
    return Response.json({ Key: `${config.storageBucket}/${path}` });
  };
  return {
    config,
    objects,
    calls,
    bucket,
    browserUpload,
    storage: createSupabaseStorageHttp(config, fetcher),
    onRead(callback?: (path: string) => Promise<void>) {
      onRead = callback;
    },
    onSign(callback?: () => Promise<void>) {
      onSign = callback;
    },
    failSign(value = true) {
      failSign = value;
    },
    corruptRead(value = true) {
      corruptRead = value;
    },
  };
}
