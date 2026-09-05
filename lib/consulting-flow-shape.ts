import type { ConsultingFlow } from './consulting-flow';

type JsonRecord = Record<string, unknown>;
type ShapeMode = 'public' | 'stored' | 'projected';

export const FLOW_COLLECTION_LIMITS = {
  reports: 4000,
  files: 4000,
  meetings: 2000,
  recordings: 2000,
  requests: 2000,
  payments: 2000,
  jobs: 2000,
  audit: 4000,
  commandIds: 2000,
  commandReceipts: 2000,
} as const;

export const FLOW_TEXT_LIMITS = {
  reportBody: 80000,
  transcript: 60000,
  aiSourceText: 80000,
  jobReason: 4000,
  auditDetail: 2000,
} as const;

export const FLOW_FIELD_LIMITS = {
  id: 200,
  timestamp: 40,
  company: 300,
  partnerName: 200,
  reportTitle: 200,
  documentsKey: 300000,
  fileName: 300,
  fileContentType: 200,
  fileKey: 600,
  filePurpose: 100,
  fileMetadata: 500,
  meetingLocation: 200,
  meetingNote: 1500,
  actor: 200,
  auditAction: 100,
  requestTitle: 150,
  requestRecipient: 100,
  requestNote: 1000,
  paymentReference: 200,
  decisionSolutionCount: 12,
  decisionSolution: 80,
  decisionNote: 2000,
  aftercareSummary: 3000,
  aftercareOwner: 100,
  receiptActorKey: 500,
  receiptFingerprint: 200,
} as const;

const asRecord = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
const text = (value: unknown): value is string => typeof value === 'string';
/** Matches SQLite length(TEXT): Unicode code points, not UTF-16 code units. */
export const flowTextLength = (value: string) => Array.from(value).length;
const named = (value: unknown): value is string =>
  text(value) && value.trim().length > 0;
const boundedText = (value: unknown, maximum: number): value is string =>
  text(value) && flowTextLength(value) <= maximum;
const boundedName = (value: unknown, maximum: number): value is string =>
  named(value) && flowTextLength(value) <= maximum;
const timestamp = (value: unknown): value is string =>
  boundedName(value, FLOW_FIELD_LIMITS.timestamp) &&
  Number.isFinite(Date.parse(value));
const optionalText = (value: unknown, maximum: number = FLOW_FIELD_LIMITS.id) =>
  value === undefined || boundedName(value, maximum);
const optionalTimestamp = (value: unknown) =>
  value === undefined || timestamp(value);
const calendarDate = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value
  );
};
const safeInteger = (value: unknown, minimum = 0) =>
  Number.isSafeInteger(value) && (value as number) >= minimum;
const oneOf = (value: unknown, allowed: readonly unknown[]) =>
  allowed.includes(value);

