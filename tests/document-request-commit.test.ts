import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitDocumentRequest,
  documentRequestCaseFingerprint,
} from '../lib/document-request-commit';

const requestId = '12345678-1234-4234-8234-123456789abc';
const member = { id: 'partner-1', name: '가상 담당자', status: '활성' };
const selected = {
  id: 'case-operational-1',
  company: '동일 기업',
  trainee: member.name,
  partnerMemberId: member.id,
  flowManaged: false,
  pipelineLifecycleStatus: 'active' as const,
  nextAction: '기존 행동',
  updatedAt: '어제',
  idleDays: 9,
  marker: 'selected',
};
const otherCase = {
  ...selected,
  id: 'case-operational-2',
  nextAction: '다른 진행 행동',
  marker: 'other',
};
const cases = [selected, otherCase];
const timeline = [
  { caseId: selected.id, date: '어제', title: '서류요청 #1 등록', detail: '기존', type: '서류', tone: 'amber' },
  { caseId: otherCase.id, date: '어제', title: '서류요청 #1 등록', detail: '다른 진행', type: '서류', tone: 'amber' },
];
const documents = [
  {
    id: 'other-request',
    caseId: otherCase.id,
    company: otherCase.company,
    title: '다른 진행 자료',
    category: '요청서류',
    status: '요청중',
    assignedTrainee: member.name,
    partnerMemberId: member.id,
    marker: 'other',
  },
];
const tasks = [
  {
    id: 'other-task',
    caseId: otherCase.id,
    company: otherCase.company,
    title: '다른 진행 업무',
    kind: '서류요청',
    assignee: member.name,
    partnerMemberId: member.id,
    marker: 'other',
  },
];
const today = new Date('2026-09-02T15:00:00.000Z');

function input() {
  return {
    requestId,
    expectedCase: documentRequestCaseFingerprint(selected),
    items: [{ name: '재무제표' }, { name: '사업자등록증' }],
    dueDate: '2026-09-03',
    dueState: 'today' as const,
  };
}

void test('document request commits one immutable case-scoped record set with stable IDs', () => {
  const originalTimeline = structuredClone(timeline);
  const originalDocuments = structuredClone(documents);
  const originalTasks = structuredClone(tasks);
  const originalCases = structuredClone(cases);
  const saved = commitDocumentRequest(
    selected,
    input(),
    timeline,
    documents,
    tasks,
    cases,
    [member],
    true,
    today,
  );

  assert.equal(saved.requestNumber, 2);
  assert.equal(saved.documentCount, 2);
  assert.deepEqual(saved.documents.slice(0, 2).map((item) => item.id), [
    `file-request-${requestId}-0`,
    `file-request-${requestId}-1`,
  ]);
  assert.ok(saved.documents.slice(0, 2).every((item) => item.caseId === selected.id));
  const preservedDocument = saved.documents.find((item) => item.id === 'other-request');
  assert.ok(preservedDocument && 'marker' in preservedDocument);
  assert.equal(preservedDocument.marker, 'other');
  const createdTask = saved.tasks.find((item) => item.id === `task-request-${requestId}`);
  assert.ok(createdTask && 'dueState' in createdTask);
  assert.equal(createdTask.caseId, selected.id);
  assert.equal(createdTask.dueState, 'today');
  assert.equal(createdTask.priority, '긴급');
  const preservedTask = saved.tasks.find((item) => item.id === 'other-task');
  assert.ok(preservedTask && 'marker' in preservedTask);
  assert.equal(preservedTask.marker, 'other');
  const createdTimeline = saved.timeline.at(-1);
  assert.ok(createdTimeline && 'id' in createdTimeline);
  assert.equal(createdTimeline.id, `document-request-${requestId}`);
  assert.equal(createdTimeline.title, '서류요청 #2 등록');
  assert.equal(saved.cases.find((item) => item.id === selected.id)?.nextAction, '요청서류 2건 제출 확인');
  assert.equal(saved.cases.find((item) => item.id === selected.id)?.idleDays, 0);
  assert.equal(saved.cases.find((item) => item.id === otherCase.id)?.marker, 'other');
  const repeatedFromSameBaseline = commitDocumentRequest(
    selected,
    input(),
    timeline,
    documents,
    tasks,
    cases,
    [member],
    true,
    today,
  );
  assert.deepEqual(repeatedFromSameBaseline, saved);
  assert.deepEqual(timeline, originalTimeline);
  assert.deepEqual(documents, originalDocuments);
  assert.deepEqual(tasks, originalTasks);
  assert.deepEqual(cases, originalCases);
});

