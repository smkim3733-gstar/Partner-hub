// Presentation helpers only. The server still authorizes every state read/write.
type Member = { id: string; name: string; status: string };
type Assignment = { partnerMemberId?: string | null };
type CaseAssignment = Assignment & {
  id: string;
  trainee: string;
  flowManaged?: boolean;
};
export type CaseAssignmentDraft = {
  caseId: string;
  expectedMemberId: string | null;
  nextMemberId: string;
};
const cleanName = (name: string | undefined) =>
  (name ?? '').replace('(가상)', '').trim();

export function assignmentMemberId(
  record: Assignment,
  legacyName: string | undefined,
  members: Member[],
): string | null {
  if (record.partnerMemberId != null) {
    if (record.partnerMemberId === '') return '';
    return members.some((member) => member.id === record.partnerMemberId)
      ? record.partnerMemberId
      : null;
  }
  const name = cleanName(legacyName);
  const matches = members.filter((member) => cleanName(member.name) === name);
  return name && matches.length === 1 ? matches[0].id : null;
}

export function assignmentDisplayName(
  record: Assignment,
  legacyName: string | undefined,
  members: Member[],
): string {
  const id = assignmentMemberId(record, legacyName, members);
  if (id === '') return '김성민 대표';
  const member = id ? members.find((item) => item.id === id) : undefined;
  return member ? cleanName(member.name) : legacyName || '담당 계정 확인 필요';
}

export function newTaskAssignment(
  memberId: string,
  members: Member[],
  allowAdminOnly: boolean,
) {
  if (!memberId && allowAdminOnly)
    return { partnerMemberId: '', assignee: '김성민 대표' };
  const matches = members.filter(
    (member) => member.id === memberId && member.status === '활성',
  );
  if (matches.length !== 1)
    throw new Error('승인된 담당 계정을 다시 선택해 주세요.');
  return {
    partnerMemberId: matches[0].id,
    assignee: cleanName(matches[0].name),
  };
}

export function createCaseAssignmentDraft(
  record: CaseAssignment,
  nextMemberId: string,
  members: Member[],
): CaseAssignmentDraft {
  if (record.flowManaged)
    throw new Error('상담 FLOW가 관리하는 진행은 담당 계정을 직접 바꿀 수 없습니다.');
  const next = newTaskAssignment(nextMemberId, members, false);
  const expectedMemberId = assignmentMemberId(record, record.trainee, members);
  if (expectedMemberId === next.partnerMemberId)
    throw new Error('이미 이 계정이 담당하고 있습니다.');
  return {
    caseId: record.id,
    expectedMemberId,
    nextMemberId: next.partnerMemberId,
  };
}

export function applyCaseAssignmentDraft<T extends CaseAssignment>(
  record: T,
  draft: CaseAssignmentDraft,
  members: Member[],
): T {
  if (record.id !== draft.caseId)
    throw new Error('담당을 변경할 진행을 다시 확인해 주세요.');
  if (record.flowManaged)
    throw new Error('상담 FLOW가 관리하는 진행은 담당 계정을 직접 바꿀 수 없습니다.');
  if (
    assignmentMemberId(record, record.trainee, members) !==
    draft.expectedMemberId
  )
    throw new Error('담당 정보가 변경되었습니다. 최신 화면에서 다시 선택해 주세요.');
  const next = newTaskAssignment(draft.nextMemberId, members, false);
  return {
    ...record,
    trainee: next.assignee,
    partnerMemberId: next.partnerMemberId,
  };
}
