import assert from 'node:assert/strict';
import test from 'node:test';

import {
  diagnosisAssessmentStateError,
  isDiagnosisAssessmentRecord,
} from '../lib/diagnosis-assessment';

const linkedCase = { id: 'case-diagnosis', company: '가상 진단기업(가상)' };
const assessment = {
  id: 'diagnosis-integrity',
  caseId: linkedCase.id,
  company: linkedCase.company,
  identityStatus: '일치',
  hasConsultationEvidence: true,
  privacyMasked: true,
  personalDataConsent: true,
  thirdPartyAiConsent: true,
  transcriptConsent: true,
  level: 'A',
  decision: '1차 초안 생성 가능',
  status: '사전점검 완료',
  updatedAt: '가상 판정 완료',
};

void test('diagnosis assessment contract accepts only consistent A, B and C results', () => {
  assert.equal(isDiagnosisAssessmentRecord(assessment), true);
  assert.equal(
    isDiagnosisAssessmentRecord({ ...assessment, status: '대표 검토 대기' }),
    true,
  );
  assert.equal(
    isDiagnosisAssessmentRecord({
      ...assessment,
      level: 'B',
      decision: 'Step 0·보완요청',
      status: '보완자료 대기',
    }),
    true,
  );
  assert.equal(
    isDiagnosisAssessmentRecord({
      ...assessment,
      level: 'C',
      decision: 'AI 처리 중단',
      status: '처리 중단',
    }),
    true,
  );
  for (const invalid of [
    { ...assessment, identityStatus: '확인됨' },
    { ...assessment, privacyMasked: 1 },
    { ...assessment, decision: 'AI 처리 중단' },
    { ...assessment, status: '완료' },
    { ...assessment, updatedAt: ' ' },
  ])
    assert.equal(isDiagnosisAssessmentRecord(invalid), false);
});

void test('diagnosis assessment state requires unique IDs and one exact case-company link', () => {
  assert.equal(diagnosisAssessmentStateError(undefined, [linkedCase]), null);
  assert.equal(diagnosisAssessmentStateError([], [linkedCase]), null);
  assert.equal(
    diagnosisAssessmentStateError([assessment], [linkedCase]),
    null,
  );
  for (const [assessments, cases] of [
    [[null], [linkedCase]],
    [[{ ...assessment, id: ' ' }], [linkedCase]],
    [[assessment, assessment], [linkedCase]],
    [[{ ...assessment, caseId: 'missing-case' }], [linkedCase]],
    [[{ ...assessment, company: '다른 기업(가상)' }], [linkedCase]],
    [[assessment], [linkedCase, linkedCase]],
  ])
    assert.notEqual(diagnosisAssessmentStateError(assessments, cases), null);
});
