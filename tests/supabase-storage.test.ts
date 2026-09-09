import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createSupabaseStorageHttp } from '../lib/supabase-storage-http';
import { createSupabaseStorageBucket } from '../lib/supabase-storage-bucket';
import type {
  SupabaseStorageHead,
  SupabaseStorageManifest,
} from '../lib/supabase-storage-manifest';

const config = {
  supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
  secretKey: 'sb_secret_synthetic_value_not_a_real_key',
  storageBucket: 'partner-hub-private',
};
const sha = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const objects = new Map<string, Uint8Array>();
  const calls: { method: string; path: string }[] = [];
  const heads = new Map<string, SupabaseStorageHead>();
  let isPublic = false;
  let corruptGet = false;
  let unknownWrite = false;
  let signedUrl: string | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.origin, config.supabaseUrl);
    assert.equal(new Headers(init?.headers).get('apikey'), config.secretKey);
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.cache, 'no-store');
    const path = url.pathname.slice('/storage/v1'.length);
    const method = init?.method ?? 'GET';
    calls.push({ method, path });
    if (path === `/bucket/${config.storageBucket}`)
      return Response.json({ id: config.storageBucket, public: isPublic });
    if (path.startsWith('/object/upload/sign/')) {
      assert.equal(new Headers(init?.headers).get('x-upsert'), 'false');
      return Response.json({
        url: signedUrl ?? `${path}?token=header.payload.signature`,
      });
    }
    const objectPath = path.replace(
      /^\/object\/(info\/authenticated\/|authenticated\/)?partner-hub-private\//,
      '',
    );
    if (method === 'POST') {
      assert.equal(new Headers(init?.headers).get('x-upsert'), 'false');
      if (objects.has(objectPath))
        return Response.json({ code: 'Duplicate' }, { status: 409 });
      objects.set(
        objectPath,
        new Uint8Array(await new Response(init?.body).arrayBuffer()),
      );
      if (unknownWrite)
        return Response.json({ detail: config.secretKey }, { status: 500 });
      return Response.json({ Key: `${config.storageBucket}/${objectPath}` });
    }
    const bytes = objects.get(objectPath);
    if (!bytes) return Response.json({ code: 'NoSuchKey' }, { status: 404 });
    const etag = `"${sha(bytes)}"`;
    if (path.startsWith('/object/info/'))
      return Response.json({
        name: objectPath,
        bucket_id: config.storageBucket,
        size: bytes.length,
        etag,
        content_type: 'application/octet-stream',
        last_modified: '2026-09-09T00:00:00Z',
      });
    assert.equal(new Headers(init?.headers).get('if-match'), etag);
    const body = Uint8Array.from(bytes);
    if (corruptGet && body.length) body[0] ^= 1;
    return new Response(body, {
      headers: {
        etag,
        'content-length': String(bytes.length),
        'content-type': 'application/octet-stream',
      },
    });
  };
  const manifest: SupabaseStorageManifest = {
    async read(key) {
      return heads.get(key) ?? null;
    },
    async publish(key, version, expected) {
      if (
        expected !== undefined &&
        (heads.get(key)?.revision ?? null) !== expected
      )
        return false;
      heads.set(key, { revision: version.revision, version });
      return true;
    },
    async remove(key, expected) {
      if (heads.get(key)?.revision !== expected) return false;
      heads.set(key, { revision: randomUUID(), version: null });
      return true;
    },
  };
  const storage = createSupabaseStorageHttp(config, fetcher);
  const bucket = createSupabaseStorageBucket(storage, manifest);
  return {
    storage,
    bucket,
    objects,
    calls,
    heads,
    manifest,
    publicBucket() {
      isPublic = true;
    },
    corrupt() {
      corruptGet = true;
    },
    unknownWrite() {
      unknownWrite = true;
    },
    signedUrl(url: string) {
      signedUrl = url;
    },
  };
}

void test('Supabase file lifecycle preserves logical metadata, verified bytes and recoverable versions', async () => {
  const f = fixture();
  const key = 'company-source/file-1';
  const bytes = new TextEncoder().encode('기업자료 원본');
  const first = await f.bucket.put(key, bytes, {
    onlyIf: { etagDoesNotMatch: '*' },
    sha256: sha(bytes),
    httpMetadata: {
      contentType: 'text/plain',
      contentDisposition: 'attachment',
    },
    customMetadata: { category: 'source' },
  });
  assert.ok(first);
  assert.equal(first.checksums.toJSON().sha256, sha(bytes));
  assert.equal(first.httpMetadata?.contentType, 'text/plain');
  assert.deepEqual(
    new Uint8Array(await (await f.bucket.get(key))!.arrayBuffer()),
    bytes,
  );
  assert.equal((await f.bucket.head(key))!.etag, first.etag);
  assert.equal(
    await f.bucket.put(key, bytes, { onlyIf: { etagDoesNotMatch: '*' } }),
    null,
  );
  const second = await f.bucket.put(key, '수정', {
    onlyIf: { etagMatches: first.etag },
  });
  assert.ok(second);
  assert.equal(f.objects.size, 2);
  assert.notEqual(first.version, second.version);
  await f.bucket.delete(key);
  assert.equal(await f.bucket.get(key), null);
  assert.equal(
    f.objects.size,
    2,
    'logical deletion preserves bytes for rollback',
  );
  assert.ok(
    await f.bucket.put(key, '재등록', { onlyIf: { etagDoesNotMatch: '*' } }),
  );
});

