import { recordBelongsToCase } from './application-case-links';
import {
  documentRequestDueState,
  type DocumentRequestDueState,
} from './legacy-document-request';

type MemberRecord = {
  id: string;
  name: string;
  status: string;
};

type CaseRecord = {
  id: string;
  company: string;
  trainee: string;
  partnerMemberId?: string;
};

type DocumentRecord = {
  id: string;
  caseId?: string;
  company: string;
  title: string;
  category: string;
  status: string;
  assignedTrainee: string;
  partnerMemberId?: string;
  dueDate?: string;
  updatedAt: string;
};

type TaskRecord = {
  id: string;
  caseId?: string;
  company: string;
  title: string;
  kind: string;
  assignee: string;
  partnerMemberId?: string;
  due: string;
  dueState: string;
  status: string;
  priority: string;
  related: string;
};

type TimelineRecord = {
  id?: string;
  caseId?: string;
  date: string;
  title: string;
  detail: string;
  type: string;
  tone: string;
};

export type DocumentRequestDueDateDraft = {
  requestId: string;
  caseId: string;
  company: string;
  dueDate: string;
  dueState: DocumentRequestDueState;
  documentIds: string[];
  documentTitles: string[];
  taskCount: number;
  expectedCase: string;
  expectedDocuments: string;
  expectedTasks: string;
};

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatDueDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return `${year}. ${month}. ${day}.`;
}

