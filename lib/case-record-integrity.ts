type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isTrimmedText(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value) && value === value.trim();
}

export function caseRecordStateError(
  cases: unknown,
  members: unknown,
): string | null {
  if (!Array.isArray(cases) || !cases.every(isRecord))
    return '진행 데이터 형식이 올바르지 않습니다.';
  if (!Array.isArray(members) || !members.every(isRecord))
    return '진행 담당 계정 명단을 확인할 수 없습니다.';

  for (const caseRecord of cases) {
    if (
      !isTrimmedText(caseRecord.company) ||
      !isTrimmedText(caseRecord.trainee)
    )
      return '진행 필수 표시 필드가 올바르지 않습니다.';

    const partnerMemberId = caseRecord.partnerMemberId;
    // Missing IDs are preserved for legacy name-based records. An empty string
    // is the explicit representative-only assignment used by existing data.
    if (partnerMemberId === undefined || partnerMemberId === '') continue;
    if (
      typeof partnerMemberId !== 'string' ||
      partnerMemberId !== partnerMemberId.trim()
    )
      return '진행 담당 계정 연결을 하나로 확인할 수 없습니다.';
    const matches = members.filter((member) => member.id === partnerMemberId);
    if (matches.length !== 1)
      return '진행 담당 계정 연결을 하나로 확인할 수 없습니다.';
  }
  return null;
}
