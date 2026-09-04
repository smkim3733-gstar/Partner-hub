type IntegrityRecord = Record<string, unknown>;

const requiredTimelineFields = ['date', 'title', 'detail', 'type', 'tone'] as const;

function isRecord(value: unknown): value is IntegrityRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isTrimmedText(value: unknown) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim()
  );
}

export function timelineRecordStateError(
  timelineValue: unknown,
  casesValue: unknown,
): string | null {
  if (
    !Array.isArray(timelineValue) ||
    !timelineValue.every(isRecord) ||
    !Array.isArray(casesValue) ||
    !casesValue.every(isRecord)
  )
    return null;

  const stableIds = new Set<string>();
  for (const record of timelineValue) {
    if (!requiredTimelineFields.every((field) => isTrimmedText(record[field])))
      return '타임라인 필수 표시 필드가 올바르지 않습니다.';

    if (Object.hasOwn(record, 'id')) {
      const id = record.id;
      if (!isTrimmedText(id) || stableIds.has(id as string))
        return '타임라인 안정 ID가 없거나 중복되었습니다.';
      stableIds.add(id as string);
    }

    // Missing caseId is the supported legacy record shape and still follows
    // the historical case-1 projection. New explicit links must be exact.
    if (Object.hasOwn(record, 'caseId')) {
      const caseId = record.caseId;
      if (!isTrimmedText(caseId))
        return '타임라인 진행 연결이 올바르지 않습니다.';
      const matches = casesValue.filter((candidate) => candidate.id === caseId);
      if (matches.length !== 1)
        return '타임라인 진행 연결을 하나로 확인할 수 없습니다.';
    }
  }
  return null;
}
