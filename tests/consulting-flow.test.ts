import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFlowCommand,
  analysisDone,
  deepReport,
  depositComplete,
  documentsDone,
  explicitFlowBooleanChoice,
  firstMeeting,
  FlowError,
  flowBooleanChoiceDefault,
  latestReport,
  newConsultingFlow,
  phaseOf,
  signingPreparationDone,
  type ConsultingFlow,
  type FlowAiEvidence,
  type FlowAiSuccessObservation,
  type FlowAiFailureEvidence,
  type FlowAiFailureObservation,
  type FlowActor,
  type FlowCommand,
  type FlowFile,
} from '../lib/consulting-flow';
import { flowFileStorageKey } from '../lib/consulting-flow-file-policy';
import { claimFlowJob, finishFlowJob } from '../lib/consulting-flow-jobs';
import {
  resolveFlowAssignment,
  publicFlow,
} from '../lib/consulting-flow-access';
import { projectFlowState } from '../lib/consulting-flow-projection';
import { stateForPortalUser, type PortalUser } from '../lib/portal-auth';
import {
  describeUpload,
  escapeHtml,
  parseFlowRequest,
} from '../lib/consulting-flow-http';
import {
  FLOW_COLLECTION_LIMITS,
  FLOW_TEXT_LIMITS,
  flowTextLength,
  hasFlowAiFailureEvidenceHistoryStructure,
  hasFlowAiFailureEvidenceStructure,
  hasFlowAiEvidenceStructure,
  isWellFormedFlowText,
} from '../lib/consulting-flow-shape';

function test(name: string, fn: () => void | Promise<void>) {
  void nodeTest(name, fn);
}

const admin: FlowActor = { id: 'owner', role: 'admin', name: '김성민 대표' };
const partner: FlowActor = {
  id: 'partner-one',
  role: 'partner',
  name: '테스트 파트너',
};
const now = '2026-08-30T11:00:00.000Z';
const body =
  '확인된 기업 자료에 기초한 내부 검토용 보고서입니다. 제출되지 않은 수치와 사실은 확인 필요로 표시하고 대표가 추가 상담에서 검토합니다. '.repeat(
    4,
  );
const aiSuccessObservation: FlowAiSuccessObservation = {
  instructionVersion: 'synthetic-flow-instruction-v1',
  requestedModel: 'claude-requested-test-model',
  providerRequestId: 'req_synthetic_flow',
  providerModel: 'claude-resolved-test-model',
  providerMessageId: 'msg_synthetic_flow',
  inputTokens: 10,
  outputTokens: 20,
  observedAt: now,
};
const aiEvidence: FlowAiEvidence = {
  ...aiSuccessObservation,
  auditId: 'synthetic-success-audit',
};
const aiFailureObservation: FlowAiFailureObservation = {
  instructionVersion: 'synthetic-flow-instruction-v1',
  requestedModel: 'claude-requested-test-model',
  httpStatus: 429,
  observedAt: now,
  providerRequestId: 'req_synthetic_failure',
};
const aiFailureEvidence: FlowAiFailureEvidence = {
  ...aiFailureObservation,
  auditId: 'synthetic-ai-result-audit',
};
test('consequential yes-no workflow choices preserve an unselected state', () => {
  assert.equal(explicitFlowBooleanChoice('yes'), true);
  assert.equal(explicitFlowBooleanChoice('no'), false);
  assert.equal(explicitFlowBooleanChoice(''), undefined);
  assert.equal(explicitFlowBooleanChoice('unknown'), undefined);
  assert.equal(flowBooleanChoiceDefault(), '');
  assert.equal(flowBooleanChoiceDefault(true), 'yes');
  assert.equal(flowBooleanChoiceDefault(false), 'no');
});
let sequence = 0;
function apply(
  flow: ConsultingFlow,
  command: FlowCommand,
  actor = admin,
  upload?: FlowFile,
) {
  return applyFlowCommand(
    flow,
    { transcriptReviewed: true, ...command },
    actor,
    {
      commandId: `test-command-${++sequence}`,
      now,
      upload,
    },
  );
}
function file(purpose = 'report', name = 'test.pdf'): FlowFile {
  const id = `file-${++sequence}`;
  return {
    id,
    purpose,
    name,
    key: flowFileStorageKey(id),
    contentType: 'application/pdf',
    size: 100,
    createdAt: now,
  };
}
function start() {
  return newConsultingFlow(
    'test-case',
    '가상 검증기업',
    'partner-one',
    '테스트 파트너',
  );
}
function reported() {
  return apply(start(), { type: 'save_report', stage: 1, body });
}
function analyzed() {
  let s = reported();
  const c = { type: 'confirm_analysis', reportId: latestReport(s, 1)!.id };
  s = apply(s, c);
  return apply(s, c, partner);
}
function booked() {
  return apply(
    analyzed(),
    {
      type: 'book_meeting',
      kind: 'first',
      attendance: 'both',
      startsAt: '2026-08-29T01:00:00Z',
      endsAt: '2026-08-29T02:00:00Z',
      location: '테스트 상담실',
    },
    partner,
  );
}
function consulted() {
  let s = booked();
  s = apply(s, { type: 'save_report', stage: 2, body });
  s = apply(
    s,
    { type: 'save_report', stage: 3 },
    admin,
    file('report', 'briefing.pptx'),
  );
  return apply(s, { type: 'complete_meeting', meetingId: firstMeeting(s)!.id });
}
function deepened() {
  let s = consulted();
  s = apply(
    s,
    {
      type: 'save_recording',
      meetingId: firstMeeting(s)!.id,
      transcript:
        '확인할 기업의 재무상태와 신규 제품 개발에 대한 상담을 진행하였습니다.',
      recordingConsent: true,
      privacyMasked: true,
    },
    partner,
  );
  return apply(s, { type: 'save_report', stage: 4, body });
}
function decided(required = true) {
  const s = deepened();
  return apply(s, {
    type: 'confirm_solutions',
    reportId: deepReport(s)!.id,
    solutions: ['정책자금 사전진단'],
    documentsNeeded: required,
    reviewConfirmed: true,
    note: required
      ? '재무자료 확인 필요'
      : '기존 제출 자료 검토 결과 추가 없음',
  });
}
function prepared() {
  let s = decided();
  s = apply(s, {
    type: 'request_document',
    title: '확인서류',
    recipient: '재무 담당',
    channel: '이메일',
    required: true,
    dueDate: '2026-09-01',
  });
  s = apply(
    s,
    { type: 'receive_document', requestId: s.requests[0].id },
    partner,
    file('requested_document'),
  );
  s = apply(s, {
    type: 'review_document',
    requestId: s.requests[0].id,
    approved: true,
  });
  s = apply(s, { type: 'save_report', stage: 5, body });
  return apply(s, { type: 'save_report', stage: 6, body });
}
function signed(attendance = 'both') {
  let s = prepared();
  s = apply(s, {
    type: 'book_meeting',
    kind: 'contract',
    attendance,
    startsAt: '2026-08-30T03:00:00Z',
    endsAt: '2026-08-30T04:00:00Z',
    location: '계약 미팅',
  });
  return apply(
    s,
    {
      type: 'record_contract',
      meetingId: s.meetings.at(-1)!.id,
      signedAt: '2026-08-30',
      expectedDepositWon: 1000000,
      signedConfirmed: true,
    },
    attendance === 'partner' ? partner : admin,
    file('signed_contract'),
  );
}
function pay(s: ConsultingFlow, amount = 1000000) {
  return apply(s, {
    type: 'confirm_payment',
    amountWon: amount,
    receivedAt: '2026-08-30',
    reference: '가상 거래 확인',
    paymentConfirmed: true,
  });
}
function fails(s: ConsultingFlow, c: FlowCommand, actor = admin) {
  assert.throws(() => apply(s, c, actor), FlowError);
}

