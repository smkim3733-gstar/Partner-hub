import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareDocumentRequest } from '../lib/legacy-document-request';

void test('legacy document request validates a real due date and a non-empty item list', () => {
  for (const dueDate of ['', '2026-02-29', '2026-04-31', '2026-09-01T10:00']) assert.equal(prepareDocumentRequest([{ name: '가상서류', required: true }], dueDate).ok, false);
  assert.equal(prepareDocumentRequest([{ name: ' ', required: true }], '2028-02-29').ok, false);
  assert.equal(prepareDocumentRequest([{ name: '가상서류', required: true }], '2028-02-29').ok, true);
});

void test('request items are trimmed, deduplicated and keep the stricter required flag without mutating input', () => {
  const items = [{ name: ' 가상 확인서 ', required: false }, { name: '가상 확인서', required: true }, { name: '가상 첨부', required: false }];
  const before = structuredClone(items);
  const result = prepareDocumentRequest(items, '2026-09-30');
  assert.ok(result.ok);
  assert.deepEqual(result.items, [{ name: '가상 확인서', required: true }, { name: '가상 첨부', required: false }]);
  assert.deepEqual(items, before);
});

void test('outstanding requests are skipped and an all-duplicate request is blocked', () => {
  const mixed = prepareDocumentRequest([{ name: '기존 자료', required: true }, { name: '새 자료', required: true }], '2026-09-30', [' 기존 자료 ']);
  assert.ok(mixed.ok);
  assert.deepEqual(mixed.items.map(item => item.name), ['새 자료']);
  assert.equal(mixed.skippedOutstanding, 1);
  const duplicate = prepareDocumentRequest([{ name: '기존 자료', required: true }], '2026-09-30', ['기존 자료']);
  assert.equal(duplicate.ok, false);
});
