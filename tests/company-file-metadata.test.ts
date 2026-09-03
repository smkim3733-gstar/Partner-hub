import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPANY_FILE_COMPANY_MAX_LENGTH,
  COMPANY_FILE_TITLE_MAX_LENGTH,
  prepareCompanyFileMetadata,
} from '../lib/company-file-metadata';

void test('company file metadata trims explicit operational input', () => {
  assert.deepEqual(
    prepareCompanyFileMetadata({
      company: '  세림테크  ',
      title: '  2026년 사업자등록증  ',
      category: '사업자등록증',
    }),
    {
      ok: true,
      value: {
        company: '세림테크',
        title: '2026년 사업자등록증',
        category: '사업자등록증',
      },
    },
  );
});

void test('company file metadata refuses blank company and title', () => {
  assert.deepEqual(
    prepareCompanyFileMetadata({
      company: ' ',
      title: '자료',
      category: '기타자료',
    }),
    { ok: false, error: '기업명을 입력해 주세요.' },
  );
  assert.deepEqual(
    prepareCompanyFileMetadata({
      company: '기업',
      title: ' ',
      category: '기타자료',
    }),
    { ok: false, error: '자료명을 입력해 주세요.' },
  );
});

void test('company file metadata bounds fields before upload', () => {
  assert.equal(
    prepareCompanyFileMetadata({
      company: '가'.repeat(COMPANY_FILE_COMPANY_MAX_LENGTH + 1),
      title: '자료',
      category: '기타자료',
    }).ok,
    false,
  );
  assert.equal(
    prepareCompanyFileMetadata({
      company: '기업',
      title: '가'.repeat(COMPANY_FILE_TITLE_MAX_LENGTH + 1),
      category: '기타자료',
    }).ok,
    false,
  );
});

void test('company file metadata refuses an unknown category', () => {
  assert.deepEqual(
    prepareCompanyFileMetadata({
      company: '기업',
      title: '자료',
      category: '임의종류',
    }),
    { ok: false, error: '자료종류를 선택해 주세요.' },
  );
});
