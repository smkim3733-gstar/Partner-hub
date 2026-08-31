// Presentation helpers only. The server still authorizes every state read/write.
type Member = { id: string; name: string; status: string };
type Assignment = { partnerMemberId?: string | null };
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
