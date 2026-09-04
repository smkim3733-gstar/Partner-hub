type IntegrityRecord = Record<string, unknown>;

type RelatedCollection = {
  label: string;
  records: unknown;
};

function isRecord(value: unknown): value is IntegrityRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizedMemberName(value: unknown) {
  return typeof value === 'string' ? value.replace('(가상)', '').trim() : '';
}

function uniqueMemberIdForName(
  members: IntegrityRecord[],
  name: unknown,
): string | null {
  const normalized = normalizedMemberName(name);
  if (!normalized) return null;
  const matches = members.filter(
    (member) => normalizedMemberName(member.name) === normalized,
  );
  return matches.length === 1 && typeof matches[0].id === 'string'
    ? matches[0].id
    : null;
}

function caseOwnerId(
  caseRecord: IntegrityRecord,
  members: IntegrityRecord[],
): string | null {
  if (Object.hasOwn(caseRecord, 'partnerMemberId')) {
    const memberId = caseRecord.partnerMemberId;
    return typeof memberId === 'string' && memberId ? memberId : null;
  }
  return uniqueMemberIdForName(members, caseRecord.trainee);
}

function collectionError(
  collection: RelatedCollection,
  cases: IntegrityRecord[],
  members: IntegrityRecord[],
): string | null {
  if (!Array.isArray(collection.records) || !collection.records.every(isRecord))
    return null;

  for (const record of collection.records) {
    let linkedCase: IntegrityRecord | null = null;
    if (Object.hasOwn(record, 'caseId')) {
      const caseId = record.caseId;
      if (
        typeof caseId !== 'string' ||
        !caseId ||
        caseId !== caseId.trim()
      )
        return `${collection.label} 진행 연결이 올바르지 않습니다.`;
      const matches = cases.filter((candidate) => candidate.id === caseId);
      if (matches.length !== 1)
        return `${collection.label} 진행 연결을 하나로 확인할 수 없습니다.`;
      linkedCase = matches[0];
    }

    let explicitMemberId: string | null = null;
    if (Object.hasOwn(record, 'partnerMemberId')) {
      const memberId = record.partnerMemberId;
      if (typeof memberId !== 'string' || memberId !== memberId.trim())
        return `${collection.label} 담당 계정 연결이 올바르지 않습니다.`;
      if (memberId) {
        const matches = members.filter((member) => member.id === memberId);
        if (matches.length !== 1)
          return `${collection.label} 담당 계정 연결을 하나로 확인할 수 없습니다.`;
        explicitMemberId = memberId;
      }
    }

    // Empty assignment is the supported representative-only marker. Missing
    // assignment preserves legacy name/case inheritance. A non-empty direct
    // assignment must agree with its linked case or nobody can own the record.
    if (
      linkedCase &&
      explicitMemberId &&
      caseOwnerId(linkedCase, members) !== explicitMemberId
    )
      return `${collection.label} 담당 계정과 진행 담당 계정이 일치하지 않습니다.`;
  }

  return null;
}

export function relatedRecordStateError(
  tasks: unknown,
  companyDocuments: unknown,
  schedule: unknown,
  casesValue: unknown,
  membersValue: unknown,
): string | null {
  if (
    !Array.isArray(casesValue) ||
    !casesValue.every(isRecord) ||
    !Array.isArray(membersValue) ||
    !membersValue.every(isRecord)
  )
    return null;

  const collections: RelatedCollection[] = [
    { label: '업무', records: tasks },
    { label: '기업자료', records: companyDocuments },
    { label: '일정', records: schedule },
  ];
  for (const collection of collections) {
    const error = collectionError(collection, casesValue, membersValue);
    if (error) return error;
  }
  return null;
}
