import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applicationApplicantNameMaxLength,
  applicationApplicantAccountProblem,
  applicationApplicantTypeForForm,
  applicationApplicantTypeForRestoredDraft,
  applicationApplicantTypeIsEditable,
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
      applicantType: '보험설계사',
      applicantName: '  홍길동  ',
      companyName: '  세림테크  ',
      selectedServices: ['정책자금', '기업인증', '정책자금'],
    }),
    {
      ok: true,
      value: {
        applicantType: '보험설계사',
        applicantName: '홍길동',
        companyName: '세림테크',
        selectedServices: ['정책자금', '기업인증'],
      },
    },
  );
});

void test('application step one requires a bounded applicant name', () => {
  const base = { applicantType: '기타', companyName: '', selectedServices: [] };
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
  const base = { applicantType: '기타', applicantName: '신청자', selectedServices: [] };
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
  const base = { applicantType: '기타', applicantName: '신청자', companyName: '기업' };
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
      { applicantType: '기타', applicantName: ' 신청자 ', companyName: '', selectedServices: [] },
      1,
    ),
    {
      ok: true,
      value: { applicantType: '기타', applicantName: '신청자', companyName: '', selectedServices: [] },
    },
  );
});

void test('application step one requires an explicit allowed applicant type', () => {
  const base = { applicantName: '신청자', companyName: '', selectedServices: [] };
  assert.deepEqual(prepareApplicationCoreFields({ ...base, applicantType: '' }, 1), {
    ok: false,
    step: 1,
    error: '파트너 유형을 선택해 주세요.',
  });
  assert.equal(prepareApplicationCoreFields({ ...base, applicantType: '관리자' }, 1).ok, false);
});

void test('only representative proxy intake starts without an applicant type', () => {
  assert.equal(applicationApplicantTypeForForm(true, '한기평 컨설턴트'), '');
  assert.equal(applicationApplicantTypeForForm(false, '보험설계사'), '보험설계사');
  assert.equal(applicationApplicantTypeForRestoredDraft(true, '한기평 컨설턴트', '', '보험설계사'), '');
  assert.equal(applicationApplicantTypeForRestoredDraft(true, '한기평 컨설턴트', 'partner-1', '보험설계사'), '보험설계사');
  assert.equal(applicationApplicantTypeForRestoredDraft(false, '타사 컨설턴트', 'partner-1', '보험설계사'), '타사 컨설턴트');
  assert.equal(applicationApplicantTypeIsEditable(true, ''), true);
  assert.equal(applicationApplicantTypeIsEditable(true, 'partner-1'), false);
  assert.equal(applicationApplicantTypeIsEditable(false, ''), false);
});

void test('a shared account must remain active and match the submitted applicant type', () => {
  const member = { id: 'partner-1', status: '활성', applicantType: '보험설계사' as const };
  assert.equal(applicationApplicantAccountProblem('', '기타'), '');
  assert.equal(applicationApplicantAccountProblem('partner-1', '보험설계사', member), '');
  assert.equal(applicationApplicantAccountProblem('partner-2', '보험설계사', member), '자료 공유 계정을 다시 선택해 주세요.');
  assert.equal(applicationApplicantAccountProblem('partner-1', '기타', member), '신청자 유형이 공유 계정의 등록 유형과 일치하지 않습니다. 계정을 다시 선택해 주세요.');
  assert.equal(applicationApplicantAccountProblem('partner-1', '보험설계사', { ...member, status: '정지' }), '자료 공유 계정을 다시 선택해 주세요.');
});
