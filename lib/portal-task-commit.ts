import { newTaskAssignment } from './assignment-display';
import {
  preparePortalTaskDraft,
  type PortalTaskDraftInput,
} from './portal-task-draft';

type MemberRecord = {
  id: string;
  name: string;
  status: string;
};

type TaskRecord = { id: string };

export type PortalTaskCommitInput = {
  requestId: string;
  assigneeMemberId: string;
  draft: PortalTaskDraftInput;
};

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function commitPortalTask<
  TTask extends TaskRecord,
  TMember extends MemberRecord,
>(
  input: PortalTaskCommitInput,
  tasks: TTask[],
  members: TMember[],
  isAdmin: boolean,
  currentMemberId: string | null,
) {
  if (!requestIdPattern.test(input.requestId))
    throw new Error('업무 저장 식별자를 다시 만들어 주세요.');
  if (!isAdmin && (!currentMemberId || input.assigneeMemberId !== currentMemberId))
    throw new Error('현재 계정의 업무 담당 연결을 다시 확인해 주세요.');

  const prepared = preparePortalTaskDraft(input.draft);
  if (!prepared.ok) throw new Error(prepared.error);
  const assignment = newTaskAssignment(
    isAdmin ? input.assigneeMemberId : currentMemberId ?? '',
    members,
    isAdmin,
  );
  const taskId = `task-${input.requestId}`;
  if (tasks.some((item) => item.id === taskId))
    throw new Error('이미 같은 업무가 등록되었습니다. 업무 목록을 확인해 주세요.');

  const task = {
    id: taskId,
    company: prepared.value.company,
    title: prepared.value.title,
    kind: prepared.value.kind,
    ...(prepared.value.supportCategory
      ? { supportCategory: prepared.value.supportCategory }
      : {}),
    ...assignment,
    due: prepared.value.due,
    dueState: prepared.value.dueState,
    status: '대기' as const,
    priority: prepared.value.dueState === 'today' || prepared.value.dueState === 'overdue'
      ? '긴급' as const
      : '보통' as const,
    related: '직접 등록',
  };

  return { task, tasks: [task, ...tasks] };
}
