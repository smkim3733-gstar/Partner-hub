import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDocumentRequestDueDateDraft,
  createDocumentRequestDueDateDraft,
} from '../lib/document-request-due-date-change';

const member = { id: 'partner-1', name: '가상 담당자', status: '활성' };
const selected = {
  id: 'case-operational-1',
  company: '가상 안전기업',
  trainee: member.name,
  partnerMemberId: member.id,
};
const cases = [
  selected,
  { ...selected, id: 'case-operational-2' },
];
const documents = [
  {
    id: 'request-1',
    caseId: selected.id,
    company: selected.company,
    title: '재무제표',
    category: '요청서류',
    status: '요청중',
    assignedTrainee: member.name,
    partnerMemberId: member.id,
    updatedAt: '이전',
    dueDate: undefined as string | undefined,
    version: '-',
  },
  {
    id: 'request-2',
    caseId: selected.id,
    company: selected.company,
    title: '사업자등록증',
    category: '요청서류',
    status: '보완필요',
    assignedTrainee: member.name,
    partnerMemberId: member.id,
    updatedAt: '이전',
    dueDate: undefined as string | undefined,
    version: '-',
  },
  {
    id: 'other-request',
    caseId: cases[1].id,
    company: selected.company,
    title: '다른 진행 자료',
    category: '요청서류',
    status: '요청중',
    assignedTrainee: member.name,
    partnerMemberId: member.id,
    updatedAt: '이전',
    dueDate: undefined as string | undefined,
    version: '-',
  },
];
const tasks = [
  {
    id: 'task-request-1',
    caseId: selected.id,
    company: selected.company,
    title: '요청서류 제출 확인',
    kind: '서류요청',
    assignee: member.name,
    partnerMemberId: member.id,
    due: '기한 확인',
    dueState: 'upcoming',
    status: '대기',
    priority: '보통',
    related: '서류요청 #1',
  },
  {
    id: 'other-task',
    caseId: cases[1].id,
    company: selected.company,
    title: '다른 진행 업무',
    kind: '서류요청',
    assignee: member.name,
    partnerMemberId: member.id,
    due: '기한 확인',
    dueState: 'upcoming',
    status: '대기',
    priority: '보통',
    related: '서류요청 #2',
  },
];
const koreanToday = new Date('2026-09-02T15:00:00.000Z');

void test('missing request due date remains isolated until explicit apply', () => {
  const originalDocuments = structuredClone(documents);
  const originalTasks = structuredClone(tasks);
  const draft = createDocumentRequestDueDateDraft(
    selected,
    ['request-2', 'request-1'],
    '2026-09-03',
    documents,
    tasks,
    cases,
    [member],
    true,
    koreanToday,
  );
  assert.deepEqual(documents, originalDocuments);
  assert.deepEqual(tasks, originalTasks);
  assert.deepEqual(draft.documentIds, ['request-1', 'request-2']);
  assert.deepEqual(draft.documentTitles, ['재무제표', '사업자등록증']);
  assert.equal(draft.dueState, 'today');
  assert.equal(draft.taskCount, 1);

  const applied = applyDocumentRequestDueDateDraft(
    selected,
    draft,
    documents,
    tasks,
    cases,
    [member],
    true,
    koreanToday,
  );
  assert.equal(applied.documents.find((item) => item.id === 'request-1')?.dueDate, '2026-09-03');
  assert.equal(applied.documents.find((item) => item.id === 'request-2')?.updatedAt, '방금 전');
  assert.equal(applied.documents.find((item) => item.id === 'other-request')?.dueDate, undefined);
  assert.equal(applied.tasks.find((item) => item.id === 'task-request-1')?.due, '2026. 9. 3.');
  assert.equal(applied.tasks.find((item) => item.id === 'task-request-1')?.dueState, 'today');
  assert.equal(applied.tasks.find((item) => item.id === 'task-request-1')?.priority, '긴급');
  assert.equal(applied.tasks.find((item) => item.id === 'other-task')?.due, '기한 확인');
  assert.equal(applied.timeline.caseId, selected.id);
  assert.match(applied.timeline.detail, /요청서류 2건/);
  assert.deepEqual(documents, originalDocuments);
  assert.deepEqual(tasks, originalTasks);
});

void test('due date draft requires permission, valid date and the complete current case scope', () => {
  assert.throws(
    () => createDocumentRequestDueDateDraft(selected, ['request-1', 'request-2'], '2026-09-03', documents, tasks, cases, [member], false, koreanToday),
    /권한이 없습니다/,
  );
  assert.throws(
    () => createDocumentRequestDueDateDraft(selected, ['request-1', 'request-2'], '2026-02-29', documents, tasks, cases, [member], true, koreanToday),
    /올바른 제출기한/,
  );
  assert.throws(
    () => createDocumentRequestDueDateDraft(selected, ['request-1'], '2026-09-03', documents, tasks, cases, [member], true, koreanToday),
    /요청서류 목록이 변경/,
  );
  assert.throws(
    () => createDocumentRequestDueDateDraft(selected, ['request-1', 'request-1'], '2026-09-03', documents, tasks, cases, [member], true, koreanToday),
    /요청서류 목록이 변경/,
  );
  assert.throws(
    () => createDocumentRequestDueDateDraft(selected, ['request-1', 'request-2'], '2026-09-03', [...documents, { ...documents[0], caseId: cases[1].id }], tasks, cases, [member], true, koreanToday),
    /식별자가 다른 기록과 충돌/,
  );
});

void test('due date apply rejects stale case, document, task and permission state', () => {
  const draft = createDocumentRequestDueDateDraft(selected, ['request-1', 'request-2'], '2026-09-03', documents, tasks, cases, [member], true, koreanToday);
  assert.throws(
    () => applyDocumentRequestDueDateDraft(selected, draft, documents, tasks, cases, [member], false, koreanToday),
    /권한을 다시 확인/,
  );
  assert.throws(
    () => applyDocumentRequestDueDateDraft({ ...selected, company: '변경 기업' }, draft, documents, tasks, cases, [member], true, koreanToday),
    /진행을 다시 확인/,
  );
  assert.throws(
    () => applyDocumentRequestDueDateDraft(selected, draft, documents.map((item) => item.id === 'request-1' ? { ...item, title: '변경 자료' } : item), tasks, cases, [member], true, koreanToday),
    /요청서류 또는 연결 업무가 변경/,
  );
  assert.throws(
    () => applyDocumentRequestDueDateDraft(selected, draft, documents, tasks.map((item) => item.id === 'task-request-1' ? { ...item, status: '완료' } : item), cases, [member], true, koreanToday),
    /요청서류 또는 연결 업무가 변경/,
  );
  assert.throws(
    () => applyDocumentRequestDueDateDraft(selected, draft, documents, tasks, cases.map((item) => item.id === selected.id ? { ...item, partnerMemberId: 'partner-2' } : item), [member], true, koreanToday),
    /진행 정보가 변경/,
  );
});

void test('due date impact must be reconfirmed when Korean calendar day changes', () => {
  const beforeMidnight = new Date('2026-09-02T14:59:59.000Z');
  const draft = createDocumentRequestDueDateDraft(selected, ['request-1', 'request-2'], '2026-09-03', documents, tasks, cases, [member], true, beforeMidnight);
  assert.equal(draft.dueState, 'upcoming');
  assert.throws(
    () => applyDocumentRequestDueDateDraft(selected, draft, documents, tasks, cases, [member], true, koreanToday),
    /오늘 날짜 기준이 변경/,
  );
});
