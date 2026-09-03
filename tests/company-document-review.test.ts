import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCompanyDocumentStatusDraft,
  companyDocumentStatusError,
  createCompanyDocumentStatusDraft,
} from '../lib/company-document-review';

void test('fileless request cards cannot be marked submitted or reviewed', () => {
  for (const status of ['제출완료', '검토완료']) assert.ok(companyDocumentStatusError({}, status));
  for (const status of ['요청중', '보완필요']) assert.equal(companyDocumentStatusError({}, status), null);
});

void test('a stored file can move through every document review status', () => {
  for (const status of ['요청중', '제출완료', '보완필요', '검토완료']) {
    assert.equal(companyDocumentStatusError({ storageFileId: 'synthetic-file' }, status), null);
  }
});

void test('document status selection remains isolated until explicit apply', () => {
  const document = {
    id: 'review-document',
    title: '가상 검토자료',
    status: '제출완료' as const,
    storageFileId: 'synthetic-file',
    updatedAt: '어제',
  };
  const original = structuredClone(document);
  const draft = createCompanyDocumentStatusDraft(document, '검토완료');
  assert.deepEqual(document, original);
  assert.deepEqual(draft, {
    documentId: document.id,
    expectedStatus: '제출완료',
    nextStatus: '검토완료',
    expectedStorageFileId: document.storageFileId,
  });
  const changed = applyCompanyDocumentStatusDraft(document, draft);
  assert.equal(changed.status, '검토완료');
  assert.equal(changed.updatedAt, '방금 전');
  assert.deepEqual(document, original);
});

void test('document status apply rejects same, invalid, stale and fileless completion', () => {
  const document = {
    id: 'guarded-document',
    status: '제출완료' as const,
    storageFileId: 'synthetic-file',
    updatedAt: '어제',
  };
  const draft = createCompanyDocumentStatusDraft(document, '보완필요');
  assert.ok(companyDocumentStatusError(document, '임의상태'));
  assert.throws(() => createCompanyDocumentStatusDraft(document, document.status), /이미 현재/);
  assert.throws(() => createCompanyDocumentStatusDraft(document, '임의상태'), /다시 선택/);
  assert.throws(() => createCompanyDocumentStatusDraft({ ...document, status: '요청중', storageFileId: undefined }, '검토완료'), /실제 파일/);
  assert.throws(() => applyCompanyDocumentStatusDraft({ ...document, status: '검토완료' }, draft), /상태 또는 원본/);
  assert.throws(() => applyCompanyDocumentStatusDraft({ ...document, storageFileId: 'replacement' }, draft), /상태 또는 원본/);
  assert.throws(() => applyCompanyDocumentStatusDraft(document, { ...draft, documentId: 'other' }), /자료를 다시 확인/);
});