function sameStrings(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function assertUniqueIds(records: Array<{ id: string }>, label: string) {
  if (new Set(records.map((item) => item.id)).size !== records.length)
    throw new Error(`${label} 식별자가 중복되었습니다. 저장된 내용을 먼저 확인해 주세요.`);
}

function assertScopedIdsUnique(
  scoped: Array<{ id: string }>,
  all: Array<{ id: string }>,
  label: string,
) {
  assertUniqueIds(scoped, label);
  if (scoped.some((item) => all.filter((candidate) => candidate.id === item.id).length !== 1))
    throw new Error(`${label} 식별자가 다른 기록과 충돌합니다. 저장된 내용을 먼저 확인해 주세요.`);
}

function caseSignature(caseItem: CaseRecord) {
  return JSON.stringify([
    caseItem.id,
    caseItem.company,
    caseItem.trainee,
    caseItem.partnerMemberId ?? null,
  ]);
}

function documentSignature(documents: DocumentRecord[]) {
  return JSON.stringify(documents.map((document) => [
    document.id,
    document.caseId ?? null,
    document.company,
    document.title,
    document.category,
    document.status,
    document.assignedTrainee,
    document.partnerMemberId ?? null,
    document.dueDate ?? null,
  ]));
}

function taskSignature(tasks: TaskRecord[]) {
  return JSON.stringify(tasks.map((task) => [
    task.id,
    task.caseId ?? null,
    task.company,
    task.title,
    task.kind,
    task.assignee,
    task.partnerMemberId ?? null,
    task.due,
    task.dueState,
    task.status,
    task.priority,
    task.related,
  ]));
}

function currentScope(
  selected: CaseRecord,
  documents: DocumentRecord[],
  tasks: TaskRecord[],
  cases: CaseRecord[],
  members: MemberRecord[],
) {
  const caseMatches = cases.filter((item) => item.id === selected.id);
  if (caseMatches.length !== 1 || caseSignature(caseMatches[0]) !== caseSignature(selected))
    throw new Error('진행 정보가 변경되었습니다. 최신 화면에서 다시 확인해 주세요.');

  const scopedDocuments = documents
    .filter((document) =>
      document.category === '요청서류' &&
      (document.status === '요청중' || document.status === '보완필요') &&
      !document.dueDate &&
      recordBelongsToCase(document, document.assignedTrainee, selected, cases, members),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!scopedDocuments.length)
    throw new Error('현재 제출기한이 누락된 요청서류가 없습니다.');
  assertScopedIdsUnique(scopedDocuments, documents, '요청서류');

  const scopedTasks = tasks
    .filter((task) =>
      task.kind === '서류요청' &&
      task.due === '기한 확인' &&
      recordBelongsToCase(task, task.assignee, selected, cases, members),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  assertScopedIdsUnique(scopedTasks, tasks, '연결 업무');
  return { scopedDocuments, scopedTasks };
}

export function createDocumentRequestDueDateDraft(
  selected: CaseRecord,
  documentIds: string[],
  dueDate: string,
  documents: DocumentRecord[],
  tasks: TaskRecord[],
  cases: CaseRecord[],
  members: MemberRecord[],
  canEdit: boolean,
  requestId: string,
  now = new Date(),
): DocumentRequestDueDateDraft {
  if (!canEdit)
    throw new Error('요청서류 제출기한을 변경할 권한이 없습니다.');
  if (!requestIdPattern.test(requestId))
    throw new Error('제출기한 저장 식별자를 다시 만들어 주세요.');
  const dueState = documentRequestDueState(dueDate, now);
  if (!dueState)
    throw new Error('올바른 제출기한을 선택해 주세요.');
  const { scopedDocuments, scopedTasks } = currentScope(selected, documents, tasks, cases, members);
  const requestedIds = [...documentIds].sort((left, right) => left.localeCompare(right));
  if (new Set(requestedIds).size !== requestedIds.length || !sameStrings(requestedIds, scopedDocuments.map((item) => item.id)))
    throw new Error('기한을 보정할 요청서류 목록이 변경되었습니다. 최신 화면에서 다시 확인해 주세요.');
  return {
    requestId,
    caseId: selected.id,
    company: selected.company,
    dueDate,
    dueState,
    documentIds: scopedDocuments.map((item) => item.id),
    documentTitles: scopedDocuments.map((item) => item.title),
    taskCount: scopedTasks.length,
    expectedCase: caseSignature(selected),
    expectedDocuments: documentSignature(scopedDocuments),
    expectedTasks: taskSignature(scopedTasks),
  };
}

export function applyDocumentRequestDueDateDraft<
  TDocument extends DocumentRecord,
  TTask extends TaskRecord,
  TTimeline extends TimelineRecord,
>(
  selected: CaseRecord,
  draft: DocumentRequestDueDateDraft,
  documents: TDocument[],
  tasks: TTask[],
  timeline: TTimeline[],
  cases: CaseRecord[],
  members: MemberRecord[],
  canEdit: boolean,
  now = new Date(),
) {
  if (!canEdit)
    throw new Error('현재 계정의 요청서류 변경 권한을 다시 확인해 주세요.');
  if (!requestIdPattern.test(draft.requestId))
    throw new Error('제출기한 저장 식별자를 다시 만들어 주세요.');
  if (
    selected.id !== draft.caseId ||
    selected.company !== draft.company ||
    caseSignature(selected) !== draft.expectedCase
  )
    throw new Error('제출기한을 변경할 진행을 다시 확인해 주세요.');
  const dueState = documentRequestDueState(draft.dueDate, now);
  if (!dueState || dueState !== draft.dueState)
    throw new Error('오늘 날짜 기준이 변경되었습니다. 제출기한 영향을 다시 확인해 주세요.');
  const { scopedDocuments, scopedTasks } = currentScope(selected, documents, tasks, cases, members);
  if (
    documentSignature(scopedDocuments) !== draft.expectedDocuments ||
    taskSignature(scopedTasks) !== draft.expectedTasks
  )
    throw new Error('요청서류 또는 연결 업무가 변경되었습니다. 최신 화면에서 다시 확인해 주세요.');

  const documentIds = new Set(draft.documentIds);
  const taskIds = new Set(scopedTasks.map((item) => item.id));
  const dueLabel = formatDueDate(draft.dueDate);
  const timelineId = `document-due-${draft.requestId}`;
  if (timeline.some((item) => item.id === timelineId))
    throw new Error('이미 같은 제출기한이 저장되었습니다. 진행 기록을 확인해 주세요.');
  const createdTimeline = {
    id: timelineId,
    caseId: selected.id,
    date: '방금 전',
    title: '서류 제출기한 설정',
    detail: `요청서류 ${scopedDocuments.length}건 / 제출기한 ${dueLabel}`,
    type: '기한',
    tone: 'amber',
  };
  return {
    documents: documents.map((document) => documentIds.has(document.id)
      ? { ...document, dueDate: draft.dueDate, updatedAt: '방금 전' }
      : document),
    tasks: tasks.map((task) => taskIds.has(task.id)
      ? {
          ...task,
          due: dueLabel,
          dueState,
          priority: dueState === 'upcoming' ? '보통' : '긴급',
        }
      : task),
    timeline: [...timeline, createdTimeline],
    createdTimeline,
    documentCount: scopedDocuments.length,
    taskCount: scopedTasks.length,
    dueDate: draft.dueDate,
    dueState,
  };
}
