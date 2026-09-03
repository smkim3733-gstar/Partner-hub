import { recordBelongsToCase } from './application-case-links';
import {
  prepareDocumentRequest,
  type DocumentRequestDueState,
  type DocumentRequestItem,
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
  flowManaged?: boolean;
  pipelineLifecycleStatus?: 'active' | 'discontinued';
  nextAction: string;
  updatedAt: string;
  idleDays: number;
};

type TimelineRecord = {
  caseId?: string;
  date: string;
  title: string;
  detail: string;
  type: string;
  tone: string;
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
};

type TaskRecord = {
  id: string;
  caseId?: string;
  company: string;
  title: string;
  kind: string;
  assignee: string;
  partnerMemberId?: string;
};

export type DocumentRequestCommitInput = {
  requestId: string;
  expectedCase: string;
  items: DocumentRequestItem[];
  dueDate: string;
  dueState: DocumentRequestDueState;
};

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatDueDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return `${year}. ${month}. ${day}.`;
}

export function documentRequestCaseFingerprint(caseItem: Pick<CaseRecord, 'id' | 'company' | 'trainee' | 'partnerMemberId' | 'flowManaged' | 'pipelineLifecycleStatus'>) {
  return JSON.stringify([
    caseItem.id,
    caseItem.company,
    caseItem.trainee,
    caseItem.partnerMemberId ?? null,
    caseItem.flowManaged ?? false,
    caseItem.pipelineLifecycleStatus ?? 'active',
  ]);
}

function assertCurrentCase<TCase extends CaseRecord>(
  selected: TCase,
  expectedCase: string,
  cases: TCase[],
) {
  if (selected.flowManaged)
    throw new Error('FLOW가 관리하는 진행은 상담 FLOW에서 서류를 요청해 주세요.');
  if (selected.pipelineLifecycleStatus === 'discontinued')
    throw new Error('중단된 진행을 다시 연 뒤 서류를 요청해 주세요.');
  if (documentRequestCaseFingerprint(selected) !== expectedCase)
    throw new Error('서류요청 작성 중 진행 정보가 변경되었습니다. 최신 화면에서 다시 작성해 주세요.');
  const matches = cases.filter((item) => item.id === selected.id);
  if (
    matches.length !== 1 ||
    documentRequestCaseFingerprint(matches[0]) !== expectedCase
  )
    throw new Error('현재 진행 연결을 다시 확인해 주세요.');
}

function nextRequestNumber(selected: CaseRecord, timeline: TimelineRecord[]) {
  return timeline.filter((item) =>
    (item.caseId ?? 'case-1') === selected.id && item.type === '서류',
  ).length + 1;
}

export function commitDocumentRequest<
  TCase extends CaseRecord,
  TTimeline extends TimelineRecord,
  TDocument extends DocumentRecord,
  TTask extends TaskRecord,
>(
  selected: TCase,
  input: DocumentRequestCommitInput,
  timeline: TTimeline[],
  documents: TDocument[],
  tasks: TTask[],
  cases: TCase[],
  members: MemberRecord[],
  canEdit: boolean,
  now = new Date(),
) {
  if (!canEdit)
    throw new Error('현재 계정의 서류요청 등록 권한을 다시 확인해 주세요.');
  if (!requestIdPattern.test(input.requestId))
    throw new Error('서류요청 저장 식별자를 다시 만들어 주세요.');
  assertCurrentCase(selected, input.expectedCase, cases);

  const documentIds = input.items.map((_, index) => `file-request-${input.requestId}-${index}`);
  const taskId = `task-request-${input.requestId}`;
  if (
    documentIds.some((id) => documents.some((document) => document.id === id)) ||
    tasks.some((task) => task.id === taskId)
  )
    throw new Error('이미 같은 서류요청이 등록되었습니다. 진행 기록을 확인해 주세요.');

  const outstandingNames = documents
    .filter((document) =>
      document.category === '요청서류' &&
      (document.status === '요청중' || document.status === '보완필요') &&
      recordBelongsToCase(document, document.assignedTrainee, selected, cases, members),
    )
    .map((document) => document.title);
  const prepared = prepareDocumentRequest(input.items, input.dueDate, outstandingNames, now);
  if (!prepared.ok) throw new Error(prepared.error);
  if (prepared.skippedOutstanding !== 0)
    throw new Error('작성 중 같은 서류가 이미 제출 요청 중이 되었습니다. 최신 화면에서 다시 확인해 주세요.');
  if (
    prepared.dueState !== input.dueState ||
    JSON.stringify(prepared.items) !== JSON.stringify(input.items)
  )
    throw new Error('서류요청 내용이나 제출기한 영향이 변경되었습니다. 최신 화면에서 다시 확인해 주세요.');

  const requestNumber = nextRequestNumber(selected, timeline);
  const dueLabel = formatDueDate(prepared.dueDate);
  const nextAction = `요청서류 ${prepared.items.length}건 제출 확인`;
  const createdDocuments = prepared.items.map((item, index) => ({
    id: documentIds[index],
    company: selected.company,
    title: item.name,
    category: '요청서류' as const,
    status: '요청중' as const,
    assignedTrainee: selected.trainee,
    partnerMemberId: selected.partnerMemberId,
    caseId: selected.id,
    submittedBy: '기업대표 요청',
    updatedAt: '방금 전',
    dueDate: prepared.dueDate,
    version: '-',
    sensitive: true,
  }));
  const createdTask = {
    id: taskId,
    company: selected.company,
    title: nextAction,
    kind: '서류요청' as const,
    assignee: selected.trainee,
    partnerMemberId: selected.partnerMemberId,
    caseId: selected.id,
    due: dueLabel,
    dueState: prepared.dueState,
    status: '대기' as const,
    priority: prepared.dueState === 'upcoming' ? '보통' as const : '긴급' as const,
    related: `서류요청 #${requestNumber}`,
  };
  const createdTimeline = {
    id: `document-request-${input.requestId}`,
    caseId: selected.id,
    date: '방금 전',
    title: `서류요청 #${requestNumber} 등록`,
    detail: `요청서류 ${prepared.items.length}건 / 제출기한 ${dueLabel} / 전달 담당자: ${selected.trainee} 파트너`,
    type: '서류',
    tone: 'amber',
  };

  return {
    timeline: [...timeline, createdTimeline],
    documents: [...createdDocuments, ...documents],
    tasks: [createdTask, ...tasks],
    cases: cases.map((item) => item.id === selected.id
      ? { ...item, nextAction, updatedAt: '방금 전', idleDays: 0 }
      : item),
    requestNumber,
    documentCount: createdDocuments.length,
    dueDate: prepared.dueDate,
    skippedOutstanding: prepared.skippedOutstanding,
  };
}