test('full workflow: shared report, independent analysis, meetings, docs, signature, partial deposit, delivery', () => {
  assert.equal(phaseOf(start()), '1차 보고서');
  assert.equal(phaseOf(reported()), '공동분석');
  assert.equal(phaseOf(analyzed()), '초회상담 예약');
  assert.equal(phaseOf(booked()), '2차·3차 준비');
  assert.equal(phaseOf(consulted()), '녹취자료 등록');
  assert.equal(phaseOf(deepened()), '진행솔루션 확정');
  assert.equal(phaseOf(decided()), '추가서류 확인');
  assert.equal(phaseOf(prepared()), '계약 상담');
  let s = signed();
  assert.equal(phaseOf(s), '계약금 확인');
  assert.ok(!s.executionStartedAt);
  s = pay(s, 400000);
  assert.equal(depositComplete(s), false);
  assert.equal(phaseOf(s), '계약금 확인');
  s = pay(s, 600000);
  assert.equal(phaseOf(s), '컨설팅 수행');
  assert.ok(s.executionStartedAt);
  s = apply(s, {
    type: 'start_aftercare',
    summary: '수행 결과 확인',
    owner: '김성민 대표',
    nextDate: '2026-10-01',
    deliveryConfirmed: true,
  });
  assert.equal(phaseOf(s), '사후관리');
});
test('representative cannot confirm the partner analysis; latest report revision resets both stamps', () => {
  let s = reported();
  s = apply(s, {
    type: 'confirm_analysis',
    reportId: latestReport(s, 1)!.id,
    role: 'partner',
  });
  assert.ok(s.analysis.adminAt);
  assert.ok(!s.analysis.partnerAt);
  assert.equal(analysisDone(s), false);
  s = analyzed();
  const oldId = latestReport(s, 1)!.id;
  s = apply(s, { type: 'save_report', stage: 1, body });
  assert.equal(analysisDone(s), false);
  fails(s, { type: 'confirm_analysis', reportId: oldId });
});
test('partner cannot set AI policy, report, solution, document review, payment or aftercare', () => {
  for (const c of [
    { type: 'set_ai_policy', enabled: true },
    { type: 'save_report', stage: 1, body },
    { type: 'confirm_solutions' },
    { type: 'review_document' },
    { type: 'confirm_payment' },
    { type: 'start_aftercare' },
  ])
    fails(signed(), c, partner);
});
test('cannot skip consultation preparation, supply placeholder PPT, or complete a future meeting', () => {
  const s = booked();
  fails(s, { type: 'complete_meeting', meetingId: firstMeeting(s)!.id });
  fails(s, { type: 'save_report', stage: 3, body });
  let t = apply(analyzed(), {
    type: 'book_meeting',
    kind: 'first',
    attendance: 'both',
    startsAt: '2026-09-01T10:00:00Z',
    endsAt: '2026-09-01T11:00:00Z',
    location: '가상',
  });
  t = apply(t, { type: 'save_report', stage: 2, body });
  t = apply(
    t,
    { type: 'save_report', stage: 3 },
    admin,
    file('report', 'slides.pptx'),
  );
  fails(t, { type: 'complete_meeting', meetingId: firstMeeting(t)!.id });
});
test('consultations and requests repeat; overlaps are rejected without mutation', () => {
  let s = consulted();
  for (let i = 1; i <= 5; i++)
    s = apply(s, {
      type: 'book_meeting',
      kind: 'followup',
      attendance: i % 2 ? 'partner' : 'admin',
      startsAt: `2026-09-0${i}T10:00:00Z`,
      endsAt: `2026-09-0${i}T11:00:00Z`,
      location: '반복 상담',
    });
  assert.equal(s.meetings.length, 6);
  fails(s, {
    type: 'book_meeting',
    kind: 'followup',
    attendance: 'both',
    startsAt: '2026-09-01T10:30:00Z',
    endsAt: '2026-09-01T11:30:00Z',
    location: '겹친 일정',
  });
  for (let i = 0; i < 5; i++)
    s = apply(s, {
      type: 'request_document',
      title: `추가자료 ${i}`,
      recipient: '기업대표',
      channel: '카카오톡',
      required: false,
    });
  assert.equal(s.requests.length, 5);
});
test('meeting booking rejects missing kind or attendance instead of inferring it', () => {
  const s = analyzed();
  const command = {
    type: 'book_meeting',
    kind: 'first',
    attendance: 'both',
    startsAt: '2026-09-01T10:00:00Z',
    endsAt: '2026-09-01T11:00:00Z',
    location: '가상 상담실',
  };
  fails(s, { ...command, kind: '' });
  fails(s, { ...command, attendance: '' });
});
test('meeting cancellation respects attendance and identical cancellation requests remain idempotent', () => {
  const s = apply(consulted(), {
    type: 'book_meeting',
    kind: 'followup',
    attendance: 'admin',
    startsAt: '2026-09-01T10:00:00Z',
    endsAt: '2026-09-01T11:00:00Z',
    location: '가상 상담실',
  });
  const command = { type: 'cancel_meeting', meetingId: s.meetings.at(-1)!.id };
  assert.throws(
    () => apply(s, command, partner),
    (error) => error instanceof FlowError && error.status === 403,
  );
  const saved = applyFlowCommand(s, command, admin, {
    commandId: 'cancel-same-command',
    now,
  });
  assert.equal(saved.meetings.at(-1)!.status, 'cancelled');
  assert.equal(s.meetings.at(-1)!.status, 'scheduled');
  assert.equal(
    applyFlowCommand(saved, command, admin, {
      commandId: 'cancel-same-command',
      now,
    }),
    saved,
  );
  const both = booked();
  assert.equal(
    apply(
      both,
      { type: 'cancel_meeting', meetingId: firstMeeting(both)!.id },
      partner,
    ).meetings[0].status,
    'cancelled',
  );
});
test('document sent confirmation is an explicit record only and a repeated command adds no second audit event', () => {
  const s = apply(decided(), {
    type: 'request_document',
    title: '가상 확인서류',
    recipient: '가상 담당자',
    channel: '이메일',
    required: true,
  });
  const command = {
    type: 'mark_request_sent',
    requestId: s.requests[0].id,
    sentConfirmed: true,
  };
  fails(s, { ...command, sentConfirmed: false }, partner);
  const saved = applyFlowCommand(s, command, partner, {
    commandId: 'sent-same-command',
    now,
  });
  assert.equal(saved.requests[0].sentAt, now);
  assert.equal(saved.requests[0].status, 'requested');
  assert.equal(s.requests[0].sentAt, undefined);
  assert.equal(saved.audit.length, s.audit.length + 1);
  assert.equal(
    applyFlowCommand(saved, command, partner, {
      commandId: 'sent-same-command',
      now,
    }),
    saved,
  );
});
test('recording permission gates, audio-only is blocked, masked transcript is required', () => {
  const s = consulted();
  fails(s, {
    type: 'save_recording',
    meetingId: firstMeeting(s)!.id,
    transcript: body,
  });
  const c = {
    type: 'save_recording',
    meetingId: firstMeeting(s)!.id,
    recordingConsent: true,
    privacyMasked: true,
  };
  const t = apply(s, c, partner, file('recording', 'call.mp3'));
  assert.equal(t.jobs[0].status, 'blocked');
  assert.match(t.jobs[0].reason, /전사/);
  fails(s, {
    ...c,
    transcript: '대표 연락처는 010-1234-5678 입니다. 추가 연락이 필요합니다.',
  });
});
test('new recording invalidates prior deep report and decision prerequisites', () => {
  const s = prepared();
  const t = apply(
    s,
    {
      type: 'save_recording',
      meetingId: firstMeeting(s)!.id,
      transcript: body,
      recordingConsent: true,
      privacyMasked: true,
    },
    partner,
  );
  assert.equal(deepReport(t), undefined);
  assert.equal(documentsDone(t), false);
  assert.equal(signingPreparationDone(t), false);
});
test('required docs need actual files and admin review; replacing a reviewed document invalidates prepared quote/contract', () => {
  let s = decided();
  fails(s, { type: 'save_report', stage: 5, body });
  s = apply(s, {
    type: 'request_document',
    title: '필수 자료',
    recipient: '기업대표',
    channel: '이메일',
    required: true,
  });
  fails(s, {
    type: 'review_document',
    requestId: s.requests[0].id,
    approved: true,
  });
  s = prepared();
  assert.equal(signingPreparationDone(s), true);
  s = apply(
    s,
    { type: 'receive_document', requestId: s.requests[0].id },
    partner,
    file('requested_document'),
  );
  assert.equal(documentsDone(s), false);
  s = apply(s, {
    type: 'review_document',
    requestId: s.requests[0].id,
    approved: true,
  });
  assert.equal(documentsDone(s), true);
  assert.equal(signingPreparationDone(s), false);
});
test('document receipt and review times preserve retries and reset only for a new review cycle', () => {
  let s = apply(decided(), {
    type: 'request_document',
    title: '검토 시간 확인 자료',
    recipient: '가상 담당',
    channel: '기타',
    required: true,
  });
  const requestId = s.requests[0].id;
  const upload = file('requested_document');
  s = applyFlowCommand(s, { type: 'receive_document', requestId }, partner, {
    commandId: 'receipt-time-first',
    now: '2026-08-30T12:00:00.000Z',
    upload,
  });
  assert.equal(s.requests[0].receivedAt, '2026-08-30T12:00:00.000Z');

  s = applyFlowCommand(
    s,
    { type: 'receive_document', requestId, fileId: upload.id },
    partner,
    { commandId: 'receipt-time-same-file', now: '2026-08-30T13:00:00.000Z' },
  );
  assert.equal(s.requests[0].receivedAt, '2026-08-30T12:00:00.000Z');

  s = applyFlowCommand(
    s,
    { type: 'review_document', requestId, approved: false, note: '가상 보완' },
    admin,
    { commandId: 'receipt-time-needs-fix', now: '2026-08-30T14:00:00.000Z' },
  );
  assert.equal(s.requests[0].reviewedAt, '2026-08-30T14:00:00.000Z');
  assert.equal(s.requests[0].verifiedAt, undefined);

  s = applyFlowCommand(
    s,
    { type: 'receive_document', requestId, fileId: upload.id },
    partner,
    { commandId: 'receipt-time-correction', now: '2026-08-30T15:00:00.000Z' },
  );
  assert.equal(s.requests[0].receivedAt, '2026-08-30T15:00:00.000Z');
  assert.equal(s.requests[0].reviewedAt, undefined);

  s = applyFlowCommand(
    s,
    { type: 'review_document', requestId, approved: true },
    admin,
    { commandId: 'receipt-time-approved', now: '2026-08-30T16:00:00.000Z' },
  );
  assert.equal(s.requests[0].reviewedAt, '2026-08-30T16:00:00.000Z');
  assert.equal(s.requests[0].verifiedAt, '2026-08-30T16:00:00.000Z');
});
test('no-additional-docs is an explicit representative decision, not an empty-list bypass', () => {
  assert.equal(documentsDone(decided(false)), true);
  assert.equal(documentsDone(decided(true)), false);
});
test('only actual signed copy and eligible attendee can record signature; all attendance variants work', () => {
  for (const attendance of ['both', 'partner', 'admin'])
    assert.ok(signed(attendance).contract);
  let s = prepared();
  s = apply(s, {
    type: 'book_meeting',
    kind: 'contract',
    attendance: 'admin',
    startsAt: '2026-08-30T02:00:00Z',
    endsAt: '2026-08-30T03:00:00Z',
    location: '대표 단독',
  });
  fails(
    s,
    {
      type: 'record_contract',
      meetingId: s.meetings.at(-1)!.id,
      signedAt: '2026-08-30',
      signedConfirmed: true,
      expectedDepositWon: 100,
    },
    partner,
  );
  assert.throws(
    () =>
      apply(
        s,
        {
          type: 'record_contract',
          meetingId: s.meetings.at(-1)!.id,
          signedAt: '2026-08-30',
          signedConfirmed: true,
          expectedDepositWon: 100,
        },
        admin,
        file('report'),
      ),
    FlowError,
  );
});
test('no deposit or aftercare bypass; invalid/negative/future payments rejected; contract locks evidence', () => {
  fails(prepared(), {
    type: 'confirm_payment',
    amountWon: 1,
    receivedAt: '2026-08-30',
    paymentConfirmed: true,
    reference: '가상',
  });
  const s = signed();
  for (const amountWon of [0, -1, 1.5, Infinity])
    fails(s, {
      type: 'confirm_payment',
      amountWon,
      receivedAt: '2026-08-30',
      paymentConfirmed: true,
      reference: '가상',
    });
  fails(s, {
    type: 'confirm_payment',
    amountWon: 1,
    receivedAt: '2026-09-01',
    paymentConfirmed: true,
    reference: '가상',
  });
  fails(s, {
    type: 'start_aftercare',
    summary: '완료',
    owner: '대표',
    nextDate: '2026-09-01',
    deliveryConfirmed: true,
  });
  fails(s, { type: 'save_report', stage: 6, body });
  fails(s, {
    type: 'confirm_payment',
    amountWon: 1,
    receivedAt: '2026-99-99',
    paymentConfirmed: true,
    reference: '가상',
  });
});
test('same command id is idempotent, including payment; prior state is never mutated', () => {
  const s = signed();
  const json = JSON.stringify(s);
  const cmd = {
    type: 'confirm_payment',
    amountWon: 500000,
    receivedAt: '2026-08-30',
    paymentConfirmed: true,
    reference: '가상',
  };
  const ctx = { commandId: 'idempotent-payment-01', now };
  const next = applyFlowCommand(s, cmd, admin, ctx);
  const retry = applyFlowCommand(next, cmd, admin, ctx);
  assert.equal(retry, next);
  assert.equal(retry.payments.length, 1);
  assert.equal(JSON.stringify(s), json);
});
test('AI disabled by default; policy requires privacy, external processing and cost confirmation', () => {
  assert.equal(start().ai.enabled, false);
  fails(start(), { type: 'set_ai_policy', enabled: true, costConsent: true });
  let s = apply(start(), {
    type: 'set_ai_policy',
    enabled: true,
    costConsent: true,
    privacyMasked: true,
    thirdPartyConsent: true,
  });
  s = apply(s, { type: 'save_source', sourceText: body, privacyMasked: true });
  s = apply(s, { type: 'queue_report1' });
  assert.equal(s.jobs[0].status, 'queued');
  const claimed = claimFlowJob(s, s.jobs[0].id, now);
  assert.throws(() => claimFlowJob(claimed, s.jobs[0].id, now), FlowError);
  assert.throws(
    () => finishFlowJob(claimed, s.jobs[0].id, now, now, { body }),
    /추적 증거/,
  );
  const done = finishFlowJob(claimed, s.jobs[0].id, now, now, {
    body,
    evidence: aiSuccessObservation,
  });
  const storedSuccessEvidence = {
    ...aiSuccessObservation,
    auditId: `${s.jobs[0].id}-${now}`,
  };
  assert.equal(done.jobs[0].status, 'complete');
  assert.deepEqual(done.jobs[0].evidence, storedSuccessEvidence);
  assert.equal(
    done.audit.filter(
      (entry) =>
        entry.id === storedSuccessEvidence.auditId &&
        entry.action === 'ai_result' &&
        entry.at === done.jobs[0].completedAt,
    ).length,
    1,
  );
  assert.equal(done.reports.length, 1);
  assert.equal(phaseOf(done), '공동분석');
});
test('FLOW AI evidence accepts only complete exact bounded provider records', () => {
  assert.equal(hasFlowAiEvidenceStructure(aiEvidence), true);
  for (const evidence of [
    { ...aiEvidence, futureField: 'blocked' },
    { ...aiEvidence, providerRequestId: ' req_padded' },
    { ...aiEvidence, providerMessageId: '' },
    { ...aiEvidence, inputTokens: 0 },
    { ...aiEvidence, outputTokens: Number.MAX_SAFE_INTEGER + 1 },
    { ...aiEvidence, observedAt: 'not-a-date' },
    { ...aiEvidence, auditId: '' },
  ])
    assert.equal(hasFlowAiEvidenceStructure(evidence), false);
  assert.equal(hasFlowAiFailureEvidenceStructure(aiFailureEvidence), true);
  for (const evidence of [
    { ...aiFailureEvidence, futureField: 'blocked' },
    { ...aiFailureEvidence, httpStatus: 399 },
    { ...aiFailureEvidence, httpStatus: 600 },
    { ...aiFailureEvidence, observedAt: 'not-a-date' },
    { ...aiFailureEvidence, providerRequestId: ' req_padded' },
  ])
    assert.equal(hasFlowAiFailureEvidenceStructure(evidence), false);
  assert.equal(
    hasFlowAiFailureEvidenceHistoryStructure([aiFailureEvidence]),
    true,
  );
  assert.equal(hasFlowAiFailureEvidenceHistoryStructure([]), false);
  assert.equal(
    hasFlowAiFailureEvidenceHistoryStructure([
      { ...aiFailureEvidence, observedAt: '2026-08-30T12:00:00.000Z' },
      aiFailureEvidence,
    ]),
    false,
  );
  assert.equal(
    hasFlowAiFailureEvidenceHistoryStructure(
      Array.from(
        { length: FLOW_COLLECTION_LIMITS.aiFailureEvidenceHistory + 1 },
        () => aiFailureEvidence,
      ),
    ),
    false,
  );
});
test('AI result capacity and report size are rejected before an invalid state is returned', () => {
  let flow = apply(start(), {
    type: 'set_ai_policy',
    enabled: true,
    costConsent: true,
    privacyMasked: true,
    thirdPartyConsent: true,
  });
  flow = apply(flow, {
    type: 'save_source',
    sourceText: body,
    privacyMasked: true,
  });
  flow = apply(flow, { type: 'queue_report1' });
  const job = flow.jobs[0];
  const atCapacity = structuredClone(flow);
  while (atCapacity.audit.length < FLOW_COLLECTION_LIMITS.audit) {
    const index = atCapacity.audit.length;
    atCapacity.audit.push({
      id: `capacity-audit-${index}`,
      at: now,
      actor: '가상 대표',
      action: 'capacity_test',
      detail: '가상 용량 검사',
    });
  }
  assert.throws(
    () => claimFlowJob(atCapacity, job.id, now),
    (error) => error instanceof FlowError && error.status === 409,
  );

  const claimed = claimFlowJob(flow, job.id, now);
  assert.throws(
    () =>
      finishFlowJob(claimed, job.id, now, now, {
        body: '가'.repeat(80001),
      }),
    (error) => error instanceof FlowError && error.status === 413,
  );
  for (const outcome of [
    { body: `${body}\ud800` },
    { error: `가상 공급자 오류\udc00` },
  ])
    assert.throws(
      () => finishFlowJob(claimed, job.id, now, now, outcome),
      (error) => error instanceof FlowError && error.status === 413,
    );
});
test('FLOW text limits count Unicode code points like SQLite', () => {
  assert.equal(flowTextLength('가😀'), 2);
  assert.equal(isWellFormedFlowText('가😀'), true);
  assert.equal(isWellFormedFlowText('\ud800'), false);
  const acceptedBody = '😀'.repeat(FLOW_TEXT_LIMITS.reportBody);
  const accepted = apply(start(), {
    type: 'save_report',
    stage: 1,
    body: acceptedBody,
  });
  assert.equal(accepted.reports[0].body, acceptedBody);
  assert.throws(
    () =>
      apply(start(), {
        type: 'save_report',
        stage: 1,
        body: `${acceptedBody}😀`,
      }),
    FlowError,
  );
  assert.throws(
    () =>
      apply(start(), {
        type: 'save_report',
        stage: 1,
        body: `${body}\ud800`,
      }),
    FlowError,
  );
});
test('AI failures remain failed; stale/disabled job results cannot drive the workflow', () => {
  let s = apply(consulted(), {
    type: 'set_ai_policy',
    enabled: true,
    costConsent: true,
    privacyMasked: true,
    thirdPartyConsent: true,
  });
  s = apply(s, {
    type: 'save_recording',
    meetingId: firstMeeting(s)!.id,
    transcript: body,
    recordingConsent: true,
    privacyMasked: true,
  });
  const j = s.jobs[0];
  const claimed = claimFlowJob(s, j.id, now);
  const failed = finishFlowJob(claimed, j.id, now, now, {
    error: '가상 API 실패',
    failureEvidence: aiFailureObservation,
  });
  const storedFailureEvidence = {
    ...aiFailureObservation,
    auditId: `${j.id}-${now}`,
  };
  assert.equal(failed.jobs[0].status, 'failed');
  assert.deepEqual(failed.jobs[0].failureEvidence, storedFailureEvidence);
  assert.equal(
    failed.audit.filter(
      (entry) =>
        entry.id === storedFailureEvidence.auditId &&
        entry.action === 'ai_result' &&
        Date.parse(entry.at) >= Date.parse(storedFailureEvidence.observedAt),
    ).length,
    1,
  );
  assert.equal(deepReport(failed), undefined);
  const atHistoryCapacity = structuredClone(failed);
  atHistoryCapacity.jobs[0].failureEvidenceHistory = Array.from(
    { length: FLOW_COLLECTION_LIMITS.aiFailureEvidenceHistory },
    (_, index) => ({
      ...storedFailureEvidence,
      auditId: `${j.id}-${now}-capacity-${index}`,
    }),
  );
  assert.throws(
    () =>
      apply(atHistoryCapacity, {
        type: 'retry_job',
        jobId: j.id,
        costConsent: true,
      }),
    /이력이 가득/,
  );
  const retried = apply(failed, {
    type: 'retry_job',
    jobId: j.id,
    costConsent: true,
  });
  assert.equal(retried.jobs[0].status, 'queued');
  assert.equal(retried.jobs[0].failureEvidence, undefined);
  assert.deepEqual(retried.jobs[0].failureEvidenceHistory, [
    storedFailureEvidence,
  ]);
  const disabled = apply(claimed, { type: 'set_ai_policy', enabled: false });
  const discarded = finishFlowJob(disabled, j.id, now, now, { body });
  assert.equal(discarded.jobs[0].status, 'blocked');
  assert.equal(deepReport(discarded), undefined);
});
const permissions = {
  sharedSchedule: true,
  ownCases: true,
  fileUpload: true,
  quoteContract: true,
  collaborationApply: true,
};
const user: PortalUser = {
  id: 'session-one',
  email: 'sample@example.invalid',
  displayName: '테스트',
  role: 'trainee',
  memberId: 'partner-one',
  memberName: '테스트 파트너',
  permissions,
};
const raw = {
  version: 1,
  consultationNumber: 0,
  timeline: [],
  tasks: [],
  companyDocuments: [],
  schedule: [],
  cases: [{ id: 'test-case', company: '가상기업', trainee: '테스트 파트너' }],
  members: [
    {
      id: 'partner-one',
      name: '테스트 파트너',
      status: '활성',
      email: 'sample@example.invalid',
      permissions,
    },
  ],
};
test('stable member ID prevents another partner or same-name claimant reading reports', () => {
  assert.equal(
    resolveFlowAssignment(raw, 'test-case', user, null).partnerId,
    'partner-one',
  );
  assert.throws(
    () =>
      resolveFlowAssignment(
        raw,
        'test-case',
        { ...user, memberId: 'partner-other' },
        reported(),
      ),
    FlowError,
  );
  const duplicate = {
    ...raw,
    members: [...raw.members, { ...raw.members[0], id: 'partner-two' }],
  };
  assert.throws(
    () => resolveFlowAssignment(duplicate, 'test-case', user, null),
    FlowError,
  );
  assert.equal(
    resolveFlowAssignment(duplicate, 'test-case', user, reported()).partnerId,
    'partner-one',
  );
  const report = reported();
  const safe = publicFlow({
    ...report,
    files: [{ ...file(), futureFileSecret: '숨김 파일 값' }],
    reports: report.reports.map((item) => ({
      ...item,
      futureReportSecret: '숨김 보고서 값',
    })),
    jobs: [
      {
        id: 'safe-projection-job',
        stage: 1,
        status: 'complete',
        reason: '',
        createdAt: now,
        startedAt: now,
        completedAt: now,
        reportId: report.reports[0].id,
        evidence: { ...aiEvidence, futureEvidenceSecret: '숨김 증거 값' },
      },
      {
        id: 'safe-failure-projection-job',
        stage: 1,
        status: 'failed',
        reason: '가상 실패',
        createdAt: now,
        startedAt: now,
        failureEvidence: {
          ...aiFailureEvidence,
          futureFailureSecret: '숨김 실패 값',
        },
        failureEvidenceHistory: [
          {
            ...aiFailureEvidence,
            providerRequestId: 'req_historical_failure',
            futureHistoricalFailureSecret: '숨김 이전 실패 값',
          },
        ],
      },
    ],
    ai: { ...report.ai, futureAiSecret: '숨김 AI 값' },
    futureRootSecret: '숨김 루트 값',
  } as unknown as ConsultingFlow);
  assert.equal(safe.files[0].key, '');
  assert.deepEqual(safe.commandIds, []);
  assert.equal('futureRootSecret' in safe, false);
  assert.equal('futureFileSecret' in safe.files[0], false);
  assert.equal('futureReportSecret' in safe.reports[0], false);
  assert.equal('futureAiSecret' in safe.ai, false);
  assert.equal('futureEvidenceSecret' in safe.jobs[0].evidence!, false);
  assert.equal('futureFailureSecret' in safe.jobs[1].failureEvidence!, false);
  assert.equal(
    'futureHistoricalFailureSecret' in safe.jobs[1].failureEvidenceHistory![0],
    false,
  );
});
test('pipeline stages derive from verified events; partner-only meeting omitted from representative shared schedule', () => {
  const s = pay(signed());
  const projected = projectFlowState(raw, [s]) as typeof raw & {
    cases: Array<{ stage: string; flowManaged: boolean }>;
  };
  assert.equal(projected.cases[0].stage, '컨설팅수행');
  assert.equal(projected.cases[0].flowManaged, true);
  let t = consulted();
  t = apply(t, {
    type: 'book_meeting',
    kind: 'followup',
    attendance: 'partner',
    startsAt: '2026-09-01T00:00:00Z',
    endsAt: '2026-09-01T01:00:00Z',
    location: '가상 파트너 방문',
  });
  assert.equal((projectFlowState(raw, [t]) as typeof raw).schedule.length, 0);
  const staleProjection = projectFlowState(
    {
      ...raw,
      cases: [{ ...raw.cases[0], flowManaged: true, flowPhase: '위조 단계' }],
    },
    [],
  ) as typeof raw & { cases: Array<Record<string, unknown>> };
  assert.equal(staleProjection.cases[0].flowManaged, undefined);
  assert.equal(staleProjection.cases[0].flowPhase, undefined);
});
test('shared schedule masks other companies; projection is repeatable without duplicate meetings', () => {
  const s = booked();
  const state = projectFlowState(raw, [s]);
  const doubled = projectFlowState(state, [s]) as typeof raw;
  assert.equal(doubled.schedule.length, 1);
  const other = stateForPortalUser(state, {
    ...user,
    memberId: 'other',
    memberName: '타 파트너',
  }) as {
    cases: unknown[];
    schedule: Array<{ company: string; method: string }>;
  };
  assert.equal(other.cases.length, 0);
  assert.equal(other.schedule[0].company, '협업 상담 예약됨');
  assert.equal(other.schedule[0].method, '시간만 공유');
});
test('upload extensions, purposes and consent validated; HTML output escapes injected content', () => {
  const pdf = new File(['%PDF-1.7'], 'signed.pdf');
  assert.throws(
    () => describeUpload(pdf, { type: 'record_contract' }, now),
    FlowError,
  );
  assert.equal(
    describeUpload(pdf, { type: 'record_contract', fileConsent: true }, now)
      .purpose,
    'signed_contract',
  );
  assert.equal(
    describeUpload(
      new File(['%PDF-1.7'], ` e\u0301/\u0000report.pdf`),
      { type: 'record_contract', fileConsent: true },
      now,
    ).name,
    'é__report.pdf',
  );
  assert.throws(
    () =>
      describeUpload(
        new File(['x'], 'malicious.html'),
        { type: 'save_report', fileConsent: true },
        now,
      ),
    FlowError,
  );
  assert.equal(
    escapeHtml('<script>alert("x")</script>'),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
  );
});
test('bounded JSON/multipart parsing retains a private attachment and rejects bad shape', async () => {
  const payload = {
    commandId: 'test-upload-01',
    revision: 0,
    command: { type: 'save_source', fileConsent: true },
  };
  const form = new FormData();
  form.set('payload', JSON.stringify(payload));
  form.set('file', new File(['%PDF-1.7'], 'source.pdf'));
  const parsed = await parseFlowRequest(
    new Request('http://localhost/api/flow', { method: 'POST', body: form }),
  );
  assert.equal(parsed.file?.name, 'source.pdf');
  assert.equal(parsed.commandId, payload.commandId);
  await assert.rejects(
    parseFlowRequest(
      new Request('http://localhost/api/flow', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    ),
    FlowError,
  );
  await assert.rejects(
    parseFlowRequest(
      new Request('http://localhost/api/flow', {
        method: 'POST',
        headers: { 'content-type': 'text/plain; profile=application/json' },
        body: JSON.stringify(payload),
      }),
    ),
    (error) => error instanceof FlowError && error.status === 415,
  );
  const invalidLength = new Request('http://localhost/api/flow', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  invalidLength.headers.set('content-length', 'invalid');
  await assert.rejects(
    parseFlowRequest(invalidLength),
    (error) => error instanceof FlowError && error.status === 400,
  );
  await assert.rejects(
    parseFlowRequest(
      new Request('http://localhost/api/flow', {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data' },
        body: '--missing-boundary--',
      }),
    ),
    (error) => error instanceof FlowError && error.status === 400,
  );
  const badPayload = new FormData();
  badPayload.set('payload', '{');
  await assert.rejects(
    parseFlowRequest(
      new Request('http://localhost/api/flow', {
        method: 'POST',
        body: badPayload,
      }),
    ),
    (error) => error instanceof FlowError && error.status === 400,
  );
});

test('source exclusion preserves the original and DOCX first report needs readable context', () => {
  let flow = apply(
    start(),
    { type: 'save_source', sourceText: body, privacyMasked: true },
    admin,
    file('source'),
  );
  const key = flow.files[0].key;
  flow = apply(flow, { type: 'exclude_source', fileId: flow.files[0].id });
  assert.equal(flow.files[0].purpose, 'source_archived');
  assert.equal(flow.files[0].key, key);
  assert.throws(
    () =>
      apply(
        start(),
        { type: 'save_report', stage: 1 },
        admin,
        file('report', 'report.docx'),
      ),
    FlowError,
  );
});

test('new transcript during an in-flight AI call cannot publish an obsolete fourth report', () => {
  let flow = apply(consulted(), {
    type: 'set_ai_policy',
    enabled: true,
    thirdPartyConsent: true,
    privacyMasked: true,
    costConsent: true,
  });
  const command = {
    type: 'save_recording',
    meetingId: firstMeeting(flow)!.id,
    transcript: body,
    recordingConsent: true,
    privacyMasked: true,
  };
  flow = apply(flow, command);
  const job = flow.jobs.at(-1)!;
  flow = claimFlowJob(flow, job.id, now);
  flow = apply(flow, {
    ...command,
    transcript: body + ' 추가 정정사항을 확인해야 합니다.',
  });
  flow = finishFlowJob(flow, job.id, now, now, { body });
  assert.equal(flow.jobs[0].status, 'blocked');
  assert.equal(deepReport(flow), undefined);
});

test('transcript review is server enforced; audio wait, supplement and duplicate guards', () => {
  let s = consulted();
  const c = {
    type: 'save_recording',
    meetingId: firstMeeting(s)!.id,
    transcript: body,
    recordingConsent: true,
    privacyMasked: true,
  };
  assert.throws(
    () =>
      applyFlowCommand(s, c, partner, { commandId: 'review-required', now }),
    /확인/,
  );
  assert.throws(() => apply(s, { ...c, transcriptReviewed: false }), /확인/);
  assert.throws(
    () =>
      apply(
        s,
        { ...c, transcript: '' },
        partner,
        file('recording', 'text.docx'),
      ),
    /본문/,
  );
  assert.throws(
    () => apply(s, { ...c, transcript: '가'.repeat(60001) }),
    /확인/,
  );
  s = apply(s, c);
  assert.ok(s.recordings[0].transcriptReviewedAt);
  assert.throws(() => apply(s, c), /동일한 전사문/);
  const waitingBase = consulted();
  const waiting = apply(
    waitingBase,
    { ...c, meetingId: firstMeeting(waitingBase)!.id, transcript: '' },
    partner,
    file('recording', 'call.m4a'),
  );
  assert.equal(phaseOf(waiting), '녹취자료 등록');
  assert.equal(waiting.jobs[0].status, 'blocked');
  const complemented = apply(
    waiting,
    {
      type: 'save_transcript',
      recordingId: waiting.recordings[0].id,
      transcript: body,
      recordingConsent: true,
      privacyMasked: true,
    },
    partner,
    file('transcript', 'text.docx'),
  );
  assert.equal(
    complemented.recordings[0].audioFileId,
    waiting.recordings[0].fileId,
  );
  assert.ok(complemented.recordings[0].transcriptFileId);
  assert.equal(complemented.files.length, waiting.files.length + 1);
  assert.throws(
    () =>
      apply(complemented, {
        type: 'save_transcript',
        recordingId: complemented.recordings[0].id,
        transcript: body,
        recordingConsent: true,
        privacyMasked: true,
      }),
    /이미 저장/,
  );
});

test('transcript correction preserves current AI failure evidence in history', () => {
  let flow = apply(consulted(), {
    type: 'set_ai_policy',
    enabled: true,
    thirdPartyConsent: true,
    privacyMasked: true,
    costConsent: true,
  });
  flow = apply(flow, {
    type: 'save_recording',
    meetingId: firstMeeting(flow)!.id,
    transcript: body,
    recordingConsent: true,
    privacyMasked: true,
  });
  const job = flow.jobs.at(-1)!;
  flow = claimFlowJob(flow, job.id, now);
  flow = finishFlowJob(flow, job.id, now, now, {
    error: '가상 공급자 오류',
    failureEvidence: aiFailureObservation,
  });
  const failureEvidence = flow.jobs.at(-1)!.failureEvidence!;
  const disabled = apply(flow, { type: 'set_ai_policy', enabled: false });
  const correctedWhileDisabled = apply(disabled, {
    type: 'save_transcript',
    recordingId: disabled.recordings.at(-1)!.id,
    transcript: `${body} 비활성 상태 정정사항`,
    recordingConsent: true,
    privacyMasked: true,
  });
  assert.equal(correctedWhileDisabled.jobs.at(-1)!.status, 'failed');
  assert.deepEqual(
    correctedWhileDisabled.jobs.at(-1)!.failureEvidence,
    failureEvidence,
  );
  flow = apply(flow, {
    type: 'save_transcript',
    recordingId: flow.recordings.at(-1)!.id,
    transcript: `${body} 확인된 정정사항`,
    recordingConsent: true,
    privacyMasked: true,
  });
  assert.equal(flow.jobs.at(-1)!.status, 'queued');
  assert.equal(flow.jobs.at(-1)!.failureEvidence, undefined);
  assert.deepEqual(flow.jobs.at(-1)!.failureEvidenceHistory, [failureEvidence]);
});
