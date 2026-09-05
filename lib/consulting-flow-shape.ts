import type { ConsultingFlow } from './consulting-flow';

type JsonRecord = Record<string, unknown>;
type ShapeMode = 'public' | 'stored' | 'projected';

const asRecord = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
const text = (value: unknown): value is string => typeof value === 'string';
const named = (value: unknown): value is string =>
  text(value) && value.trim().length > 0;
const timestamp = (value: unknown) =>
  text(value) && value.length > 0 && Number.isFinite(Date.parse(value));
const optionalText = (value: unknown) => value === undefined || named(value);
const optionalTimestamp = (value: unknown) =>
  value === undefined || timestamp(value);
const safeInteger = (value: unknown, minimum = 0) =>
  Number.isSafeInteger(value) && (value as number) >= minimum;
const oneOf = (value: unknown, allowed: readonly unknown[]) =>
  allowed.includes(value);

function validItems(value: unknown, valid: (item: JsonRecord) => boolean) {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every((entry) => {
    const item = asRecord(entry);
    if (!item || !valid(item) || !named(item.id) || ids.has(item.id as string))
      return false;
    ids.add(item.id as string);
    return true;
  });
}

function validReport(item: JsonRecord, projected: boolean) {
  if (!safeInteger(item.stage, 1) || (item.stage as number) > 6) return false;
  if (projected)
    return [
      'sourceReportId',
      'sourceRecordingId',
      'decisionId',
      'documentsKey',
    ].every((key) => item[key] === null || optionalText(item[key]));
  return (
    safeInteger(item.version, 1) &&
    named(item.title) &&
    text(item.body) &&
    timestamp(item.createdAt) &&
    named(item.createdBy) &&
    oneOf(item.origin, ['manual', 'ai']) &&
    [
      'fileId',
      'sourceReportId',
      'sourceRecordingId',
      'decisionId',
      'documentsKey',
    ].every((key) => optionalText(item[key]))
  );
}

function validFile(item: JsonRecord, stored: boolean) {
  return (
    named(item.name) &&
    named(item.contentType) &&
    safeInteger(item.size) &&
    text(item.key) &&
    (!stored || named(item.key)) &&
    timestamp(item.createdAt) &&
    named(item.purpose) &&
    ['intakeFileId', 'intakeSourceHash', 'sourceReviewedBy'].every((key) =>
      optionalText(item[key]),
    ) &&
    optionalTimestamp(item.sourceReviewedAt)
  );
}

function validMeeting(item: JsonRecord) {
  return (
    oneOf(item.kind, ['first', 'followup', 'contract']) &&
    timestamp(item.startsAt) &&
    timestamp(item.endsAt) &&
    Date.parse(item.endsAt as string) > Date.parse(item.startsAt as string) &&
    named(item.location) &&
    oneOf(item.attendance, ['both', 'partner', 'admin']) &&
    oneOf(item.status, ['scheduled', 'completed', 'cancelled']) &&
    text(item.note) &&
    named(item.createdBy) &&
    optionalTimestamp(item.completedAt)
  );
}

function validRecording(item: JsonRecord, projected: boolean) {
  if (projected) return true;
  return (
    named(item.meetingId) &&
    ['fileId', 'transcriptFileId', 'audioFileId', 'transcriptReviewedBy'].every(
      (key) => optionalText(item[key]),
    ) &&
    text(item.transcript) &&
    optionalTimestamp(item.transcriptReviewedAt) &&
    timestamp(item.consentAt) &&
    timestamp(item.createdAt)
  );
}

function validRequest(item: JsonRecord) {
  return (
    named(item.title) &&
    typeof item.required === 'boolean' &&
    oneOf(item.channel, ['카카오톡', '이메일', '기타']) &&
    named(item.recipient) &&
    text(item.dueDate) &&
    oneOf(item.status, ['requested', 'received', 'verified', 'needs_fix']) &&
    optionalText(item.fileId) &&
    text(item.note) &&
    timestamp(item.createdAt) &&
    ['sentAt', 'receivedAt', 'reviewedAt', 'verifiedAt'].every((key) =>
      optionalTimestamp(item[key]),
    )
  );
}

function validPayment(item: JsonRecord) {
  return (
    safeInteger(item.amountWon, 1) &&
    (item.amountWon as number) <= 1_000_000_000_000 &&
    named(item.receivedAt) &&
    named(item.reference) &&
    named(item.confirmedBy) &&
    timestamp(item.recordedAt)
  );
}

