import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createR2HttpBucket } from '../lib/r2-http-client';
import { handleR2Bridge } from '../infra/r2-bridge/worker';
import {
  R2HttpError,
  r2HttpPath,
  r2HttpLimits,
  r2RequestHeader,
  r2ObjectHeader,
  encodeR2Header,
  decodeR2Header,
  encodeR2Object,
  nativeR2Object,
  encodeR2PutOptions,
  guardedR2Body,
  readR2Bytes,
  type R2WireObject,
} from '../lib/r2-http-protocol';

const origin = 'https://isolated-r2.example.test';
const secret = Buffer.from(randomBytes(32)).toString('hex');
const key = 'company-source/synthetic';
const sha = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');
const hasCode = (code: string) => (error: unknown) =>
  error instanceof R2HttpError && error.code === code && error.message === code;
function wire(
  bytes: Uint8Array = new TextEncoder().encode('synthetic'),
  objectKey = key,
): R2WireObject {
  const etag = createHash('md5').update(bytes).digest('hex');
  return {
    key: objectKey,
    version: 'synthetic-version',
    size: bytes.byteLength,
    etag,
    httpEtag: `"${etag}"`,
    uploaded: '2026-09-08T00:00:00.000Z',
    httpMetadata: { contentType: 'text/plain; charset=utf-8' },
    customMetadata: {},
    checksums: { sha256: sha(bytes), md5: etag },
    storageClass: 'Standard',
  };
}
function fixture() {
  const objects = new Map<string, { bytes: Uint8Array; object: R2Object }>();
  const calls: string[] = [];
  const bucket = {
    async head(objectKey: string) {
      calls.push('head');
      return objects.get(objectKey)?.object ?? null;
    },
    async get(objectKey: string) {
      calls.push('get');
      const saved = objects.get(objectKey);
      return saved
        ? {
            ...encodeR2Object(saved.object),
            uploaded: saved.object.uploaded,
            httpMetadata: saved.object.httpMetadata,
            checksums: saved.object.checksums,
            writeHttpMetadata: (headers: Headers) =>
              saved.object.writeHttpMetadata(headers),
            body: new Response(Uint8Array.from(saved.bytes)).body,
          }
        : null;
    },
    async put(objectKey: string, value: Uint8Array, options: R2PutOptions) {
      calls.push('put');
      const previous = objects.get(objectKey);
      const condition = options.onlyIf as R2Conditional | undefined;
      if (condition?.etagDoesNotMatch === '*' && previous) return null;
      if (
        condition?.etagMatches &&
        condition.etagMatches !== previous?.object.etag
      )
        return null;
      const metadata = encodeR2PutOptions(options);
      if (metadata.sha256 && metadata.sha256 !== sha(value))
        throw new Error('private checksum detail');
      const object = nativeR2Object({
        ...wire(value, objectKey),
        httpMetadata: metadata.httpMetadata ?? {},
        customMetadata: metadata.customMetadata ?? {},
      });
      objects.set(objectKey, { object, bytes: Uint8Array.from(value) });
      return object;
    },
    async delete(objectKey: string) {
      calls.push('delete');
      objects.delete(objectKey);
    },
  } as unknown as R2Bucket;
  const environment = {
    AI_SOURCE_FILES: bucket,
    R2_BRIDGE_ENABLED: '1',
    R2_BRIDGE_SECRET: secret,
  };
  const fetcher: typeof fetch = (input, init) =>
    handleR2Bridge(new Request(input, init), environment);
  return {
    calls,
    objects,
    environment,
    fetcher,
    remote: createR2HttpBucket({ origin, secret, fetcher }),
  };
}
function request(
  operation: unknown = { version: 1, operation: 'head', key },
  headers: Record<string, string> = {},
  path = r2HttpPath,
  method = 'POST',
  body?: BodyInit,
) {
  return new Request(origin + path, {
    method,
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/octet-stream',
      [r2RequestHeader]: encodeR2Header(operation),
      ...headers,
    },
    ...(body ? { body } : {}),
  });
}
function objectResponse(bytes: Uint8Array, object = wire(bytes)) {
  return new Response(Uint8Array.from(bytes), {
    headers: {
      'x-partner-hub-r2-version': '1',
      [r2ObjectHeader]: encodeR2Header(object),
      'content-type': 'application/octet-stream',
      'content-length': String(object.size),
    },
  });
}

