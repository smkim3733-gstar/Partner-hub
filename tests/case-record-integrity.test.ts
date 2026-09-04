import assert from 'node:assert/strict';
import test from 'node:test';
import { caseRecordStateError } from '../lib/case-record-integrity';

const members = [
  { id: 'partner-one', name: '가상 파트너' },
  { id: 'partner-two', name: '가상 동료' },
];
const caseRecord = {
  id: 'case-one',
  company: '가상 기업',
  trainee: '가상 파트너',
  partnerMemberId: 'partner-one',
};

void test('case integrity accepts linked, representative-only and legacy assignments', () => {
  assert.equal(caseRecordStateError([caseRecord], members), null);
  assert.equal(
    caseRecordStateError(
      [{ ...caseRecord, trainee: '김성민 대표', partnerMemberId: '' }],
      members,
    ),
    null,
  );
  const legacy = { ...caseRecord };
  delete (legacy as Partial<typeof caseRecord>).partnerMemberId;
  assert.equal(caseRecordStateError([legacy], members), null);
});

void test('case integrity rejects missing or padded display fields', () => {
  for (const invalid of [
    { ...caseRecord, company: '' },
    { ...caseRecord, company: ' 가상 기업' },
    { ...caseRecord, trainee: ' ' },
    { ...caseRecord, trainee: '가상 파트너 ' },
  ])
    assert.match(
      caseRecordStateError([invalid], members) ?? '',
      /필수 표시 필드/,
    );
});

void test('case integrity rejects malformed, missing and ambiguous member links', () => {
  for (const partnerMemberId of [null, 1, ' partner-one', 'missing-member'])
    assert.match(
      caseRecordStateError([{ ...caseRecord, partnerMemberId }], members) ?? '',
      /담당 계정 연결/,
    );
  assert.match(
    caseRecordStateError(
      [caseRecord],
      [...members, { id: 'partner-one', name: '중복 계정' }],
    ) ?? '',
    /담당 계정 연결/,
  );
});