function validItems(
  value: unknown,
  maximum: number,
  valid: (item: JsonRecord) => boolean,
) {
  if (!Array.isArray(value) || value.length > maximum) return false;
  const ids = new Set<string>();
  return value.every((entry) => {
    const item = asRecord(entry);
    if (
      !item ||
      !valid(item) ||
      !boundedName(item.id, FLOW_FIELD_LIMITS.id) ||
      ids.has(item.id as string)
    )
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
    ].every(
      (key) =>
        item[key] === null ||
        optionalText(
          item[key],
          key === 'documentsKey'
            ? FLOW_FIELD_LIMITS.documentsKey
            : FLOW_FIELD_LIMITS.id,
        ),
    );
  return (
    safeInteger(item.version, 1) &&
    boundedName(item.title, FLOW_FIELD_LIMITS.reportTitle) &&
    boundedText(item.body, FLOW_TEXT_LIMITS.reportBody) &&
    timestamp(item.createdAt) &&
    boundedName(item.createdBy, FLOW_FIELD_LIMITS.actor) &&
    oneOf(item.origin, ['manual', 'ai']) &&
    [
      'fileId',
      'sourceReportId',
      'sourceRecordingId',
      'decisionId',
      'documentsKey',
    ].every((key) =>
      optionalText(
        item[key],
        key === 'documentsKey'
          ? FLOW_FIELD_LIMITS.documentsKey
          : FLOW_FIELD_LIMITS.id,
      ),
    )
  );
}

function validFile(item: JsonRecord, stored: boolean) {
  return (
    boundedName(item.name, FLOW_FIELD_LIMITS.fileName) &&
    boundedName(item.contentType, FLOW_FIELD_LIMITS.fileContentType) &&
    safeInteger(item.size) &&
    boundedText(item.key, FLOW_FIELD_LIMITS.fileKey) &&
    (!stored || boundedName(item.key, FLOW_FIELD_LIMITS.fileKey)) &&
    timestamp(item.createdAt) &&
    boundedName(item.purpose, FLOW_FIELD_LIMITS.filePurpose) &&
    ['intakeFileId', 'intakeSourceHash', 'sourceReviewedBy'].every((key) =>
      optionalText(item[key], FLOW_FIELD_LIMITS.fileMetadata),
    ) &&
    optionalTimestamp(item.sourceReviewedAt)
  );
}

function validMeeting(item: JsonRecord) {
  const validStatusTime =
    item.status === 'completed'
      ? timestamp(item.completedAt) &&
        Date.parse(item.completedAt) >= Date.parse(item.startsAt as string)
      : item.completedAt === undefined;
  return (
    oneOf(item.kind, ['first', 'followup', 'contract']) &&
    timestamp(item.startsAt) &&
    timestamp(item.endsAt) &&
    Date.parse(item.endsAt as string) > Date.parse(item.startsAt as string) &&
    boundedName(item.location, FLOW_FIELD_LIMITS.meetingLocation) &&
    oneOf(item.attendance, ['both', 'partner', 'admin']) &&
    oneOf(item.status, ['scheduled', 'completed', 'cancelled']) &&
    boundedText(item.note, FLOW_FIELD_LIMITS.meetingNote) &&
    boundedName(item.createdBy, FLOW_FIELD_LIMITS.actor) &&
    validStatusTime
  );
}

function validRecording(item: JsonRecord, projected: boolean) {
  if (projected) return true;
  return (
    named(item.meetingId) &&
    ['fileId', 'transcriptFileId', 'audioFileId', 'transcriptReviewedBy'].every(
      (key) => optionalText(item[key]),
    ) &&
    boundedText(item.transcript, FLOW_TEXT_LIMITS.transcript) &&
    optionalTimestamp(item.transcriptReviewedAt) &&
    timestamp(item.consentAt) &&
    timestamp(item.createdAt)
  );
}

function validRequest(item: JsonRecord) {
  if (
    !boundedName(item.title, FLOW_FIELD_LIMITS.requestTitle) ||
    typeof item.required !== 'boolean' ||
    !oneOf(item.channel, ['카카오톡', '이메일', '기타']) ||
    !boundedName(item.recipient, FLOW_FIELD_LIMITS.requestRecipient) ||
    !(item.dueDate === '' || calendarDate(item.dueDate)) ||
    !oneOf(item.status, ['requested', 'received', 'verified', 'needs_fix']) ||
    !optionalText(item.fileId) ||
    !boundedText(item.note, FLOW_FIELD_LIMITS.requestNote) ||
    !timestamp(item.createdAt) ||
    !['sentAt', 'receivedAt', 'reviewedAt', 'verifiedAt'].every((key) =>
      optionalTimestamp(item[key]),
    )
  )
    return false;
  const fileId = reference(item.fileId);
  const receivedAt = reference(item.receivedAt);
  const reviewedAt = reference(item.reviewedAt);
  const verifiedAt = reference(item.verifiedAt);
  const statusEvidence =
    item.status === 'requested'
      ? !fileId && !receivedAt && !reviewedAt && !verifiedAt
      : item.status === 'received'
        ? fileId && receivedAt && !reviewedAt && !verifiedAt
        : item.status === 'needs_fix'
          ? fileId && receivedAt && reviewedAt && !verifiedAt
          : fileId && receivedAt && reviewedAt && verifiedAt;
  const timeline = [
    item.createdAt as string,
    reference(item.sentAt),
    receivedAt,
    reviewedAt,
    verifiedAt,
  ].filter((value): value is string => Boolean(value));
  return Boolean(
    statusEvidence &&
    timeline.every(
      (value, index) =>
        index === 0 || Date.parse(value) >= Date.parse(timeline[index - 1]),
    ),
  );
}

function validPayment(item: JsonRecord) {
  return (
    safeInteger(item.amountWon, 1) &&
    (item.amountWon as number) <= 1_000_000_000_000 &&
    calendarDate(item.receivedAt) &&
    boundedName(item.reference, FLOW_FIELD_LIMITS.paymentReference) &&
    boundedName(item.confirmedBy, FLOW_FIELD_LIMITS.actor) &&
    timestamp(item.recordedAt)
  );
}

function validJob(item: JsonRecord) {
  if (
    !oneOf(item.stage, [1, 4]) ||
    !oneOf(item.status, [
      'queued',
      'processing',
      'blocked',
      'failed',
      'complete',
    ]) ||
    !boundedText(item.reason, FLOW_TEXT_LIMITS.jobReason) ||
    !timestamp(item.createdAt) ||
    !['sourceRecordingId', 'sourceReportId', 'reportId'].every((key) =>
      optionalText(item[key]),
    ) ||
    !optionalTimestamp(item.startedAt) ||
    !optionalTimestamp(item.completedAt)
  )
    return false;
  const startedAt = reference(item.startedAt);
  const completedAt = reference(item.completedAt);
  const reportId = reference(item.reportId);
  const statusEvidence =
    item.status === 'queued'
      ? !startedAt && !completedAt && !reportId
      : item.status === 'processing'
        ? startedAt && !completedAt && !reportId
        : item.status === 'complete'
          ? startedAt && completedAt && reportId
          : item.status === 'failed'
            ? startedAt && !completedAt && !reportId
            : !completedAt && !reportId;
  return Boolean(
    statusEvidence &&
    (!startedAt ||
      Date.parse(startedAt) >= Date.parse(item.createdAt as string)) &&
    (!completedAt ||
      (startedAt && Date.parse(completedAt) >= Date.parse(startedAt))),
  );
}

function validAudit(item: JsonRecord) {
  return (
    timestamp(item.at) &&
    boundedName(item.actor, FLOW_FIELD_LIMITS.actor) &&
    boundedName(item.action, FLOW_FIELD_LIMITS.auditAction) &&
    boundedName(item.detail, FLOW_TEXT_LIMITS.auditDetail)
  );
}

function validAnalysis(value: unknown) {
  const analysis = asRecord(value);
  return Boolean(
    analysis &&
    boundedText(analysis.reportId, FLOW_FIELD_LIMITS.id) &&
    optionalTimestamp(analysis.adminAt) &&
    optionalTimestamp(analysis.partnerAt),
  );
}

function validAi(value: unknown, projected: boolean) {
  const ai = asRecord(value);
  return Boolean(
    ai &&
    typeof ai.enabled === 'boolean' &&
    (projected || boundedText(ai.sourceText, FLOW_TEXT_LIMITS.aiSourceText)) &&
    optionalTimestamp(ai.approvedAt) &&
    optionalText(ai.approvedBy, FLOW_FIELD_LIMITS.id),
  );
}

function validDecision(value: unknown) {
  if (value === undefined) return true;
  const item = asRecord(value);
  return Boolean(
    item &&
    boundedName(item.id, FLOW_FIELD_LIMITS.id) &&
    boundedName(item.reportId, FLOW_FIELD_LIMITS.id) &&
    Array.isArray(item.solutions) &&
    item.solutions.length <= FLOW_FIELD_LIMITS.decisionSolutionCount &&
    item.solutions.every((solution) =>
      boundedName(solution, FLOW_FIELD_LIMITS.decisionSolution),
    ) &&
    boundedText(item.note, FLOW_FIELD_LIMITS.decisionNote) &&
    typeof item.documentsNeeded === 'boolean' &&
    timestamp(item.at),
  );
}

function validContract(value: unknown) {
  if (value === undefined) return true;
  const item = asRecord(value);
  return Boolean(
    item &&
    boundedName(item.meetingId, FLOW_FIELD_LIMITS.id) &&
    boundedName(item.reportId, FLOW_FIELD_LIMITS.id) &&
    boundedName(item.signedFileId, FLOW_FIELD_LIMITS.id) &&
    calendarDate(item.signedAt) &&
    safeInteger(item.expectedDepositWon, 1) &&
    (item.expectedDepositWon as number) <= 1_000_000_000_000 &&
    boundedName(item.recordedBy, FLOW_FIELD_LIMITS.actor),
  );
}

function validAftercare(value: unknown) {
  if (value === undefined) return true;
  const item = asRecord(value);
  return Boolean(
    item &&
    timestamp(item.at) &&
    boundedName(item.summary, FLOW_FIELD_LIMITS.aftercareSummary) &&
    calendarDate(item.nextDate) &&
    boundedName(item.owner, FLOW_FIELD_LIMITS.aftercareOwner),
  );
}

function validReceipts(value: unknown) {
  if (value === undefined) return true;
  const receipts = asRecord(value);
  return Boolean(
    receipts &&
    Object.keys(receipts).length <= FLOW_COLLECTION_LIMITS.commandReceipts &&
    Object.entries(receipts).every(([key, entry]) => {
      const receipt = asRecord(entry);
      return (
        boundedName(key, FLOW_FIELD_LIMITS.id) &&
        receipt &&
        boundedName(receipt.actorKey, FLOW_FIELD_LIMITS.receiptActorKey) &&
        boundedName(receipt.fingerprint, FLOW_FIELD_LIMITS.receiptFingerprint)
      );
    }),
  );
}

function reference(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function hasReferenceIntegrity(flow: JsonRecord, mode: ShapeMode) {
  const reports = flow.reports as Array<JsonRecord>;
  const meetings = flow.meetings as Array<JsonRecord>;
  const recordings = flow.recordings as Array<JsonRecord>;
  const reportById = new Map(reports.map((item) => [item.id as string, item]));
  const meetingById = new Map(
    meetings.map((item) => [item.id as string, item]),
  );
  const recordingIds = new Set(recordings.map((item) => item.id as string));
  const analysis = flow.analysis as JsonRecord;
  const decision = flow.decision as JsonRecord | undefined;
  const contract = flow.contract as JsonRecord | undefined;
  const analysisReport = reference(analysis.reportId);
  if (analysisReport && reportById.get(analysisReport)?.stage !== 1)
    return false;
  if (
    !reports.every((item) => {
      const sourceReportId = reference(item.sourceReportId);
      const sourceRecordingId = reference(item.sourceRecordingId);
      const decisionId = reference(item.decisionId);
      return (
        (!sourceReportId || reportById.get(sourceReportId)?.stage === 1) &&
        (!sourceRecordingId || recordingIds.has(sourceRecordingId)) &&
        (!decisionId || decision?.id === decisionId)
      );
    })
  )
    return false;
  if (decision && reportById.get(decision.reportId as string)?.stage !== 4)
    return false;
  if (
    contract &&
    (meetingById.get(contract.meetingId as string)?.kind !== 'contract' ||
      reportById.get(contract.reportId as string)?.stage !== 6)
  )
    return false;
  if (mode === 'projected') return true;

  const files = flow.files as Array<JsonRecord>;
  const fileIds = new Set(files.map((item) => item.id as string));
  if (
    !reports.every((item) => {
      const fileId = reference(item.fileId);
      return !fileId || fileIds.has(fileId);
    }) ||
    !recordings.every((item) => {
      const fileReferences = ['fileId', 'transcriptFileId', 'audioFileId']
        .map((key) => reference(item[key]))
        .filter((item): item is string => Boolean(item));
      return (
        meetingById.has(item.meetingId as string) &&
        fileReferences.every((id) => fileIds.has(id))
      );
    }) ||
    !(flow.requests as Array<JsonRecord>).every((item) => {
      const fileId = reference(item.fileId);
      return !fileId || fileIds.has(fileId);
    }) ||
    (contract && !fileIds.has(contract.signedFileId as string))
  )
    return false;

  if (
    !(flow.jobs as Array<JsonRecord>).every((item) => {
      const sourceRecordingId = reference(item.sourceRecordingId);
      const sourceReportId = reference(item.sourceReportId);
      const reportId = reference(item.reportId);
      return (
        (!sourceRecordingId || recordingIds.has(sourceRecordingId)) &&
        (!sourceReportId || reportById.get(sourceReportId)?.stage === 1) &&
        (!reportId || reportById.get(reportId)?.stage === item.stage)
      );
    })
  )
    return false;
  const commandIds = new Set(flow.commandIds as string[]);
  return Object.keys(
    (flow.commandReceipts as JsonRecord | undefined) ?? {},
  ).every((id) => commandIds.has(id));
}

function koreanDate(value: string) {
  return new Date(Date.parse(value) + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function hasStateIntegrity(flow: JsonRecord, mode: ShapeMode) {
  const meetings = flow.meetings as Array<JsonRecord>;
  const contract = flow.contract as JsonRecord | undefined;
  const payments = flow.payments as Array<JsonRecord>;
  const executionStartedAt = reference(flow.executionStartedAt);
  const aftercare = flow.aftercare as JsonRecord | undefined;
  if (
    contract &&
    meetings.find((item) => item.id === contract.meetingId)?.status !==
      'completed'
  )
    return false;
  if (
    payments.some(
      (item) =>
        !contract ||
        (item.receivedAt as string) > koreanDate(item.recordedAt as string),
    )
  )
    return false;
  const paid = payments.reduce(
    (total, item) => total + (item.amountWon as number),
    0,
  );
  const depositComplete = Boolean(
    contract && paid >= (contract.expectedDepositWon as number),
  );
  if (Boolean(executionStartedAt) !== depositComplete) return false;
  if (
    aftercare &&
    (!executionStartedAt ||
      Date.parse(aftercare.at as string) < Date.parse(executionStartedAt))
  )
    return false;
  if (mode === 'projected' || !contract) return true;
  const signedFile = (flow.files as Array<JsonRecord>).find(
    (item) => item.id === contract.signedFileId,
  );
  return signedFile?.purpose === 'signed_contract';
}

function hasBaseStructure(value: unknown, mode: ShapeMode) {
  const flow = asRecord(value);
  if (!flow) return false;
  const projected = mode === 'projected';
  const stored = mode === 'stored';
  const requiredStrings = ['caseId', 'partnerId'];
  const valid =
    flow.schemaVersion === 1 &&
    requiredStrings.every((key) =>
      boundedName(flow[key], FLOW_FIELD_LIMITS.id),
    ) &&
    boundedName(flow.company, FLOW_FIELD_LIMITS.company) &&
    boundedName(flow.partnerName, FLOW_FIELD_LIMITS.partnerName) &&
    boundedText(flow.updatedAt, FLOW_FIELD_LIMITS.timestamp) &&
    safeInteger(flow.revision) &&
    validItems(flow.reports, FLOW_COLLECTION_LIMITS.reports, (item) =>
      validReport(item, projected),
    ) &&
    (projected ||
      validItems(flow.files, FLOW_COLLECTION_LIMITS.files, (item) =>
        validFile(item, stored),
      )) &&
    validAnalysis(flow.analysis) &&
    validItems(flow.meetings, FLOW_COLLECTION_LIMITS.meetings, validMeeting) &&
    validItems(flow.recordings, FLOW_COLLECTION_LIMITS.recordings, (item) =>
      validRecording(item, projected),
    ) &&
    validItems(flow.requests, FLOW_COLLECTION_LIMITS.requests, validRequest) &&
    validDecision(flow.decision) &&
    validContract(flow.contract) &&
    validItems(flow.payments, FLOW_COLLECTION_LIMITS.payments, validPayment) &&
    (flow.executionStartedAt === undefined ||
      timestamp(flow.executionStartedAt)) &&
    validAftercare(flow.aftercare) &&
    validAi(flow.ai, projected) &&
    (projected ||
      validItems(flow.jobs, FLOW_COLLECTION_LIMITS.jobs, validJob)) &&
    (projected ||
      validItems(flow.audit, FLOW_COLLECTION_LIMITS.audit, validAudit)) &&
    (projected ||
      (Array.isArray(flow.commandIds) &&
        flow.commandIds.length <= FLOW_COLLECTION_LIMITS.commandIds &&
        flow.commandIds.every((id) => boundedName(id, FLOW_FIELD_LIMITS.id)) &&
        new Set(flow.commandIds).size === flow.commandIds.length)) &&
    (projected || validReceipts(flow.commandReceipts));
  return (
    valid && hasReferenceIntegrity(flow, mode) && hasStateIntegrity(flow, mode)
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
