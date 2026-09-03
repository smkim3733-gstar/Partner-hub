import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applicationApplicantNameMaxLength,
  emptyApplicationServices,
  prepareApplicationCoreFields,
} from '../lib/application-draft';
import { applicationCompanyMaxLength } from '../lib/application-details';

void test('new application starts without an invented service selection', () => {
  const first = emptyApplicationServices();
  const second = emptyApplicationServices();
  assert.deepEqual(first, []);
  assert.notEqual(first, second);
});

void test('application core fields trim explicit input and deduplicate services', () => {
  assert.deepEqual(
    prepareApplicationCoreFields({
      applicantName: '  홍길동  ',
      companyName: '  세림테크  ',
      selectedServices: ['정책자금', '기업인증', '정책자금'],
    }),
    {
      ok: true,
      value: {
        applicantName: '홍길동',
        companyName: '세림테크',
        selectedServices: ['정책자금', '기업인증'],
      },
    },
  );
});

void test('application step one requires a bounded applicant name', () => {
  const base = { companyName: '', selectedServices: [] };
  assert.deepEqual(prepareApplicationCoreFields({ ...base, applicantName: ' ' }, 1), {
    ok: false,
    step: 1,
    error: `신청자 이름은 1~${applicationApplicantNameMaxLength}자로 입력해 주세요.`,
  });
  assert.equal(
    prepareApplicationCoreFields(
      { ...base, applicantName: '가'.repeat(applicationApplicantNameMaxLength + 1) },
      1,
    ).ok,
    false,
  );
});

void test('application step two requires a bounded company name', () => {
  const base = { applicantName: '신청자', selectedServices: [] };
  assert.equal(
    prepareApplicationCoreFields({ ...base, companyName: ' ' }, 2).ok,
    false,
  );
  assert.equal(
    prepareApplicationCoreFields(
      { ...base, companyName: '가'.repeat(applicationCompanyMaxLength + 1) },
      2,
    ).ok,
    false,
  );
});

void test('application step three requires an explicit allowed service', () => {
  const base = { applicantName: '신청자', companyName: '기업' };
  assert.deepEqual(
    prepareApplicationCoreFields({ ...base, selectedServices: [] }),
    {
      ok: false,
      step: 3,
      error: '요청서비스를 목록에서 한 개 이상 선택해 주세요.',
    },
  );
  assert.equal(
    prepareApplicationCoreFields({
      ...base,
      selectedServices: ['임의 서비스'],
    }).ok,
    false,
  );
});

void test('earlier application steps do not invent later required values', () => {
  assert.deepEqual(
    prepareApplicationCoreFields(
      { applicantName: ' 신청자 ', companyName: '', selectedServices: [] },
      1,
    ),
    {
      ok: true,
      value: { applicantName: '신청자', companyName: '', selectedServices: [] },
    },
  );
});