void test('R2 HTTP preserves private Unicode bytes, dates, metadata, checksums and body methods', async () => {
  const { remote } = fixture();
  const content = '합성 원본 "인용"\n두 번째 줄';
  const bytes = new TextEncoder().encode(content);
  const wrapped = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(sha(bytes), 'hex'),
    Buffer.from([1]),
  ]);
  const result = await remote.put(
    key,
    new File([bytes], 'synthetic.txt').stream(),
    {
      sha256: wrapped.subarray(1, 33),
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: {
        contentType: 'text/plain; charset=utf-8',
        contentDisposition: 'attachment; filename="safe.txt"',
        cacheExpiry: new Date('2027-01-01T00:00:00.000Z'),
      },
      customMetadata: { purpose: '합성 검증' },
    },
  );
  assert.ok(result?.uploaded instanceof Date);
  assert.equal(result.httpEtag, `"${result.etag}"`);
  assert.equal(result.checksums.toJSON().sha256, sha(bytes));
  assert.deepEqual(result.customMetadata, { purpose: '합성 검증' });
  const head = await remote.head(key);
  assert.deepEqual(head?.checksums.sha256, result.checksums.sha256);
  const headers = new Headers();
  head!.writeHttpMetadata(headers);
  assert.equal(headers.get('expires'), 'Fri, 01 Jan 2027 00:00:00 GMT');
  const object = (await remote.get(key))!;
  assert.equal(object.bodyUsed, false);
  assert.equal(await object.text(), content);
  assert.equal(object.bodyUsed, true);
  await assert.rejects(object.arrayBuffer());
  assert.deepEqual(await (await remote.get(key))!.bytes(), bytes);
  assert.equal(
    (await (await remote.get(key))!.blob()).type,
    'text/plain;charset=utf-8',
  );
  await remote.put(key, '{"verified":true}');
  assert.deepEqual(await (await remote.get(key))!.json(), { verified: true });
});
void test('R2 HTTP preserves missing, zero-byte, conditional create/update and explicit delete', async () => {
  const { remote, calls } = fixture();
  assert.equal(await remote.get(key), null);
  assert.equal(await remote.head(key), null);
  const saved = await remote.put(key, null, {
    onlyIf: { etagDoesNotMatch: '*' },
  });
  assert.equal(saved?.size, 0);
  assert.equal(await (await remote.get(key))!.text(), '');
  assert.equal(
    await remote.put(key, 'changed', { onlyIf: { etagDoesNotMatch: '*' } }),
    null,
  );
  assert.equal(
    await remote.put(key, 'changed', { onlyIf: { etagMatches: 'wrong' } }),
    null,
  );
  assert.ok(
    await remote.put(key, 'changed', { onlyIf: { etagMatches: saved!.etag } }),
  );
  await remote.delete(key);
  assert.equal(await remote.head(key), null);
  assert.equal(calls.filter((call) => call === 'delete').length, 1);
});
void test('R2 bridge denies disabled, browser, malformed and unauthenticated requests before native calls', async () => {
  const { environment, calls } = fixture();
  assert.equal(
    (
      await handleR2Bridge(request(), {
        ...environment,
        R2_BRIDGE_ENABLED: '0',
      })
    ).status,
    503,
  );
  for (const [headers, status] of [
    [{ authorization: '' }, 401],
    [{ authorization: `Bearer ${'0'.repeat(64)}` }, 401],
    [{ origin }, 403],
    [{ cookie: 'session=synthetic' }, 403],
    [{ 'content-encoding': 'gzip' }, 415],
    [{ 'content-type': 'text/plain' }, 415],
    [{ 'content-length': '1' }, 400],
    [{ [r2RequestHeader]: 'not+base64' }, 400],
  ] as const) {
    const response = await handleR2Bridge(
      request(undefined, headers),
      environment,
    );
    assert.equal(response.status, status);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.match(response.headers.get('cache-control')!, /no-store/);
  }
  for (const [path, method, status] of [
    [r2HttpPath + '?key=private', 'POST', 404],
    ['/wrong', 'POST', 404],
    [r2HttpPath, 'GET', 405],
  ] as const)
    assert.equal(
      (await handleR2Bridge(request(undefined, {}, path, method), environment))
        .status,
      status,
    );
  for (const operation of [
    { version: 2, operation: 'get', key },
    { version: 1, operation: 'list', key },
    { version: 1, operation: 'get', key: 'unrelated/private' },
    { version: 1, operation: 'delete', key, extra: true },
    {
      version: 1,
      operation: 'put',
      key,
      size: 1,
      options: { onlyIf: { uploadedBefore: 'now' } },
    },
  ])
    assert.equal(
      (await handleR2Bridge(request(operation), environment)).status,
      400,
    );
  assert.deepEqual(calls, []);
});
void test('R2 HTTP client rejects insecure config, unsupported methods/options and foreign keys before fetch', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    throw new Error();
  };
  for (const url of [
    'http://example.test',
    'http://127.0.0.1',
    origin + '/path',
    origin + '?query=1',
    'https://user:pass@example.test',
    origin + '#fragment',
  ])
    assert.throws(
      () => createR2HttpBucket({ origin: url, secret, fetcher }),
      hasCode('R2_HTTP_INVALID_INPUT'),
    );
  assert.throws(
    () => createR2HttpBucket({ origin, secret: 'short', fetcher }),
    hasCode('R2_HTTP_INVALID_INPUT'),
  );
  const remote = createR2HttpBucket({ origin, secret, fetcher });
  for (const foreign of [
    'other/private',
    'company-source/../secret',
    'consulting-flow/a/b',
    'company-source/%2f',
  ])
    await assert.rejects(remote.get(foreign), hasCode('R2_HTTP_INVALID_INPUT'));
  await assert.rejects(
    remote.get(key, { range: { offset: 0 } }),
    hasCode('R2_HTTP_UNSUPPORTED'),
  );
  await assert.rejects(
    remote.put(key, 'x', { md5: new Uint8Array(16) }),
    hasCode('R2_HTTP_UNSUPPORTED'),
  );
  await assert.rejects(remote.delete([key]), hasCode('R2_HTTP_UNSUPPORTED'));
  assert.throws(() => remote.list(), hasCode('R2_HTTP_UNSUPPORTED'));
  assert.throws(
    () => remote.createMultipartUpload(key),
    hasCode('R2_HTTP_UNSUPPORTED'),
  );
  assert.throws(
    () => remote.resumeMultipartUpload(key, 'id'),
    hasCode('R2_HTTP_UNSUPPORTED'),
  );
  assert.equal(calls, 0);
});
void test('R2 bridge verifies exact size and checksum, never partially writes oversized or short requests', async () => {
  const { environment, remote, calls, objects } = fixture();
  const operation = { version: 1, operation: 'put', key, size: 2, options: {} };
  assert.equal(
    (
      await handleR2Bridge(
        request(operation, {}, r2HttpPath, 'POST', 'x'),
        environment,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handleR2Bridge(
        request({ ...operation, size: 0 }, {}, r2HttpPath, 'POST', 'x'),
        environment,
      )
    ).status,
    400,
  );
  await assert.rejects(
    remote.put(key, new Uint8Array(r2HttpLimits.objectBytes + 1)),
    hasCode('R2_HTTP_INVALID_INPUT'),
  );
  assert.deepEqual(calls, []);
  await assert.rejects(
    remote.put(key, 'content', { sha256: '0'.repeat(64) }),
    hasCode('R2_HTTP_OUTCOME_UNKNOWN'),
  );
  assert.equal(objects.size, 0);
  assert.deepEqual(calls, ['put']);
});
void test('R2 client refuses proxy 404/412, malformed acknowledgements and cross-key metadata', async () => {
  for (const response of [
    new Response('proxy', { status: 404 }),
    new Response('proxy', { status: 412 }),
    Response.json({ version: 1, code: 'R2_HTTP_NOT_FOUND' }, { status: 404 }),
    objectResponse(
      new Uint8Array([1]),
      wire(new Uint8Array([1]), 'company-source/different'),
    ),
  ]) {
    let calls = 0;
    const remote = createR2HttpBucket({
      origin,
      secret,
      fetcher: async () => {
        calls++;
        return response;
      },
    });
    await assert.rejects(remote.head(key), hasCode('R2_HTTP_OUTCOME_UNKNOWN'));
    assert.equal(calls, 1);
  }
  const { fetcher } = fixture();
  await assert.rejects(
    createR2HttpBucket({ origin, secret: '0'.repeat(64), fetcher }).head(key),
    hasCode('R2_HTTP_AUTH_FAILED'),
  );
});
void test('R2 client reports lost write acknowledgement without replay or compensating delete', async () => {
  const { fetcher, objects, calls } = fixture();
  const remote = createR2HttpBucket({
    origin,
    secret,
    fetcher: async (input, init) => {
      await fetcher(input, init);
      throw new Error('private upstream detail');
    },
  });
  await assert.rejects(
    remote.put(key, 'committed', { onlyIf: { etagDoesNotMatch: '*' } }),
    hasCode('R2_HTTP_OUTCOME_UNKNOWN'),
  );
  assert.equal(new TextDecoder().decode(objects.get(key)!.bytes), 'committed');
  assert.deepEqual(calls, ['put']);
});
void test('R2 client keeps object keys out of URL and sends no cookies or redirects', async () => {
  const { fetcher } = fixture();
  const remote = createR2HttpBucket({
    origin,
    secret,
    fetcher: (input, init) => {
      assert.equal(input, origin + r2HttpPath);
      assert.equal(init?.credentials, 'omit');
      assert.equal(init?.redirect, 'manual');
      assert.equal(init?.cache, 'no-store');
      assert.equal(new Headers(init?.headers).get('cookie'), null);
      assert.equal(
        (
          decodeR2Header(new Headers(init?.headers).get(r2RequestHeader)) as {
            key: string;
          }
        ).key,
        key,
      );
      return fetcher(input, init);
    },
  });
  assert.equal(await remote.head(key), null);
});
void test('R2 body detects truncation, extra bytes, corruption and consumer cancellation', async () => {
  for (const [bytes, expected, hash] of [
    [new Uint8Array([1]), 2, undefined],
    [new Uint8Array([1, 2]), 1, undefined],
    [new Uint8Array([1]), 1, sha(new Uint8Array([2]))],
  ] as const) {
    const body = guardedR2Body(
      new Response(Uint8Array.from(bytes)).body!,
      expected,
      Date.now() + 1000,
      hash,
    );
    await assert.rejects(
      new Response(body).arrayBuffer(),
      hasCode('R2_HTTP_OUTCOME_UNKNOWN'),
    );
  }
  let canceled = false;
  const body = guardedR2Body(
    new ReadableStream({
      cancel() {
        canceled = true;
      },
    }),
    10,
    Date.now() + 1000,
  );
  await body.cancel();
  assert.equal(canceled, true);
});
void test('R2 body and header deadlines fail stalled responses without hidden retries', async () => {
  let canceled = false;
  const body = guardedR2Body(
    new ReadableStream({
      cancel() {
        canceled = true;
      },
    }),
    1,
    Date.now() + 20,
  );
  await assert.rejects(
    new Response(body).arrayBuffer(),
    hasCode('R2_HTTP_OUTCOME_UNKNOWN'),
  );
  assert.equal(canceled, true);
  let calls = 0;
  const remote = createR2HttpBucket({
    origin,
    secret,
    timeoutMs: 20,
    fetcher: async () => {
      calls++;
      return new Promise(() => {});
    },
  });
  await assert.rejects(remote.head(key), hasCode('R2_HTTP_OUTCOME_UNKNOWN'));
  assert.equal(calls, 1);
});
void test('R2 get response exposes a verified, bounded single-use stream', async () => {
  const bytes = new TextEncoder().encode('intact');
  const broken = createR2HttpBucket({
    origin,
    secret,
    fetcher: async () =>
      objectResponse(new TextEncoder().encode('broken'), wire(bytes)),
  });
  await assert.rejects(
    (await broken.get(key))!.text(),
    hasCode('R2_HTTP_OUTCOME_UNKNOWN'),
  );
  const valid = createR2HttpBucket({
    origin,
    secret,
    fetcher: async () => objectResponse(bytes),
  });
  const object = (await valid.get(key))!;
  assert.deepEqual(await readR2Bytes(object.body, bytes.length), bytes);
  assert.equal(object.bodyUsed, true);
  await assert.rejects(object.text());
});
void test('R2 metadata rejects header overflow, unsupported conditions and ambiguous JSON encodings', () => {
  assert.throws(
    () => encodeR2Header({ huge: 'x'.repeat(8192) }),
    hasCode('R2_HTTP_INVALID_INPUT'),
  );
  assert.throws(() => decodeR2Header('e30='), hasCode('R2_HTTP_INVALID_INPUT'));
  assert.throws(
    () =>
      encodeR2PutOptions({
        onlyIf: { etagMatches: 'x', etagDoesNotMatch: '*' },
      }),
    hasCode('R2_HTTP_INVALID_INPUT'),
  );
  const object = nativeR2Object(wire());
  assert.deepEqual(encodeR2Object(object), wire());
  const localMetadata = { ...wire(), storageClass: '' };
  assert.deepEqual(
    encodeR2Object(nativeR2Object(localMetadata)),
    localMetadata,
  );
  const native = nativeR2Object(localMetadata);
  native.httpMetadata!.contentEncoding = undefined;
  assert.deepEqual(encodeR2Object(native), localMetadata);
});
void test('R2 HTTP preserves historical flat-key reads/deletes but forbids new flat-key writes', async () => {
  const { remote, objects } = fixture();
  const bytes = new TextEncoder().encode('legacy synthetic');
  objects.set('legacy-synthetic', {
    bytes,
    object: nativeR2Object(wire(bytes, 'legacy-synthetic')),
  });
  assert.equal(
    await (await remote.get('legacy-synthetic'))!.text(),
    'legacy synthetic',
  );
  await assert.rejects(
    remote.put('legacy-synthetic', 'new'),
    hasCode('R2_HTTP_INVALID_INPUT'),
  );
  await remote.delete('legacy-synthetic');
  assert.equal(await remote.head('legacy-synthetic'), null);
});
void test('R2 upload rejects non-byte, oversized and interrupted streams before transport', async () => {
  const { remote, calls } = fixture();
  let canceled = 0;
  for (const chunk of [
    'invalid byte stream',
    new Uint8Array(r2HttpLimits.objectBytes + 1),
  ]) {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
      },
      cancel() {
        canceled++;
      },
    });
    await assert.rejects(
      remote.put(key, stream),
      hasCode('R2_HTTP_INVALID_INPUT'),
    );
    assert.equal(stream.locked, false);
  }
  assert.equal(canceled, 2);
  const interrupted = new ReadableStream({
    start(controller) {
      controller.error(new Error('synthetic interruption'));
    },
  });
  await assert.rejects(remote.put(key, interrupted), /synthetic interruption/);
  assert.deepEqual(calls, []);
});
