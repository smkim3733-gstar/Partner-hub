import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { snapshotSupabaseStorage } from '../scripts/supabase-backup-storage.mjs';

// Synthetic provider responses. No credentials, remote calls or filesystem data.
const config = {
  supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
  secretKey: 'sb_secret_synthetic_backup_never_a_real_key',
  storageBucket: 'synthetic-private',
};
const timestamp = '2026-09-11T00:00:00.000Z';
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
type Patch = (
  route: string,
  body: Record<string, unknown> | null,
  value: unknown,
) => Response | undefined;

function fixture(paths = ['partner-hub/objects/v1/file-one']) {
  const objects = new Map(
    paths.map((path, index) => [
      path,
      {
        id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        bytes: Buffer.from(`synthetic body ${index}`),
      },
    ]),
  );
  const bucket = {
    id: config.storageBucket,
    name: config.storageBucket,
    public: false,
    file_size_limit: 25 * 1024 * 1024,
    allowed_mime_types: ['application/octet-stream'],
    created_at: timestamp,
    updated_at: timestamp,
  };
  const calls: {
    route: string;
    method: string;
    body: Record<string, unknown> | null;
  }[] = [];
  let patch: Patch | undefined;
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.origin, config.supabaseUrl);
    assert.equal(url.search, '');
    assert.equal(new Headers(init.headers).get('apikey'), config.secretKey);
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store');
    assert.ok(init.signal instanceof AbortSignal);
    const route = decodeURIComponent(url.pathname.slice('/storage/v1'.length));
    const method = init.method ?? 'GET';
    assert.ok(init.body === undefined || typeof init.body === 'string');
    const body = init.body
      ? (JSON.parse(init.body) as Record<string, unknown>)
      : null;
    calls.push({ route, method, body });
    if (route === `/bucket/${config.storageBucket}`) {
      assert.equal(method, 'GET');
      return patch?.(route, body, bucket) ?? Response.json(bucket);
    }
    if (route === `/object/list/${config.storageBucket}`) {
      assert.equal(method, 'POST');
      assert.deepEqual(body?.sortBy, { column: 'name', order: 'asc' });
      assert.deepEqual(Object.keys(body!).sort(), [
        'limit',
        'offset',
        'prefix',
        'sortBy',
      ]);
      const rawPrefix = body!.prefix;
      assert.ok(typeof rawPrefix === 'string');
      const prefix = rawPrefix ? `${rawPrefix}/` : '';
      const entries = new Map<string, unknown>();
      for (const [path, object] of objects) {
        if (!path.startsWith(prefix)) continue;
        const relative = path.slice(prefix.length);
        const name = relative.split('/')[0];
        entries.set(
          name,
          relative.includes('/')
            ? {
                name,
                id: null,
                metadata: null,
                created_at: null,
                updated_at: null,
                last_accessed_at: null,
              }
            : {
                name,
                id: object.id,
                created_at: timestamp,
                updated_at: timestamp,
                last_accessed_at: timestamp,
                metadata: {
                  eTag: `"${hash(object.bytes)}-2"`,
                  size: object.bytes.length,
                  mimetype: 'application/octet-stream',
                  cacheControl: 'private, no-store',
                },
              },
        );
      }
      const page = [...entries]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, value]) => value)
        .slice(
          Number(body!.offset),
          Number(body!.offset) + Number(body!.limit),
        );
      return patch?.(route, body, page) ?? Response.json(page);
    }
    assert.equal(method, 'GET');
    const isInfo = route.startsWith('/object/info/authenticated/');
    const prefix = `/object/${isInfo ? 'info/' : ''}authenticated/${config.storageBucket}/`;
    assert.ok(route.startsWith(prefix));
    const path = route.slice(prefix.length);
    const object = objects.get(path);
    if (!object) return Response.json({ error: 'not found' }, { status: 404 });
    const info = {
      id: object.id,
      name: path,
      bucket_id: config.storageBucket,
      size: object.bytes.length,
      etag: `"${hash(object.bytes)}-2"`,
      content_type: 'application/octet-stream',
      cache_control: 'private, no-store',
      last_modified: timestamp,
      created_at: timestamp,
      metadata: { filename: 'synthetic original document' },
      version: object.id,
    };
    if (isInfo) return patch?.(route, body, info) ?? Response.json(info);
    assert.equal(new Headers(init.headers).get('if-match'), info.etag);
    assert.equal(new Headers(init.headers).get('accept-encoding'), 'identity');
    return (
      patch?.(route, body, object.bytes) ??
      new Response(Uint8Array.from(object.bytes), {
        headers: {
          etag: info.etag,
          'content-length': String(info.size),
          'content-type': info.content_type,
        },
      })
    );
  };
  return {
    objects,
    calls,
    bucket,
    fetcher,
    patch: (value: Patch) => {
      patch = value;
    },
  };
}

