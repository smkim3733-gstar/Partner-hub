import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localR2PutValue } from '../dev/next-local/r2-proxy';

void test('local R2 byte adaptation preserves stream chunks and non-stream values', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  assert.equal(await localR2PutValue(bytes), bytes);
  assert.equal(await localR2PutValue('synthetic'), 'synthetic');
  assert.equal(await localR2PutValue(null), null);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 2));
      controller.enqueue(bytes.subarray(2));
      controller.close();
    },
  });
  assert.deepEqual(
    new Uint8Array((await localR2PutValue(stream)) as ArrayBuffer),
    bytes,
  );
});
void test('local R2 rejects and cancels oversized streams before a put can begin', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(25 * 1024 * 1024 + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(localR2PutValue(stream), /private file limit/);
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
});
void test('local R2 interrupted or non-byte streams fail without partial data', async () => {
  const failed = new ReadableStream({
    start(controller) {
      controller.error(new Error('synthetic interruption'));
    },
  });
  await assert.rejects(localR2PutValue(failed), /synthetic interruption/);
  const invalid = new ReadableStream({
    start(controller) {
      controller.enqueue('not bytes');
    },
  });
  await assert.rejects(localR2PutValue(invalid), /must contain bytes/);
});
