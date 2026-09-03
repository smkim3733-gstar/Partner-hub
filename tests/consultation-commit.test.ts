import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitConsultation,
  consultationCaseFingerprint,
} from '../lib/consultation-commit';
import type { PipelineStage } from '../lib/pipeline-dropoff-metrics';

const requestId = '12345678-1234-4234-8234-123456789abc';
type TestCase = {
  id: string;
  company: string;
  service: string;
  trainee: string;
  partnerMemberId: string;
  flowManaged: boolean;
  pipelineLifecycleStatus: 'active' | 'discontinued';
  pipelineHighestStage: PipelineStage;
  stage: PipelineStage;
  consultationCount: number;
  nextAction: string;
  updatedAt: string;
  idleDays: number;
  urgent: boolean;
  marker: string;
};
const selected: TestCase = {
  id: 'case-consultation-1',
  company: '동일 기업',
  service: '기업가치평가',
  trainee: '가상 담당자',
  partnerMemberId: 'partner-1',
  flowManaged: false,
  pipelineLifecycleStatus: 'active' as const,
  pipelineHighestStage: '기업진단' as const,
  stage: '기업진단' as const,
  consultationCount: 2,
  nextAction: '기존 행동',
  updatedAt: '어제',
  idleDays: 9,
  urgent: false,
  marker: 'selected',
};
const otherCase = {
  ...selected,
  id: 'case-consultation-2',
  nextAction: '다른 진행 행동',
  marker: 'other',
};
const cases = [selected, otherCase];
const timeline = [
  { id: 'existing-event', caseId: otherCase.id, date: '어제', title: '기존 기록', detail: '다른 진행', type: '상담', tone: 'green' },
];
const schedule = [{
  id: 'existing-schedule',
  caseId: otherCase.id,
  date: '09.03',
  weekday: '목',
  time: '09:00',
  end: '10:00',
  company: otherCase.company,
  service: '다른 일정',
  method: '전화',
  status: '확정',
  tone: 'green',
  source: 'partner' as const,
  shareMode: 'private' as const,
}];
const tasks = [{
  id: 'existing-task',
  caseId: otherCase.id,
  company: otherCase.company,
  title: '다른 진행 업무',
  kind: '상담',
  assignee: otherCase.trainee,
  due: '기한 확인',
  dueState: 'upcoming' as const,
  status: '대기' as const,
  priority: '보통' as const,
  related: '다른 진행',
  marker: 'other',
}];

function completedInput(caseItem: TestCase = selected) {
  return {
    requestId,
    expectedCase: consultationCaseFingerprint(caseItem),
    expectedNumber: 7,
    payload: {
      followUps: ['서류요청', '견적서 작성'],
      addToSchedule: false,
      title: '가상 상담',
      startsAt: '2026-09-03T10:00',
      method: '화상',
      status: '상담 완료',
      shareMode: 'private' as const,
    },
  };
}

void test('consultation commits one immutable case-scoped record set with stable IDs', () => {
  const originals = structuredClone({ timeline, schedule, tasks, cases });
  const saved = commitConsultation(selected, completedInput(), 7, timeline, schedule, tasks, cases, true);

  assert.equal(saved.consultationNumber, 8);
  assert.equal(saved.number, 7);
  assert.equal(saved.scheduleAdded, false);
  assert.equal(saved.taskCount, 2);
  assert.equal(saved.timeline.at(-1)?.id, `consultation-${requestId}`);
  assert.deepEqual(saved.tasks.slice(0, 2).map((item) => item.id), [
    `task-consultation-${requestId}-0`,
    `task-consultation-${requestId}-1`,
  ]);
  assert.ok(saved.tasks.slice(0, 2).every((item) => item.caseId === selected.id));
  assert.equal(saved.cases.find((item) => item.id === selected.id)?.stage, '상담진행');
  assert.equal(saved.cases.find((item) => item.id === selected.id)?.consultationCount, 3);
  assert.equal(saved.cases.find((item) => item.id === selected.id)?.nextAction, '서류요청 · 견적서 작성');
  assert.equal(saved.cases.find((item) => item.id === otherCase.id)?.marker, 'other');
  assert.deepEqual({ timeline, schedule, tasks, cases }, originals);

  const repeated = commitConsultation(selected, completedInput(), 7, timeline, schedule, tasks, cases, true);
  assert.deepEqual(repeated, saved);
});

