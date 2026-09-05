import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_COMPANY_FILE_BYTES } from '../lib/company-file-policy';
import {
  companyDocumentFileMetadataMutationError,
  companyDocumentFileMetadataStateError,
} from '../lib/company-document-file-metadata-integrity';

const requestDocument = {
  id: 'document-request',
  company: '세림테크',
  title: '최근 재무제표',
  category: '재무제표',
  status: '요청중',
  assignedTrainee: '박지현',
  submittedBy: '기업대표 요청',
  updatedAt: '방금 전',
  version: '-',
  sensitive: true,
};

const storedDocument = {
  ...requestDocument,
  id: 'document-stored',
  status: '제출완료',
  storageFileId: 'stored-file-one',
  fileName: '세림테크_재무제표.pdf',
  fileSize: 12_345,
  partnerMemberId: 'member-one',
  caseId: 'case-one',
};

void test('accepts empty requests, filename-only legacy cards, and complete stored originals', () => {
  assert.equal(companyDocumentFileMetadataStateError([]), null);
  assert.equal(companyDocumentFileMetadataStateError([requestDocument]), null);
  assert.equal(
    companyDocumentFileMetadataStateError([
      { ...requestDocument, fileName: '과거_표시자료.pdf' },
    ]),
    null,
  );
  assert.equal(
    companyDocumentFileMetadataStateError([storedDocument]),
    null,
  );
});

void test('rejects malformed original IDs and incomplete stored tuples', () => {
  for (const document of [
    { ...storedDocument, storageFileId: 7 },
    { ...storedDocument, storageFileId: ' ' },
    { ...storedDocument, storageFileId: ' padded-file-id ' },
    { ...storedDocument, storageFileId: 'short' },
    { ...storedDocument, fileName: undefined },
    { ...storedDocument, fileSize: undefined },
    { ...requestDocument, fileSize: 12_345 },
  ]) {
    assert.match(
      companyDocumentFileMetadataStateError([document]) ?? '',
      /기업자료 원본/,
    );
  }
});

void test('rejects unsafe filenames and invalid stored sizes', () => {
  for (const document of [
    { ...requestDocument, fileName: ' ' },
    { ...requestDocument, fileName: '../재무제표.pdf' },
    { ...requestDocument, fileName: 'e\u0301vidence.pdf' },
    { ...requestDocument, fileName: `${'가'.repeat(181)}.pdf` },
    { ...storedDocument, fileSize: '12345' },
    { ...storedDocument, fileSize: 0 },
    { ...storedDocument, fileSize: 1.5 },
    { ...storedDocument, fileSize: MAX_COMPANY_FILE_BYTES + 1 },
  ]) {
    assert.match(
      companyDocumentFileMetadataStateError([document]) ?? '',
      /기업자료 (파일명|원본 크기)/,
    );
  }
});

void test('rejects duplicate stored originals and category-incompatible file formats', () => {
  assert.match(
    companyDocumentFileMetadataStateError([
      storedDocument,
      { ...storedDocument, id: 'document-duplicate' },
    ]) ?? '',
    /중복/,
  );
  assert.match(
    companyDocumentFileMetadataStateError([
      { ...storedDocument, fileName: '재무제표.mp3' },
    ]) ?? '',
    /형식/,
  );
});

void test('permits review-only changes while protecting every existing original fact', () => {
  assert.equal(
    companyDocumentFileMetadataMutationError(
      [storedDocument],
      [
        {
          ...storedDocument,
          status: '검토완료',
          updatedAt: '방금 전',
          assignedTrainee: '파트너 변경표시명',
        },
      ],
    ),
    null,
  );
  for (const next of [
    [],
    [{ ...storedDocument, id: 'document-renamed' }],
    [{ ...storedDocument, storageFileId: 'stored-file-two' }],
    [{ ...storedDocument, fileName: '다른_재무제표.pdf' }],
    [{ ...storedDocument, fileSize: 54_321 }],
    [{ ...storedDocument, company: '다른기업' }],
    [{ ...storedDocument, category: '기타자료' }],
    [{ ...storedDocument, partnerMemberId: 'member-two' }],
    [{ ...storedDocument, caseId: 'case-two' }],
  ]) {
    assert.match(
      companyDocumentFileMetadataMutationError([storedDocument], next) ?? '',
      /일반 저장으로 변경하거나 삭제할 수 없습니다/,
    );
  }
});

void test('leaves collection shape failures to the outer portal-state boundary', () => {
  assert.equal(companyDocumentFileMetadataStateError(null), null);
  assert.equal(companyDocumentFileMetadataStateError([null]), null);
  assert.equal(companyDocumentFileMetadataMutationError(null, []), null);
});
