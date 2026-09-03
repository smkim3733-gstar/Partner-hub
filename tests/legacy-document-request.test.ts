import assert from 'node:assert/strict';
import test from 'node:test';
import {
  documentRequestItemNameMaxLength,
  documentRequestDueState,
  emptyDocumentRequestItems,
  prepareDocumentRequest,
  prepareDocumentRequestItem,
} from '../lib/legacy-document-request';

void test('document request due state follows the Korean calendar boundary', () => {
  const beforeKoreanMidnight = new Date('2026-09-02T14:59:59.000Z');
  const afterKoreanMidnight = new Date('2026-09-02T15:00:00.000Z');
  assert.equal(documentRequestDueState('2026-09-03', beforeKoreanMidnight), 'upcoming');
  assert.equal(documentRequestDueState('2026-09-03', afterKoreanMidnight), 'today');
  assert.equal(documentRequestDueState('2026-09-02', afterKoreanMidnight), 'overdue');
  assert.equal(documentRequestDueState('2026-09-04', afterKoreanMidnight), 'upcoming');
  assert.equal(documentRequestDueState('2026-02-29', afterKoreanMidnight), null);
  assert.equal(documentRequestDueState('2026-09-03', new Date('invalid')), null);
});

void test('prepared request carries the due state used by its follow-up task', () => {
  const result = prepareDocumentRequest(
    [{ name: '가상 확인서' }],
    '2026-09-03',
    [],
    new Date('2026-09-02T15:00:00.000Z'),
  );
  assert.ok(result.ok);
  assert.equal(result.dueState, 'today');
});

void test('new document request starts without invented documents or requirement flags', () => {
  assert.deepEqual(emptyDocumentRequestItems(), []);
});

void test('document request item requires a bounded explicit name', () => {
  assert.equal(prepareDocumentRequestItem(' ').ok, false);
  assert.equal(prepareDocumentRequestItem('가'.repeat(documentRequestItemNameMaxLength + 1)).ok, false);
  assert.deepEqual(prepareDocumentRequestItem(' 가상 확인서 '), {
    ok: true,
    item: { name: '가상 확인서' },
  });
});

void test('document request item rejects a duplicate current or outstanding name', () => {
  assert.deepEqual(prepareDocumentRequestItem(' 가상 확인서 ', ['가상 확인서']), {
    ok: false,
    field: 'name',
    error: '이미 추가했거나 요청 중인 서류입니다.',
  });
});

void test('legacy document request validates a real due date and a non-empty item list', () => {
  for (const dueDate of ['', '2026-02-29', '2026-04-31', '2026-09-01T10:00']) assert.equal(prepareDocumentRequest([{ name: '가상서류' }], dueDate).ok, false);
  assert.equal(prepareDocumentRequest([{ name: ' ' }], '2028-02-29').ok, false);
  assert.equal(prepareDocumentRequest([{ name: '가상서류' }], '2028-02-29').ok, true);
});

void test('request items are trimmed and deduplicated without mutating input', () => {
  const items = [{ name: ' 가상 확인서 ' }, { name: '가상 확인서' }, { name: '가상 첨부' }];
  const before = structuredClone(items);
  const result = prepareDocumentRequest(items, '2026-09-30');
  assert.ok(result.ok);
  assert.deepEqual(result.items, [{ name: '가상 확인서' }, { name: '가상 첨부' }]);
  assert.deepEqual(items, before);
});

void test('save boundary rejects overlong names', () => {
  assert.equal(prepareDocumentRequest([{ name: '가'.repeat(documentRequestItemNameMaxLength + 1) }], '2026-09-30').ok, false);
});

void test('outstanding requests are skipped and an all-duplicate request is blocked', () => {
  const mixed = prepareDocumentRequest([{ name: '기존 자료' }, { name: '새 자료' }], '2026-09-30', [' 기존 자료 ']);
  assert.ok(mixed.ok);
  assert.deepEqual(mixed.items.map(item => item.name), ['새 자료']);
  assert.equal(mixed.skippedOutstanding, 1);
  const duplicate = prepareDocumentRequest([{ name: '기존 자료' }], '2026-09-30', ['기존 자료']);
  assert.equal(duplicate.ok, false);
});
