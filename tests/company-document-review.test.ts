import assert from 'node:assert/strict';
import test from 'node:test';
import { companyDocumentStatusError } from '../lib/company-document-review';

void test('fileless request cards cannot be marked submitted or reviewed', () => {
  for (const status of ['제출완료', '검토완료']) assert.ok(companyDocumentStatusError({}, status));
  for (const status of ['요청중', '보완필요']) assert.equal(companyDocumentStatusError({}, status), null);
});

void test('a stored file can move through every document review status', () => {
  for (const status of ['요청중', '제출완료', '보완필요', '검토완료']) {
    assert.equal(companyDocumentStatusError({ storageFileId: 'synthetic-file' }, status), null);
  }
});
