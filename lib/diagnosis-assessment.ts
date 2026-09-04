type RecordValue = Record<string, unknown>;

const identityStatuses = ['일치', '확인필요', '불일치'] as const;
const levels = ['A', 'B', 'C'] as const;
const decisions = [
  '1차 초안 생성 가능',
  'Step 0·보완요청',
  'AI 처리 중단',
] as const;
const statuses = [
  '사전점검 완료',
  '대표 검토 대기',
  '보완자료 대기',
  '처리 중단',
] as const;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isTrimmedText(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value) && value === value.trim();
}

function isOneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): value is T[number] {
  return typeof value === 'string' && allowed.includes(value);
}

function hasConsistentResult(record: RecordValue) {
  if (record.level === 'A')
    return (
      record.decision === '1차 초안 생성 가능' &&
      (record.status === '사전점검 완료' ||
        record.status === '대표 검토 대기')
    );
  if (record.level === 'B')
    return (
      record.decision === 'Step 0·보완요청' &&
      record.status === '보완자료 대기'
    );
  return record.decision === 'AI 처리 중단' && record.status === '처리 중단';
}

export function isDiagnosisAssessmentRecord(
  value: unknown,
): value is RecordValue {
  if (!isRecord(value)) return false;
  return (
    isTrimmedText(value.id) &&
    isTrimmedText(value.caseId) &&
    isTrimmedText(value.company) &&
    isOneOf(value.identityStatus, identityStatuses) &&
    typeof value.hasConsultationEvidence === 'boolean' &&
    typeof value.privacyMasked === 'boolean' &&
    typeof value.personalDataConsent === 'boolean' &&
    typeof value.thirdPartyAiConsent === 'boolean' &&
    typeof value.transcriptConsent === 'boolean' &&
    isOneOf(value.level, levels) &&
    isOneOf(value.decision, decisions) &&
    isOneOf(value.status, statuses) &&
    isTrimmedText(value.updatedAt) &&
    hasConsistentResult(value)
  );
}

export function diagnosisAssessmentStateError(
  assessments: unknown,
  cases: unknown,
): string | null {
  if (assessments === undefined) return null;
  if (!Array.isArray(assessments))
    return '사전점검 데이터 형식이 올바르지 않습니다.';
  if (!Array.isArray(cases))
    return '사전점검 진행 연결을 확인할 수 없습니다.';

  const ids = new Set<string>();
  for (const assessment of assessments) {
    if (!isRecord(assessment))
      return '사전점검 데이터 형식이 올바르지 않습니다.';
    if (
      !isTrimmedText(assessment.id) ||
      ids.has(assessment.id)
    )
      return '사전점검 ID가 없거나 중복되었습니다.';
    ids.add(assessment.id);
    if (!isDiagnosisAssessmentRecord(assessment))
      return '사전점검 필드 또는 판정값이 올바르지 않습니다.';

    const linkedCases = cases.filter(
      (candidate) =>
        isRecord(candidate) &&
        candidate.id === assessment.caseId &&
        candidate.company === assessment.company,
    );
    if (linkedCases.length !== 1)
      return '사전점검 진행 연결을 하나로 확인할 수 없습니다.';
  }
  return null;
}
