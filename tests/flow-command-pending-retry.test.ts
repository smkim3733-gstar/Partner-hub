import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearFlowCommandPendingRetry,
  rememberFlowCommandPendingRetry,
  restoreFlowCommandPendingRetry,
} from '../lib/flow-command-pending-retry';

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const caseId = 'case-refresh-retry';
const key = 'a'.repeat(64);
const retry = { key, id: '018f47c8-5912-7a33-b54a-12a9aab32f52' };

void test('pending attachment retry survives a same-tab refresh', () => {
  const storage = new MemoryStorage();
  assert.equal(rememberFlowCommandPendingRetry(storage, caseId, retry), true);
  assert.deepEqual(restoreFlowCommandPendingRetry(storage, caseId, key), retry);
});

void test('pending retry is scoped to identical case and content', () => {
  const storage = new MemoryStorage();
  rememberFlowCommandPendingRetry(storage, caseId, retry);
  assert.equal(
    restoreFlowCommandPendingRetry(storage, 'case-other', key),
    null,
  );
  assert.equal(
    restoreFlowCommandPendingRetry(storage, caseId, 'b'.repeat(64)),
    null,
  );
});

void test('successful save clears only its exact pending retry', () => {
  const storage = new MemoryStorage();
  rememberFlowCommandPendingRetry(storage, caseId, retry);
  assert.equal(
    clearFlowCommandPendingRetry(storage, caseId, {
      ...retry,
      id: 'wrong-request-id',
    }),
    false,
  );
  assert.deepEqual(restoreFlowCommandPendingRetry(storage, caseId, key), retry);
  assert.equal(clearFlowCommandPendingRetry(storage, caseId, retry), true);
  assert.equal(restoreFlowCommandPendingRetry(storage, caseId, key), null);
});

void test('malformed, oversized, and unavailable storage fail closed', () => {
  const storage = new MemoryStorage();
  storage.values.set(
    'partner-hub:consulting-flow:pending-upload:v1',
    '{"caseId":"../escape"}',
  );
  assert.equal(restoreFlowCommandPendingRetry(storage, caseId, key), null);
  assert.equal(storage.values.size, 0);

  storage.values.set(
    'partner-hub:consulting-flow:pending-upload:v1',
    'x'.repeat(513),
  );
  assert.equal(restoreFlowCommandPendingRetry(storage, caseId, key), null);
  assert.equal(storage.values.size, 0);
  assert.equal(
    rememberFlowCommandPendingRetry(undefined, caseId, retry),
    false,
  );
});
