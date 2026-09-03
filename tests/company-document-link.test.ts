import assert from 'node:assert/strict';
import test from 'node:test';
import {
  prependStoredCompanyDocument,
  storedCompanyDocument,
} from '../lib/company-document-link';

const stored = {
  id: 'stored-file-1',
  fileName: '재무제표.pdf',
  sizeBytes: 2048,
  contentType: 'application/pdf',
  createdAt: '2026-09-03T00:00:00.000Z',
  assignedTrainee: '가상 담당자',
  partnerMemberId: 'partner-1',
  category: '재무제표' as const,
  title: '2025년 재무제표',
};
const existing = [{
  id: 'existing-document',
  storageFileId: 'existing-storage',
  title: '기존 자료',
  status: '검토완료',
  marker: 'existing',
}];

void test('stored upload becomes one immutable authoritative document card', () => {
  const originalStored = structuredClone(stored);
  const originalExisting = structuredClone(existing);
  const document = storedCompanyDocument(stored, '가상 기업', '가상 담당자');
  const linked = prependStoredCompanyDocument(existing, document);

  assert.equal(linked.ok, true);
  if (!linked.ok) return;
  assert.equal(linked.added, true);
  const created = linked.documents[0];
  assert.ok(created && 'assignedTrainee' in created);
  assert.equal(created.id, 'file-stored-file-1');
  assert.equal(created.storageFileId, stored.id);
  assert.equal(created.title, stored.title);
  assert.equal(created.assignedTrainee, stored.assignedTrainee);
  assert.equal(created.partnerMemberId, stored.partnerMemberId);
  assert.equal(created.sensitive, true);
  assert.equal(linked.documents[1], existing[0]);
  assert.deepEqual(stored, originalStored);
  assert.deepEqual(existing, originalExisting);
});

void test('same recovered original reuses the existing card without resetting its status', () => {
  const document = storedCompanyDocument(stored, '가상 기업', '가상 담당자');
  const reviewed = [{ ...document, status: '검토완료' as const, updatedAt: '어제' }];
  const linked = prependStoredCompanyDocument(reviewed, document);

  assert.equal(linked.ok, true);
  if (!linked.ok) return;
  assert.equal(linked.added, false);
  assert.equal(linked.documents, reviewed);
  assert.equal(linked.documents[0]?.status, '검토완료');
  assert.deepEqual(prependStoredCompanyDocument(reviewed, document), linked);
});

void test('document ID and storage ID collisions never overwrite another card', () => {
  const document = storedCompanyDocument(stored, '가상 기업', '가상 담당자');
  const idCollision = prependStoredCompanyDocument(
    [{ ...existing[0], id: document.id }],
    document,
  );
  const storageCollision = prependStoredCompanyDocument(
    [{ ...existing[0], storageFileId: document.storageFileId }],
    document,
  );
  const duplicateCollision = prependStoredCompanyDocument(
    [document, { ...document }],
    document,
  );

  assert.equal(idCollision.ok, false);
  assert.equal(storageCollision.ok, false);
  assert.equal(duplicateCollision.ok, false);
  if (!idCollision.ok) assert.match(idCollision.error, /자료 연결이 충돌/);
});