void test('confirmed consultation creates one stable partner schedule', () => {
  const input = {
    ...completedInput(),
    payload: {
      ...completedInput().payload,
      followUps: [],
      addToSchedule: true,
      status: '일정 확정',
      shareMode: 'all_with_assignee' as const,
    },
  };
  const saved = commitConsultation(selected, input, 7, timeline, schedule, tasks, cases, true);
  const created = saved.schedule.find((item) => item.id === `schedule-consultation-${requestId}`);

  assert.equal(saved.scheduleAdded, true);
  assert.ok(created);
  assert.equal(created.caseId, selected.id);
  assert.ok('isoDate' in created);
  assert.equal(created.isoDate, '2026-09-03');
  assert.equal(created.time, '10:00');
  assert.equal(created.end, '11:00');
  assert.equal(created.shareMode, 'all_with_assignee');
  assert.equal(saved.cases.find((item) => item.id === selected.id)?.stage, '상담예약');
});

void test('consultation stable ID and expected number block duplicate or colliding application', () => {
  const saved = commitConsultation(selected, completedInput(), 7, timeline, schedule, tasks, cases, true);
  assert.throws(
    () => commitConsultation(selected, completedInput(), 7, saved.timeline, schedule, tasks, cases, true),
    /이미 같은 상담/,
  );
  assert.throws(
    () => commitConsultation(selected, { ...completedInput(), requestId: 'invalid' }, 7, timeline, schedule, tasks, cases, true),
    /저장 식별자/,
  );
  assert.throws(
    () => commitConsultation(selected, completedInput(), 8, timeline, schedule, tasks, cases, true),
    /상담번호가 변경/,
  );
  assert.throws(
    () => commitConsultation(selected, completedInput(), 7, timeline, [{ ...schedule[0], id: `schedule-consultation-${requestId}` }], tasks, cases, true),
    /이미 같은 상담/,
  );
  assert.throws(
    () => commitConsultation(selected, completedInput(), 7, timeline, schedule, [{ ...tasks[0], id: `task-consultation-${requestId}-9` }], cases, true),
    /이미 같은 상담/,
  );
  assert.throws(
    () => commitConsultation(selected, completedInput(), Number.NaN, timeline, schedule, tasks, cases, true),
    /현재 상담번호/,
  );
});

void test('consultation apply rechecks permission, case lifecycle and normalized content', () => {
  assert.throws(
    () => commitConsultation(selected, completedInput(), 7, timeline, schedule, tasks, cases, false),
    /권한을 다시 확인/,
  );
  const flowManaged = { ...selected, flowManaged: true };
  assert.throws(
    () => commitConsultation(flowManaged, completedInput(flowManaged), 7, timeline, schedule, tasks, [flowManaged, otherCase], true),
    /상담 FLOW에서/,
  );
  const discontinued = { ...selected, pipelineLifecycleStatus: 'discontinued' as const };
  assert.throws(
    () => commitConsultation(discontinued, completedInput(discontinued), 7, timeline, schedule, tasks, [discontinued, otherCase], true),
    /다시 연 뒤/,
  );
  assert.throws(
    () => commitConsultation({ ...selected, trainee: '변경 담당자' }, completedInput(), 7, timeline, schedule, tasks, cases, true),
    /작성 중 진행 정보가 변경/,
  );
  assert.throws(
    () => commitConsultation(selected, completedInput(), 7, timeline, schedule, tasks, cases.map((item) => item.id === selected.id ? { ...item, consultationCount: 3 } : item), true),
    /현재 상담 진행 연결/,
  );
  assert.throws(
    () => commitConsultation(selected, { ...completedInput(), payload: { ...completedInput().payload, title: ' 가상 상담 ' } }, 7, timeline, schedule, tasks, cases, true),
    /상담 내용이나 저장 영향이 변경/,
  );
});

void test('later pipeline stages never regress and cancelled consultation leaves case unchanged', () => {
  const contracted = {
    ...selected,
    stage: '계약' as const,
    pipelineHighestStage: '계약' as const,
    nextAction: '계약 후속',
  };
  const contractedCases = [contracted, otherCase];
  const completed = commitConsultation(
    contracted,
    completedInput(contracted),
    7,
    timeline,
    schedule,
    tasks,
    contractedCases,
    true,
  );
  assert.equal(completed.cases[0].stage, '계약');
  assert.equal(completed.cases[0].nextAction, '서류요청 · 견적서 작성');

  const waitingInput = {
    ...completedInput(contracted),
    payload: {
      ...completedInput(contracted).payload,
      followUps: [],
      status: '고객 회신 대기',
    },
  };
  const waiting = commitConsultation(contracted, waitingInput, 7, timeline, schedule, tasks, contractedCases, true);
  assert.equal(waiting.cases[0].stage, '계약');
  assert.equal(waiting.cases[0].nextAction, '계약 후속');

  const cancelledInput = {
    ...completedInput(contracted),
    payload: {
      ...completedInput(contracted).payload,
      followUps: [],
      status: '취소',
    },
  };
  const cancelled = commitConsultation(contracted, cancelledInput, 7, timeline, schedule, tasks, contractedCases, true);
  assert.deepEqual(cancelled.cases[0], contracted);
  assert.equal(cancelled.timeline.at(-1)?.id, `consultation-${requestId}`);
});