function validJob(item: JsonRecord) {
  return (
    oneOf(item.stage, [1, 4]) &&
    oneOf(item.status, [
      'queued',
      'processing',
      'blocked',
      'failed',
      'complete',
    ]) &&
    text(item.reason) &&
    timestamp(item.createdAt) &&
    ['sourceRecordingId', 'sourceReportId', 'reportId'].every((key) =>
      optionalText(item[key]),
    ) &&
    optionalTimestamp(item.startedAt) &&
    optionalTimestamp(item.completedAt)
  );
}

function validAudit(item: JsonRecord) {
  return (
    timestamp(item.at) &&
    named(item.actor) &&
    named(item.action) &&
    named(item.detail)
  );
}

function validAnalysis(value: unknown) {
  const analysis = asRecord(value);
  return Boolean(
    analysis &&
    text(analysis.reportId) &&
    optionalTimestamp(analysis.adminAt) &&
    optionalTimestamp(analysis.partnerAt),
  );
}

function validAi(value: unknown, projected: boolean) {
  const ai = asRecord(value);
  return Boolean(
    ai &&
    typeof ai.enabled === 'boolean' &&
    (projected || text(ai.sourceText)) &&
    optionalTimestamp(ai.approvedAt) &&
    optionalText(ai.approvedBy),
  );
}

function validDecision(value: unknown) {
  if (value === undefined) return true;
  const item = asRecord(value);
  return Boolean(
    item &&
    named(item.id) &&
    named(item.reportId) &&
    Array.isArray(item.solutions) &&
    item.solutions.every(named) &&
    text(item.note) &&
    typeof item.documentsNeeded === 'boolean' &&
    timestamp(item.at),
  );
}

function validContract(value: unknown) {
  if (value === undefined) return true;
  const item = asRecord(value);
  return Boolean(
    item &&
    named(item.meetingId) &&
    named(item.reportId) &&
    named(item.signedFileId) &&
    named(item.signedAt) &&
    safeInteger(item.expectedDepositWon, 1) &&
    (item.expectedDepositWon as number) <= 1_000_000_000_000 &&
    named(item.recordedBy),
  );
}

function validAftercare(value: unknown) {
  if (value === undefined) return true;
  const item = asRecord(value);
  return Boolean(
    item &&
    timestamp(item.at) &&
    named(item.summary) &&
    named(item.nextDate) &&
    named(item.owner),
  );
}

function validReceipts(value: unknown) {
  if (value === undefined) return true;
  const receipts = asRecord(value);
  return Boolean(
    receipts &&
    Object.entries(receipts).every(([key, entry]) => {
      const receipt = asRecord(entry);
      return (
        named(key) &&
        receipt &&
        named(receipt.actorKey) &&
        named(receipt.fingerprint)
      );
    }),
  );
}

function hasBaseStructure(value: unknown, mode: ShapeMode) {
  const flow = asRecord(value);
  if (!flow) return false;
  const projected = mode === 'projected';
  const stored = mode === 'stored';
  const requiredStrings = ['caseId', 'company', 'partnerId', 'partnerName'];
  return (
    flow.schemaVersion === 1 &&
    requiredStrings.every((key) => named(flow[key])) &&
    text(flow.updatedAt) &&
    safeInteger(flow.revision) &&
    validItems(flow.reports, (item) => validReport(item, projected)) &&
    (projected || validItems(flow.files, (item) => validFile(item, stored))) &&
    validAnalysis(flow.analysis) &&
    validItems(flow.meetings, validMeeting) &&
    validItems(flow.recordings, (item) => validRecording(item, projected)) &&
    validItems(flow.requests, validRequest) &&
    validDecision(flow.decision) &&
    validContract(flow.contract) &&
    validItems(flow.payments, validPayment) &&
    (flow.executionStartedAt === undefined ||
      timestamp(flow.executionStartedAt)) &&
    validAftercare(flow.aftercare) &&
    validAi(flow.ai, projected) &&
    (projected || validItems(flow.jobs, validJob)) &&
    (projected || validItems(flow.audit, validAudit)) &&
    (projected ||
      (Array.isArray(flow.commandIds) &&
        flow.commandIds.every(named) &&
        new Set(flow.commandIds).size === flow.commandIds.length)) &&
    (projected || validReceipts(flow.commandReceipts))
  );
}

export function hasConsultingFlowStructure(
  value: unknown,
): value is ConsultingFlow {
  return hasBaseStructure(value, 'public');
}

export function hasStoredConsultingFlowStructure(
  value: unknown,
): value is ConsultingFlow {
  return hasBaseStructure(value, 'stored');
}

export function hasProjectedConsultingFlowStructure(value: unknown) {
  return hasBaseStructure(value, 'projected');
}
