import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDiagnosisReviewQueueDraft,
  createDiagnosisReviewQueueDraft,
} from '../lib/diagnosis-review-queue';
import { isPilotSeedRecord } from '../lib/pilot-readiness';
import { portalTaskNotificationCount } from '../lib/portal-task-notifications';

const assessment = {
  id: 'diagnosis-1',
  caseId: 'case-1',
  company: '가상 안전기업(가상)',
  identityStatus: '일치',
  hasConsultationEvidence: true,
  privacyMasked: true,
  personalDataConsent: true,
  thirdPartyAiConsent: true,
  transcriptConsent: true,
  level: 'A',
  status: '사전점검 완료',
  updatedAt: '가상 판정 완료',
};
const cases = [{ id: 'case-1', company: assessment.company }];

void test('pilot diagnosis queue remains isolated until explicit apply', () => {
  const original = structuredClone(assessment);
  const draft = createDiagnosisReviewQueueDraft(assessment, cases, [], true);
  assert.deepEqual(assessment, original);
  assert.deepEqual(draft, {
    assessmentId: assessment.id,
    caseId: assessment.caseId,
    company: assessment.company,
    expectedEvidence: JSON.stringify([
      '일치',
      true,
      true,
      true,
      true,
      true,
    ]),
    taskId: 'task-diagnosis-review-1',
  });

  const queued = applyDiagnosisReviewQueueDraft(
    assessment,
    draft,
    cases,
    [],
    [],
    true,
  );
  assert.equal(queued.assessment.status, '대표 검토 대기');
  assert.equal(queued.task.caseId, assessment.caseId);
  assert.equal(queued.task.partnerMemberId, '');
  assert.equal(isPilotSeedRecord('task', queued.task), true);
  assert.equal(portalTaskNotificationCount([queued.task]), 0);
  assert.equal(queued.timeline?.caseId, assessment.caseId);
  assert.deepEqual(assessment, original);
});

void test('pilot diagnosis queue is deterministic and does not duplicate an open task or timeline', () => {
  const draft = createDiagnosisReviewQueueDraft(assessment, cases, [], true);
  const queued = applyDiagnosisReviewQueueDraft(
    assessment,
    draft,
    cases,
    [],
    [{ caseId: assessment.caseId, title: 'AI 1차 진단 초안 검토대기' }],
    true,
  );
  assert.equal(queued.timeline, null);
  assert.throws(
    () => createDiagnosisReviewQueueDraft(assessment, cases, [queued.task], true),
    /이미 이 진행/,
  );
  assert.throws(
    () => createDiagnosisReviewQueueDraft(assessment, cases, [{
      id: 'older-task',
      caseId: assessment.caseId,
      related: 'AI 진단 사전점검',
      status: '진행',
    }], true),
    /이미 이 진행/,
  );
});

void test('pilot diagnosis queue rejects non-pilot, stale and mismatched evidence', () => {
  const draft = createDiagnosisReviewQueueDraft(assessment, cases, [], true);
  assert.throws(
    () => createDiagnosisReviewQueueDraft(assessment, cases, [], false),
    /대표 관리자만/,
  );
  assert.throws(
    () => createDiagnosisReviewQueueDraft({ ...assessment, id: 'diagnosis-operational' }, cases, [], true),
    /가상 사전점검 대상/,
  );
  assert.throws(
    () => createDiagnosisReviewQueueDraft({ ...assessment, level: 'B' }, cases, [], true),
    /최신 사전판정이 A/,
  );
  assert.throws(
    () => createDiagnosisReviewQueueDraft(assessment, [{ ...cases[0], company: '다른 가상기업(가상)' }], [], true),
    /기업과 진행 연결/,
  );
  assert.throws(
    () => applyDiagnosisReviewQueueDraft({ ...assessment, privacyMasked: false, level: 'C' }, draft, cases, [], [], true),
    /사전판정 근거가 변경/,
  );
  assert.throws(
    () => applyDiagnosisReviewQueueDraft({ ...assessment, caseId: 'case-2' }, draft, cases, [], [], true),
    /가상 기업을 다시 확인/,
  );
  assert.throws(
    () => applyDiagnosisReviewQueueDraft(assessment, draft, cases, [], [], false),
    /관리자 권한/,
  );
});