void test('Supabase concurrent create and conditional replacement each publish one winner', async () => {
  const f = fixture();
  const key = 'consulting-flow/file-1';
  const creates = await Promise.all(
    ['first', 'second'].map((value) =>
      f.bucket.put(key, value, { onlyIf: { etagDoesNotMatch: '*' } }),
    ),
  );
  assert.equal(creates.filter(Boolean).length, 1);
  const winner = creates.find(Boolean)!;
  const updates = await Promise.all(
    ['third', 'fourth'].map((value) =>
      f.bucket.put(key, value, { onlyIf: { etagMatches: winner.etag } }),
    ),
  );
  assert.equal(updates.filter(Boolean).length, 1);
  assert.equal(
    (await f.bucket.head(key))!.version,
    updates.find(Boolean)!.version,
  );
  assert.equal(
    f.objects.size,
    4,
    'losing uploads remain available for later retention cleanup',
  );
});

void test('Supabase never publishes corrupt bytes or retries an uncertain physical write', async () => {
  const f = fixture();
  f.corrupt();
  await assert.rejects(f.bucket.put('company-source/corrupt', 'original'));
  assert.equal(f.heads.size, 0);
  const uncertain = fixture();
  uncertain.unknownWrite();
  await assert.rejects(
    uncertain.bucket.put('company-source/uncertain', 'original'),
    { message: 'SUPABASE_STORAGE_FAILED_OR_OUTCOME_UNKNOWN' },
  );
  assert.equal(uncertain.heads.size, 0);
  assert.equal(
    uncertain.calls.filter((call) => call.method === 'POST').length,
    1,
  );
  assert.equal(uncertain.objects.size, 1);
});

void test('Supabase public buckets, checksum mismatch and changed physical objects fail closed', async () => {
  const f = fixture();
  await assert.rejects(
    f.bucket.put('company-source/file', 'bytes', { sha256: '0'.repeat(64) }),
  );
  assert.equal(f.calls.length, 0);
  await f.bucket.put('company-source/file', 'bytes');
  f.corrupt();
  await assert.rejects(
    (await f.bucket.get('company-source/file'))!.arrayBuffer(),
  );
  f.publicBucket();
  await assert.rejects(f.bucket.head('company-source/file'));
  await assert.rejects(f.bucket.put('company-source/other', 'bytes'));
  assert.equal(f.objects.size, 1);
});

void test('Supabase signed uploads are staging-only, exact-destination and contain no server key', async () => {
  const f = fixture();
  const path = `partner-hub/staging/v1/${randomUUID()}`;
  const ticket = await f.storage.signStagingUpload(path);
  assert.equal(ticket.method, 'PUT');
  assert.equal(new URL(ticket.url).origin, config.supabaseUrl);
  assert.equal(JSON.stringify(ticket).includes(config.secretKey), false);
  const count = f.calls.length;
  await assert.rejects(
    f.storage.signStagingUpload(path.replace('/staging/', '/objects/')),
  );
  await assert.rejects(f.storage.signStagingUpload('../private'));
  assert.equal(f.calls.length, count);
  for (const bad of [
    'https://evil.test/?token=x',
    `/object/upload/sign/${config.storageBucket}/${path}?token=h.p.s&upsert=true`,
    `/object/upload/sign/other/${path}?token=h.p.s`,
    `/object/upload/sign/${config.storageBucket}/${path}?token=${config.secretKey}`,
  ]) {
    f.signedUrl(bad);
    await assert.rejects(f.storage.signStagingUpload(path));
  }
});

void test('Supabase transport checks destination before credentials can leave the server', () => {
  for (const supabaseUrl of [
    'https://evil.test',
    `${config.supabaseUrl}.evil.test`,
    `${config.supabaseUrl}/`,
    config.supabaseUrl.replace('https:', 'http:'),
  ])
    assert.throws(() => createSupabaseStorageHttp({ ...config, supabaseUrl }));
});
