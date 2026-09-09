// Node HTTP-compatible client against the exact Worker with ephemeral native R2.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes, createHash } from 'node:crypto';
import { createR2HttpBucket } from '../lib/r2-http-client.ts';
import {
  r2HttpPath,
  r2HttpLimits,
  r2RequestHeader,
  encodeR2Header,
} from '../lib/r2-http-protocol.ts';

const require = createRequire(import.meta.url);
const wrangler = require.resolve('wrangler');
const { Miniflare, convertV4MiniflareOptions } = require(
  require.resolve('miniflare', { paths: [wrangler] }),
);
const { build } = require(require.resolve('esbuild', { paths: [wrangler] }));
const bundle = await build({
  entryPoints: ['infra/r2-bridge/worker.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  external: ['node:*'],
});
const secret = randomBytes(32).toString('hex');
const origin = 'https://r2.synthetic.invalid';
let outboundRequests = 0;
const mf = new Miniflare(
  convertV4MiniflareOptions({
    script: bundle.outputFiles[0].text,
    modules: true,
    compatibilityDate: '2026-08-26',
    compatibilityFlags: ['nodejs_compat'],
    r2Buckets: ['AI_SOURCE_FILES'],
    bindings: { R2_BRIDGE_ENABLED: '1', R2_BRIDGE_SECRET: secret },
    outboundService: () => {
      outboundRequests++;
      throw new Error('External calls forbidden.');
    },
  }),
);
const bucket = createR2HttpBucket({
  origin,
  secret,
  fetcher: (input, init) => mf.dispatchFetch(input, init),
});
const key = 'company-source/synthetic';
let checks = 0;
const pass = (name) => {
  checks++;
  console.log(`PASS ${name}`);
};
try {
  assert.equal(await bucket.get(key), null);
  assert.equal(await bucket.head(key), null);
  pass('verified missing object is distinct from transport failure');
  const text = '합성 기업 원본\n개인정보 없는 테스트';
  const bytes = new TextEncoder().encode(text);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const options = {
    onlyIf: { etagDoesNotMatch: '*' },
    sha256: checksum,
    httpMetadata: {
      contentType: 'text/plain; charset=utf-8',
      cacheExpiry: new Date('2027-01-01T00:00:00.000Z'),
    },
    customMetadata: { purpose: 'synthetic' },
  };
  const object = await bucket.put(key, bytes, options);
  assert.ok(object);
  assert.equal(object.size, bytes.length);
  assert.equal(object.httpEtag, `"${object.etag}"`);
  assert.equal(object.checksums.toJSON().sha256, checksum);
  pass('native conditional put retains size, ETag and SHA-256');
  const metadata = await bucket.head(key);
  assert.equal(metadata.uploaded.toISOString(), object.uploaded.toISOString());
  assert.equal(
    metadata.httpMetadata.cacheExpiry.toISOString(),
    options.httpMetadata.cacheExpiry.toISOString(),
  );
  assert.deepEqual(metadata.customMetadata, options.customMetadata);
  pass('head preserves timestamps and HTTP/custom metadata');
  assert.equal(
    await bucket.put(key, 'must not overwrite', {
      ...options,
      sha256: createHash('sha256').update('must not overwrite').digest('hex'),
    }),
    null,
  );
  assert.equal(await (await bucket.get(key)).text(), text);
  pass('conditional duplicate never overwrites committed bytes');
  const copy = await bucket.put(
    'consulting-flow/synthetic-copy',
    (await bucket.get(key)).body,
    options,
  );
  assert.equal(copy.checksums.toJSON().sha256, checksum);
  assert.equal(
    await (await bucket.get('consulting-flow/synthetic-copy')).text(),
    text,
  );
  pass('intake-style source stream copy retains SHA-256');
  assert.equal(
    await bucket.put(key, bytes, {
      ...options,
      onlyIf: { etagMatches: 'wrong' },
    }),
    null,
  );
  assert.ok(
    await bucket.put(key, bytes, {
      ...options,
      onlyIf: { etagMatches: object.etag },
    }),
  );
  pass('conditional compare-and-swap matches native R2');
  await assert.rejects(
    bucket.put(key, 'wrong checksum', { sha256: checksum }),
    /R2_HTTP_OUTCOME_UNKNOWN/,
  );
  assert.equal(await (await bucket.get(key)).text(), text);
  pass('native checksum mismatch leaves previous bytes intact');
  const large = new Uint8Array(r2HttpLimits.objectBytes).fill(71);
  const largeHash = createHash('sha256').update(large).digest('hex');
  const largeKey = 'consulting-flow/synthetic-max-audio';
  await bucket.put(largeKey, new Blob([large]).stream(), {
    sha256: largeHash,
    onlyIf: { etagDoesNotMatch: '*' },
  });
  const downloaded = await (await bucket.get(largeKey)).arrayBuffer();
  assert.equal(downloaded.byteLength, large.length);
  assert.equal(
    createHash('sha256').update(new Uint8Array(downloaded)).digest('hex'),
    largeHash,
  );
  pass('25 MiB upload/download boundary retains exact bytes');
  await assert.rejects(
    bucket.put(
      'company-source/too-large',
      new Uint8Array(r2HttpLimits.objectBytes + 1),
    ),
    /R2_HTTP_INVALID_INPUT/,
  );
  assert.equal(await bucket.head('company-source/too-large'), null);
  pass('25 MiB plus one byte rejected before storage');
  await bucket.put('company-source/empty', null);
  assert.equal(await (await bucket.get('company-source/empty')).text(), '');
  pass('zero-byte object remains present');
  for (const headers of [
    { authorization: '' },
    { origin: 'https://browser.synthetic.invalid' },
    { cookie: 'private=synthetic' },
  ]) {
    const response = await mf.dispatchFetch(origin + r2HttpPath, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/octet-stream',
        [r2RequestHeader]: encodeR2Header({
          version: 1,
          operation: 'delete',
          key,
        }),
        ...headers,
      },
    });
    assert.ok([401, 403].includes(response.status));
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    await response.body?.cancel();
  }
  assert.ok(await bucket.head(key));
  pass('native Worker rejects browser/cookie/unauthenticated deletes');
  let sends = 0;
  const lost = createR2HttpBucket({
    origin,
    secret,
    fetcher: async (input, init) => {
      sends++;
      const response = await mf.dispatchFetch(input, init);
      await response.body?.cancel();
      throw new Error('synthetic lost response');
    },
  });
  await assert.rejects(
    lost.put('company-source/committed-lost', 'saved'),
    /R2_HTTP_OUTCOME_UNKNOWN/,
  );
  assert.equal(sends, 1);
  assert.equal(
    await (await bucket.get('company-source/committed-lost')).text(),
    'saved',
  );
  pass('lost acknowledgement causes no retry or compensating delete');
  await bucket.delete(key);
  assert.equal(await bucket.head(key), null);
  assert.equal(await bucket.get(key), null);
  pass('acknowledged delete is immediately absent');
  assert.equal(outboundRequests, 0);
  console.log(
    JSON.stringify({
      runtime: 'Node client + native R2 HTTP Worker',
      checksPassed: checks,
      liveWrites: 0,
      paidAIRequests: 0,
      outboundRequests,
    }),
  );
} finally {
  await mf.dispose();
}