void test('empty private bucket produces a complete bounded read-only archive', async () => {
  const fx = fixture([]);
  const result = await snapshotSupabaseStorage(config, { fetcher: fx.fetcher });
  assert.equal(result.version, 1);
  assert.deepEqual(result.objects, []);
  assert.equal(result.totalBytes, 0);
  assert.match(result.inventorySha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.bucket, fx.bucket);
  assert.deepEqual(
    fx.calls.map(({ method }) => method),
    ['GET', 'POST', 'POST', 'GET'],
  );
  assert.ok(!JSON.stringify(result).includes(config.secretKey));
});

void test('recursive pages include every file, staged object and original bytes with SHA-256', async () => {
  const fx = fixture([
    'partner-hub/objects/v1/a',
    'partner-hub/objects/v1/b',
    'partner-hub/staging/v1/c',
    '문서/특수 #%.bin',
  ]);
  const result = await snapshotSupabaseStorage(config, {
    fetcher: fx.fetcher,
    limits: { pageSize: 1 },
  });
  assert.equal(result.objects.length, 4);
  for (const saved of result.objects) {
    const source = fx.objects.get(saved.path)!;
    assert.deepEqual(Buffer.from(saved.bytesBase64, 'base64'), source.bytes);
    assert.equal(saved.sha256, hash(source.bytes));
    assert.equal(saved.size, source.bytes.length);
    assert.equal(
      saved.metadata.info.metadata.filename,
      'synthetic original document',
    );
  }
  assert.equal(
    result.totalBytes,
    [...fx.objects.values()].reduce(
      (sum, object) => sum + object.bytes.length,
      0,
    ),
  );
  assert.ok(fx.calls.some((call) => Number(call.body?.offset) > 1));
  assert.ok(
    fx.calls.every(
      ({ method, route }) =>
        method === 'GET' ||
        (method === 'POST' && route === `/object/list/${config.storageBucket}`),
    ),
  );
});

void test('short pages are exhausted instead of silently truncating the inventory', async () => {
  const fx = fixture(['a', 'b', 'c']);
  fx.patch((route, _body, value) =>
    route.startsWith('/object/list/')
      ? Response.json((value as unknown[]).slice(0, 1))
      : undefined,
  );
  const result = await snapshotSupabaseStorage(config, { fetcher: fx.fetcher });
  assert.equal(result.objects.length, 3);
});

void test('zero byte objects are preserved', async () => {
  const fx = fixture(['zero']);
  fx.objects.get('zero')!.bytes = Buffer.alloc(0);
  const result = await snapshotSupabaseStorage(config, { fetcher: fx.fetcher });
  assert.equal(result.objects[0].bytesBase64, '');
  assert.equal(result.objects[0].sha256, hash(Buffer.alloc(0)));
});