void test('document request stable ID blocks duplicate application and existing collisions', () => {
  const saved = commitDocumentRequest(selected, input(), timeline, documents, tasks, cases, [member], true, today);
  assert.throws(
    () => commitDocumentRequest(selected, input(), saved.timeline, saved.documents, saved.tasks, saved.cases, [member], true, today),
    /이미 같은 서류요청/,
  );
  assert.throws(
    () => commitDocumentRequest(selected, { ...input(), requestId: 'invalid' }, timeline, documents, tasks, cases, [member], true, today),
    /저장 식별자/,
  );
  assert.throws(
    () => commitDocumentRequest(selected, input(), timeline, [{ ...documents[0], id: `file-request-${requestId}-0` }], tasks, cases, [member], true, today),
    /이미 같은 서류요청/,
  );
  assert.throws(
    () => commitDocumentRequest(selected, input(), timeline, documents, [{ ...tasks[0], id: `task-request-${requestId}` }], cases, [member], true, today),
    /이미 같은 서류요청/,
  );
});

void test('document request apply rechecks permission, case, content and Korean due-state', () => {
  assert.throws(
    () => commitDocumentRequest(selected, input(), timeline, documents, tasks, cases, [member], false, today),
    /권한을 다시 확인/,
  );
  const flowManaged = { ...selected, flowManaged: true };
  assert.throws(
    () => commitDocumentRequest(flowManaged, { ...input(), expectedCase: documentRequestCaseFingerprint(flowManaged) }, timeline, documents, tasks, [flowManaged, otherCase], [member], true, today),
    /상담 FLOW에서/,
  );
  const discontinued = { ...selected, pipelineLifecycleStatus: 'discontinued' as const };
  assert.throws(
    () => commitDocumentRequest(discontinued, { ...input(), expectedCase: documentRequestCaseFingerprint(discontinued) }, timeline, documents, tasks, [discontinued, otherCase], [member], true, today),
    /다시 연 뒤/,
  );
  assert.throws(
    () => commitDocumentRequest({ ...selected, trainee: '변경 담당자' }, input(), timeline, documents, tasks, cases, [member], true, today),
    /작성 중 진행 정보가 변경/,
  );
  assert.throws(
    () => commitDocumentRequest(selected, input(), timeline, documents, tasks, cases.map((item) => item.id === selected.id ? { ...item, partnerMemberId: 'partner-2' } : item), [member], true, today),
    /현재 진행 연결/,
  );
  assert.throws(
    () => commitDocumentRequest(selected, { ...input(), dueState: 'upcoming' }, timeline, documents, tasks, cases, [member], true, today),
    /내용이나 제출기한 영향이 변경/,
  );
  assert.throws(
    () => commitDocumentRequest(selected, { ...input(), items: [{ name: ' 재무제표 ' }] }, timeline, documents, tasks, cases, [member], true, today),
    /내용이나 제출기한 영향이 변경/,
  );
});

void test('same-company repeat application and newly outstanding request stay isolated', () => {
  const otherOnly = {
    ...input(),
    items: [{ name: '다른 진행 자료' }],
  };
  const saved = commitDocumentRequest(selected, otherOnly, timeline, documents, tasks, cases, [member], true, today);
  assert.equal(saved.documents[0]?.caseId, selected.id);
  assert.equal(saved.documents[0]?.title, '다른 진행 자료');

  const newlyOutstanding = [{
    ...documents[0],
    id: 'selected-outstanding',
    caseId: selected.id,
    title: '재무제표',
  }, ...documents];
  assert.throws(
    () => commitDocumentRequest(selected, input(), timeline, newlyOutstanding, tasks, cases, [member], true, today),
    /이미 제출 요청 중/,
  );
});
