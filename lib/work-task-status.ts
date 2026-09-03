export const WORK_TASK_STATUSES = ['대기', '진행', '완료'] as const;
export type WorkTaskStatus = (typeof WORK_TASK_STATUSES)[number];

type StatusTask = {
  id: string;
  kind: string;
  status: string;
  title?: string;
  company?: string;
  assignee?: string;
  partnerMemberId?: string;
  due?: string;
  dueState?: string;
  supportCycle?: number;
};

type WorkTaskStatusIntent = 'completion_toggle' | 'support_acknowledge';
type WorkTaskActorRole = 'admin' | 'partner';

export type WorkTaskStatusDraft = {
  taskId: string;
  expectedKind: string;
  expectedStatus: WorkTaskStatus;
  expectedTitle: string | null;
  expectedCompany: string | null;
  expectedAssignee: string | null;
  expectedPartnerMemberId: string | null;
  expectedDue: string | null;
  expectedDueState: string | null;
  expectedSupportCycle: number | null;
  nextStatus: WorkTaskStatus;
  intent: WorkTaskStatusIntent;
  actorRole: WorkTaskActorRole;
};

function isWorkTaskStatus(value: unknown): value is WorkTaskStatus {
  return WORK_TASK_STATUSES.includes(value as WorkTaskStatus);
}

function actorRole(isAdmin: boolean): WorkTaskActorRole {
  return isAdmin ? 'admin' : 'partner';
}

function requireCurrentStatus(task: StatusTask): WorkTaskStatus {
  if (!isWorkTaskStatus(task.status))
    throw new Error('현재 업무 상태를 다시 확인해 주세요.');
  return task.status;
}

function taskContext(task: StatusTask) {
  return {
    expectedTitle: task.title ?? null,
    expectedCompany: task.company ?? null,
    expectedAssignee: task.assignee ?? null,
    expectedPartnerMemberId: task.partnerMemberId ?? null,
    expectedDue: task.due ?? null,
    expectedDueState: task.dueState ?? null,
    expectedSupportCycle: Number.isSafeInteger(task.supportCycle)
      ? task.supportCycle ?? null
      : null,
  };
}

export function createWorkTaskCompletionDraft(
  task: StatusTask,
  isAdmin: boolean,
): WorkTaskStatusDraft {
  const currentStatus = requireCurrentStatus(task);
  const nextStatus: WorkTaskStatus = currentStatus === '완료'
    ? task.kind === '지원요청' && !isAdmin
      ? '대기'
      : '진행'
    : '완료';
  return {
    taskId: task.id,
    expectedKind: task.kind,
    expectedStatus: currentStatus,
    ...taskContext(task),
    nextStatus,
    intent: 'completion_toggle',
    actorRole: actorRole(isAdmin),
  };
}

export function createSupportAcknowledgementDraft(
  task: StatusTask,
  isAdmin: boolean,
): WorkTaskStatusDraft {
  const currentStatus = requireCurrentStatus(task);
  if (!isAdmin || task.kind !== '지원요청' || currentStatus !== '대기')
    throw new Error('처리를 시작할 지원 요청을 다시 확인해 주세요.');
  return {
    taskId: task.id,
    expectedKind: task.kind,
    expectedStatus: currentStatus,
    ...taskContext(task),
    nextStatus: '진행',
    intent: 'support_acknowledge',
    actorRole: 'admin',
  };
}

function expectedNextStatus(
  task: StatusTask,
  draft: WorkTaskStatusDraft,
): WorkTaskStatus {
  if (draft.intent === 'support_acknowledge') {
    if (
      draft.actorRole !== 'admin' ||
      task.kind !== '지원요청' ||
      task.status !== '대기'
    )
      throw new Error('지원 요청 처리 조건이 변경되었습니다. 다시 확인해 주세요.');
    return '진행';
  }
  return task.status === '완료'
    ? task.kind === '지원요청' && draft.actorRole === 'partner'
      ? '대기'
      : '진행'
    : '완료';
}

export function applyWorkTaskStatusDraft<T extends StatusTask>(
  task: T,
  draft: WorkTaskStatusDraft,
  isAdmin: boolean,
): T & { status: WorkTaskStatus } {
  if (task.id !== draft.taskId)
    throw new Error('상태를 변경할 업무를 다시 확인해 주세요.');
  if (
    task.kind !== draft.expectedKind ||
    task.status !== draft.expectedStatus ||
    task.title !== (draft.expectedTitle ?? undefined) ||
    task.company !== (draft.expectedCompany ?? undefined) ||
    task.assignee !== (draft.expectedAssignee ?? undefined) ||
    task.partnerMemberId !== (draft.expectedPartnerMemberId ?? undefined) ||
    task.due !== (draft.expectedDue ?? undefined) ||
    task.dueState !== (draft.expectedDueState ?? undefined) ||
    (Number.isSafeInteger(task.supportCycle) ? task.supportCycle : undefined) !==
      (draft.expectedSupportCycle ?? undefined)
  )
    throw new Error('업무 내용·담당·마감 또는 상태가 변경되었습니다. 최신 화면에서 다시 확인해 주세요.');
  if (draft.actorRole !== actorRole(isAdmin))
    throw new Error('현재 계정 권한을 다시 확인해 주세요.');
  requireCurrentStatus(task);
  if (draft.nextStatus !== expectedNextStatus(task, draft))
    throw new Error('업무 상태 변경 내용을 다시 확인해 주세요.');
  return { ...task, status: draft.nextStatus };
}

export function workTaskStatusImpact(draft: WorkTaskStatusDraft) {
  if (draft.intent === 'support_acknowledge')
    return '처리 시작 시각이 서버에서 기록되고 대표 응답시간 지표에 반영됩니다.';
  if (draft.expectedKind === '지원요청' && draft.nextStatus === '완료')
    return '현재 지원 요청 주기가 종료되고 처리 주체·처리시간 지표가 서버에서 기록됩니다.';
  if (draft.expectedKind === '지원요청' && draft.expectedStatus === '완료')
    return '새 지원 요청 주기가 시작됩니다. 대표가 다시 처리할 요청으로 집계됩니다.';
  if (draft.nextStatus === '완료')
    return '완료 업무로 집계되며 오늘 마감·기한 지연 알림에서 제외됩니다.';
  return '미완료 업무로 돌아가며 마감 상태에 따라 사이트 알림에 다시 포함될 수 있습니다.';
}
