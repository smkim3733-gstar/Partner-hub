import assert from 'node:assert/strict';
import test from 'node:test';
import { TransientMessageGuard } from '../lib/transient-message-guard';

void test('only the newest transient message callback can expire the message', () => {
  const guard = new TransientMessageGuard();
  const expired: string[] = [];
  const first = guard.next(() => expired.push('first'));
  const second = guard.next(() => expired.push('second'));

  assert.equal(first(), false);
  assert.deepEqual(expired, []);
  assert.equal(second(), true);
  assert.deepEqual(expired, ['second']);
  assert.equal(second(), false);
});

void test('cancel invalidates a pending transient message callback', () => {
  const guard = new TransientMessageGuard();
  let expired = false;
  const pending = guard.next(() => {
    expired = true;
  });

  guard.cancel();

  assert.equal(pending(), false);
  assert.equal(expired, false);
});
