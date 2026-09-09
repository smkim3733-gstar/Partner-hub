import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createNextLocalPlatform } from '../dev/next-local/bindings.ts';

process.env.NODE_ENV = 'development';
process.env.PARTNER_HUB_LOCAL_STORAGE = '1';
process.env.PARTNER_HUB_LOCAL_STORAGE_NAME = `r2-${randomUUID().slice(0, 8)}`;
process.env.PARTNER_HUB_LOCAL_FILE_HTTP = '0';
process.env.PARTNER_HUB_LOCAL_D1_HTTP = '0';
console.log('Initializing synthetic local R2 compatibility fixture.');
const platform = await createNextLocalPlatform();
try {
  console.log('Local R2 ready.');
  const file = new File(['Synthetic local stream fixture.'], 'synthetic.txt');
  const bytes = await file.arrayBuffer();
  const sha256 = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const options = {
    sha256,
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: 'text/plain' },
  };
  const buffer = await platform.env.AI_SOURCE_FILES.put(
    'synthetic-buffer',
    bytes,
    options,
  );
  assert.ok(buffer);
  console.log('PASS local conditional buffer put with SHA-256.');
  const stream = await Promise.race([
    platform.env.AI_SOURCE_FILES.put(
      'synthetic-stream',
      file.stream(),
      options,
    ),
    new Promise((_, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Local stream put exceeded 20 seconds')),
        20_000,
      );
      timeout.unref();
    }),
  ]);
  assert.ok(stream);
  assert.equal(
    await (await platform.env.AI_SOURCE_FILES.get('synthetic-stream')).text(),
    await file.text(),
  );
  assert.equal(
    await platform.env.AI_SOURCE_FILES.put(
      'synthetic-stream',
      file.stream(),
      options,
    ),
    null,
  );
  const overwritten = await platform.env.AI_SOURCE_FILES.put(
    'synthetic-stream',
    file.stream(),
    { ...options, onlyIf: { etagMatches: stream.etag } },
  );
  assert.ok(overwritten);
  assert.deepEqual(new Uint8Array(overwritten.checksums.sha256), sha256);
  console.log(
    'PASS local stream put, private read, conditional no-overwrite and checksum retention.',
  );
} finally {
  await platform.dispose();
}