void test('public or incorrectly constrained buckets are never downloaded', async () => {
  for (const patch of [
    { public: true },
    { id: 'another' },
    { file_size_limit: null },
    { allowed_mime_types: null },
  ]) {
    const fx = fixture();
    fx.patch((route, _body, value) =>
      route.startsWith('/bucket/')
        ? Response.json({ ...(value as object), ...patch })
        : undefined,
    );
    await assert.rejects(
      snapshotSupabaseStorage(config, { fetcher: fx.fetcher }),
      /SUPABASE_BACKUP_STORAGE_FAILED/,
    );
    assert.equal(fx.calls.length, 1);
  }
});

void test('duplicate pages and duplicate object ids fail rather than hiding missing files', async () => {
  for (const mode of ['page', 'id']) {
    const fx = fixture(['a', 'b']);
    if (mode === 'id') fx.objects.get('b')!.id = fx.objects.get('a')!.id;
    else
      fx.patch((route, body, value) => {
        if (route.startsWith('/object/list/') && Number(body?.offset) > 0)
          return Response.json([{ ...(value as object[])[0], name: 'a' }]);
        return undefined;
      });
    await assert.rejects(
      snapshotSupabaseStorage(config, {
        fetcher: fx.fetcher,
        limits: { pageSize: 1 },
      }),
      /SUPABASE_BACKUP_STORAGE_(FAILED|CHANGED)/,
    );
  }
});

void test('unsafe names and malformed folder entries cannot change the request destination', async () => {
  for (const patch of [
    { name: '..' },
    { name: 'a/b' },
    { name: 'a\\b' },
    { name: '\u0000' },
    { metadata: {} },
  ]) {
    const fx = fixture();
    fx.patch((route, _body, value) => {
      if (route.startsWith('/object/list/') && (value as unknown[]).length)
        return Response.json([{ ...(value as object[])[0], ...patch }]);
      return undefined;
    });
    await assert.rejects(
      snapshotSupabaseStorage(config, { fetcher: fx.fetcher }),
      /SUPABASE_BACKUP_STORAGE_FAILED/,
    );
  }
});

void test('object additions and bucket settings changes during backup invalidate the snapshot', async () => {
  for (const mode of ['object', 'bucket']) {
    const fx = fixture(['a']);
    fx.patch((route) => {
      if (route.startsWith('/object/authenticated/')) {
        if (mode === 'object')
          fx.objects.set('b', {
            id: '20000000-0000-4000-8000-000000000001',
            bytes: Buffer.from('later'),
          });
        else fx.bucket.updated_at = '2026-09-11T01:00:00.000Z';
      }
      return undefined;
    });
    await assert.rejects(
      snapshotSupabaseStorage(config, { fetcher: fx.fetcher }),
      /SUPABASE_BACKUP_STORAGE_CHANGED/,
    );
  }
});

void test('metadata or version changes after a download invalidate the snapshot', async () => {
  const fx = fixture(['a']);
  let infoCalls = 0;
  fx.patch((route, _body, value) => {
    if (route.startsWith('/object/info/') && ++infoCalls === 2)
      return Response.json({
        ...(value as object),
        version: 'changed-version',
      });
    return undefined;
  });
  await assert.rejects(
    snapshotSupabaseStorage(config, { fetcher: fx.fetcher }),
    /SUPABASE_BACKUP_STORAGE_CHANGED/,
  );
});

void test('access time changes from reading are preserved but do not invalidate stable content', async () => {
  const fx = fixture(['a']);
  let listCalls = 0;
  fx.patch((route, _body, value) => {
    if (route.startsWith('/object/list/') && ++listCalls > 2)
      return Response.json(
        (value as object[]).map((item) => ({
          ...item,
          last_accessed_at: '2026-09-11T01:00:00.000Z',
        })),
      );
    return undefined;
  });
  const result = await snapshotSupabaseStorage(config, { fetcher: fx.fetcher });
  assert.equal(result.objects[0].metadata.listing.last_accessed_at, timestamp);
});

void test('response headers and actual byte length must match the object version', async () => {
  for (const mode of ['etag', 'mime', 'truncated', 'oversized', 'compressed']) {
    const fx = fixture(['a']);
    fx.patch((route, _body, value) => {
      if (!route.startsWith('/object/authenticated/')) return undefined;
      const original = value as Buffer;
      const headers = {
        etag: mode === 'etag' ? '"changed"' : `"${hash(original)}-2"`,
        'content-type':
          mode === 'mime' ? 'text/plain' : 'application/octet-stream',
        'content-length': String(original.length),
        ...(mode === 'compressed' ? { 'content-encoding': 'gzip' } : {}),
      };
      const data =
        mode === 'truncated'
          ? original.subarray(1)
          : mode === 'oversized'
            ? Buffer.concat([original, Buffer.from('x')])
            : original;
      return new Response(Uint8Array.from(data), { headers });
    });
    await assert.rejects(
      snapshotSupabaseStorage(config, { fetcher: fx.fetcher }),
      /SUPABASE_BACKUP_STORAGE_(FAILED|CHANGED|LIMIT_EXCEEDED)/,
    );
  }
});

void test('count, bytes, pages and metadata bounds fail without a partial result', async () => {
  for (const limits of [
    { maxObjects: 1 },
    { maxTotalBytes: 1 },
    { maxPages: 1 },
    { maxInventoryBytes: 10 },
    { maxJsonBytes: 10 },
  ]) {
    const fx = fixture(['a', 'b']);
    await assert.rejects(
      snapshotSupabaseStorage(config, { fetcher: fx.fetcher, limits }),
      /SUPABASE_BACKUP_STORAGE_LIMIT_EXCEEDED/,
    );
  }
});

void test('transport failures and error bodies never reveal credentials, URLs or payloads', async () => {
  for (const mode of ['throw', 'response']) {
    const fetcher: typeof fetch = async () => {
      if (mode === 'throw')
        throw new Error(`https://secret.example/?token=${config.secretKey}`);
      return Response.json(
        { key: config.secretKey, body: 'private contents' },
        { status: 403 },
      );
    };
    await assert.rejects(
      snapshotSupabaseStorage(config, { fetcher }),
      (error: Error) => {
        assert.equal(error.message, 'SUPABASE_BACKUP_STORAGE_FAILED');
        assert.ok(!error.stack?.includes(config.secretKey));
        assert.equal(error.cause, undefined);
        return true;
      },
    );
  }
});

void test('invalid endpoint and unsafe limit overrides fail before any request', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    throw new Error('must not fetch');
  };
  for (const patch of [
    { supabaseUrl: 'https://attacker.example' },
    { storageBucket: '../other' },
    { secretKey: 'invalid' },
  ])
    await assert.rejects(
      snapshotSupabaseStorage({ ...config, ...patch }, { fetcher }),
      /SUPABASE_BACKUP_STORAGE_INVALID_CONFIG/,
    );
  for (const limits of [
    { maxObjects: Infinity },
    { pageSize: 0 },
    { unknown: 1 },
    { toString: 1 },
    { maxTotalBytes: 2 ** 40 },
  ])
    await assert.rejects(
      snapshotSupabaseStorage(config, { fetcher, limits }),
      /SUPABASE_BACKUP_STORAGE_INVALID_CONFIG/,
    );
  assert.equal(calls, 0);
});

void test('stalled response bodies and fetches remain bounded', async () => {
  for (const mode of ['fetch', 'body']) {
    const fetcher: typeof fetch = async () =>
      mode === 'fetch'
        ? new Promise<Response>(() => {})
        : new Response(new ReadableStream({ start() {} }));
    const started = Date.now();
    await assert.rejects(
      snapshotSupabaseStorage(config, {
        fetcher,
        limits: { requestTimeoutMs: 20 },
      }),
      /SUPABASE_BACKUP_STORAGE_FAILED/,
    );
    assert.ok(Date.now() - started < 1_000);
  }
});
