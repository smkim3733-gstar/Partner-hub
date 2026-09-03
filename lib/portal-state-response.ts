import type { ApplicationConsultationSummary } from '@/lib/application-consultation-metrics';
import type { DocumentReviewWaitSummary } from '@/lib/document-review-wait-metrics';
import type { DuplicateRequestSummary } from '@/lib/duplicate-request-metrics';
import type { JointAnalysisConfirmationSummary } from '@/lib/joint-analysis-confirmation-metrics';
import type { PasswordLinkSummary } from '@/lib/password-link-metrics';
import type { PipelineDropoffSummary } from '@/lib/pipeline-dropoff-metrics';
import type { PortalUser } from '@/lib/portal-auth';
import type { PortalSaveConflictSummary } from '@/lib/portal-conflict-metrics';
import {
  isPortalStorageTelemetry,
  type PortalStorageTelemetry,
} from '@/lib/pilot-readiness';
import type { SupportRequestSummary } from '@/lib/support-request-metrics';

type JsonObject = Record<string, unknown>;

export type PortalStateReadPayload<TState> = {
  state: TState | null;
  currentUser: PortalUser;
  stateRevision: string;
  storage: PortalStorageTelemetry | null;
  saveConflicts: PortalSaveConflictSummary | null;
  passwordLinks: PasswordLinkSummary | null;
  applicationFunnel: ApplicationConsultationSummary | null;
  duplicateRequests: DuplicateRequestSummary | null;
  jointAnalysisConfirmation: JointAnalysisConfirmationSummary | null;
  documentReviewWait: DocumentReviewWaitSummary | null;
  supportRequests: SupportRequestSummary | null;
  pipelineDropoff: PipelineDropoffSummary | null;
};

export class PortalStateResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'PortalStateResponseError';
  }
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function count(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function number(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function hasNumbers(value: unknown, keys: readonly string[]) {
  const record = asObject(value);
  return Boolean(record && keys.every((key) => count(record[key])));
}

function optionalBuckets(value: unknown, keys: readonly string[]) {
  return value === null || hasNumbers(value, keys);
}

const fourHourBucketKeys = [
  'under4Hours',
  'fourTo24Hours',
  'oneTo3Days',
  'threeDaysOrMore',
] as const;
const duplicateSources = [
  'flow_command',
  'file_upload',
  'admin_partner_registration',
] as const;
const duplicateOutcomes = [
  'safe_retry',
  'request_key_conflict',
  'existing_record_blocked',
  'unkeyed_request',
] as const;
const conflictSources = [
  'state_save',
  'public_registration',
  'admin_partner_registration',
] as const;
const conflictKinds = [
  'member_revision',
  'state_revision',
  'recovery_proof',
  'cas_exhausted',
  'other',
] as const;
const conflictRoles = ['admin', 'partner', 'unauthenticated'] as const;
const pipelineStages = [
  '접수',
  '기업진단',
  '상담예약',
  '상담진행',
  '계약',
  '컨설팅수행',
  '사후관리',
] as const;

function allowed(value: unknown, values: readonly string[]) {
  return typeof value === 'string' && values.includes(value);
}

function isPortalUser(value: unknown): value is PortalUser {
  const user = asObject(value);
  if (
    !user ||
    !nonEmptyString(user.id) ||
    !nonEmptyString(user.email) ||
    !nonEmptyString(user.displayName) ||
    (user.role !== 'admin' && user.role !== 'trainee') ||
    (user.authMethod !== undefined &&
      user.authMethod !== 'password' &&
      user.authMethod !== 'chatgpt')
  )
    return false;
  if (user.role === 'admin')
    return (
      user.memberId === null &&
      user.memberName === null &&
      user.permissions === null
    );
  const permissions = asObject(user.permissions);
  return (
    nonEmptyString(user.memberId) &&
    nonEmptyString(user.memberName) &&
    Boolean(
      permissions &&
        [
          'sharedSchedule',
          'collaborationApply',
          'ownCases',
          'fileUpload',
          'quoteContract',
        ].every((key) => typeof permissions[key] === 'boolean'),
    )
  );
}

function isPasswordLinks(value: unknown): value is PasswordLinkSummary {
  return hasNumbers(value, [
    'windowDays',
    'issued',
    'activeReplacements',
    'expiredAtReissue',
    'redeemed',
    'observedExpiredAttempts',
  ]);
}

function isApplicationFunnel(
  value: unknown,
): value is ApplicationConsultationSummary {
  const summary = asObject(value);
  return Boolean(
    summary &&
      hasNumbers(summary, [
        'trackedApplications',
        'flowStarted',
        'firstConsultationsCompleted',
        'flowPending',
        'legacyConsultationsUnmeasurable',
        'flowNotStarted',
        'invalidCompletionTimes',
        'durationDisclosureThreshold',
      ]) &&
      number(summary.completionRatePercent) &&
      optionalBuckets(summary.durationBuckets, [
        'under1Day',
        'oneTo3Days',
        'threeTo7Days',
        'sevenDaysOrMore',
      ]),
  );
}

function isDuplicateRequests(value: unknown): value is DuplicateRequestSummary {
  const summary = asObject(value);
  return Boolean(
    summary &&
      hasNumbers(summary, [
        'windowDays',
        'totalSafeRetries',
        'totalRequestKeyConflicts',
        'totalExistingRecordBlocks',
        'unkeyedUploadRequests',
      ]) &&
      Array.isArray(summary.rows) &&
      summary.rows.every((item) => {
        const row = asObject(item);
        return Boolean(
          row &&
            allowed(row.source, duplicateSources) &&
            allowed(row.outcome, duplicateOutcomes) &&
            count(row.count),
        );
      }),
  );
}

function isJointAnalysis(
  value: unknown,
): value is JointAnalysisConfirmationSummary {
  const summary = asObject(value);
  return Boolean(
    summary &&
      hasNumbers(summary, [
        'flowsWithFirstReport',
        'eligibleJointAnalyses',
        'currentReportMismatches',
        'awaitingBoth',
        'partnerFirstPending',
        'ownerFirstPending',
        'partnerFirstCompleted',
        'ownerFirstCompleted',
        'invalidTimestamps',
        'durationDisclosureThreshold',
      ]) &&
      optionalBuckets(summary.durationBuckets, fourHourBucketKeys),
  );
}

function isDocumentReview(
  value: unknown,
): value is DocumentReviewWaitSummary {
  const summary = asObject(value);
  return Boolean(
    summary &&
      hasNumbers(summary, [
        'requestsCreated',
        'awaitingReceipt',
        'pendingReview',
        'reviewed',
        'approvedReviews',
        'needsFixReviews',
        'legacyUnmeasurable',
        'invalidTransitions',
        'durationDisclosureThreshold',
      ]) &&
      optionalBuckets(summary.completedDurationBuckets, fourHourBucketKeys) &&
      optionalBuckets(summary.pendingAgeBuckets, fourHourBucketKeys),
  );
}

function isSupportRequests(value: unknown): value is SupportRequestSummary {
  const summary = asObject(value);
  return Boolean(
    summary &&
      hasNumbers(summary, [
        'trackedRequests',
        'partnerSelfService',
        'adminLogged',
        'waitingForAcknowledgement',
        'acknowledgedOpen',
        'adminResolved',
        'requesterClosed',
        'reopenedCurrentCycles',
        'legacyUnmeasurable',
        'invalidTransitions',
        'durationDisclosureThreshold',
      ]) &&
      hasNumbers(summary.byCategory, [
        'account_access',
        'save_sync',
        'files_documents',
        'consulting_flow',
        'other',
      ]) &&
      optionalBuckets(summary.responseTimeBuckets, fourHourBucketKeys) &&
      optionalBuckets(summary.adminHandlingTimeBuckets, fourHourBucketKeys) &&
      optionalBuckets(summary.unacknowledgedAgeBuckets, fourHourBucketKeys),
  );
}

function isPipeline(value: unknown): value is PipelineDropoffSummary {
  const summary = asObject(value);
  const isGroup = (candidate: unknown) => {
    const group = asObject(candidate);
    return Boolean(
      group &&
        count(group.cases) &&
        Array.isArray(group.stages) &&
        group.stages.every((item) => {
          const stage = asObject(item);
          return Boolean(
            stage &&
              allowed(stage.stage, pipelineStages) &&
              count(stage.reached) &&
              count(stage.discontinued) &&
              (stage.discontinuationRatePercent === null ||
                number(stage.discontinuationRatePercent)),
          );
        }),
    );
  };
  return Boolean(
    summary &&
      hasNumbers(summary, [
        'trackedCases',
        'activeCases',
        'discontinuedCases',
        'reopenedCases',
        'reachedAftercare',
        'legacyUnmeasurable',
        'invalidStates',
      ]) &&
      (summary.observationStatus === 'no_discontinuations_observed' ||
        summary.observationStatus === 'observed') &&
      isGroup(summary.flowVerified) &&
      isGroup(summary.manualReported),
  );
}

function isSaveConflicts(value: unknown): value is PortalSaveConflictSummary {
  const summary = asObject(value);
  const recovery = summary ? asObject(summary.recovery) : null;
  return Boolean(
    summary &&
      count(summary.windowDays) &&
      count(summary.total) &&
      (summary.lastConflictAt === null ||
        typeof summary.lastConflictAt === 'string') &&
      Array.isArray(summary.rows) &&
      summary.rows.every((item) => {
        const row = asObject(item);
        return Boolean(
          row &&
            nonEmptyString(row.date) &&
            allowed(row.source, conflictSources) &&
            allowed(row.kind, conflictKinds) &&
            allowed(row.actorRole, conflictRoles) &&
            count(row.count) &&
            nonEmptyString(row.lastConflictAt),
        );
      }) &&
      recovery &&
      count(recovery.disclosureThreshold) &&
      Array.isArray(recovery.rows) &&
      recovery.rows.every((item) => {
        const row = asObject(item);
        return Boolean(
          row &&
            allowed(row.source, conflictSources) &&
            allowed(row.kind, conflictKinds) &&
            allowed(row.actorRole, conflictRoles) &&
            (row.clientCoverage === 'in_memory_ui' ||
              row.clientCoverage === 'api_response_only') &&
            count(row.issued) &&
            count(row.recovered) &&
            number(row.recoveryRatePercent) &&
            optionalBuckets(row.durationBuckets, [
              'under1Minute',
              'oneTo5Minutes',
              'fiveTo30Minutes',
              'thirtyMinutesTo2Hours',
              'twoTo24Hours',
            ]),
        );
      }),
  );
}

function optional<T>(value: unknown, validator: (value: unknown) => value is T) {
  return validator(value) ? value : null;
}

function failureMessage(payload: JsonObject | null, status: number) {
  if (payload && nonEmptyString(payload.error)) return payload.error as string;
  return status === 401 || status === 403
    ? '로그인 정보를 확인하지 못했습니다.'
    : '운영 정보를 불러오지 못했습니다.';
}

export async function readPortalStateResponse<TState>(
  response: Response,
  isState: (value: unknown) => value is TState,
): Promise<PortalStateReadPayload<TState>> {
  let rawPayload: unknown;
  try {
    rawPayload = await response.json();
  } catch {
    throw new PortalStateResponseError(
      failureMessage(null, response.status),
      response.status,
    );
  }
  const payload = asObject(rawPayload);
  if (!response.ok)
    throw new PortalStateResponseError(
      failureMessage(payload, response.status),
      response.status,
    );
  if (
    !payload ||
    !Object.hasOwn(payload, 'state') ||
    (payload.state !== null && !isState(payload.state)) ||
    !isPortalUser(payload.currentUser) ||
    !nonEmptyString(payload.stateRevision)
  )
    throw new PortalStateResponseError(
      '포털 응답 형식이 올바르지 않습니다. 다시 확인해 주세요.',
      response.status,
    );

  return {
    state: payload.state as TState | null,
    currentUser: payload.currentUser,
    stateRevision: payload.stateRevision as string,
    storage: optional(payload.storage, isPortalStorageTelemetry),
    saveConflicts: optional(payload.saveConflicts, isSaveConflicts),
    passwordLinks: optional(payload.passwordLinks, isPasswordLinks),
    applicationFunnel: optional(payload.applicationFunnel, isApplicationFunnel),
    duplicateRequests: optional(payload.duplicateRequests, isDuplicateRequests),
    jointAnalysisConfirmation: optional(
      payload.jointAnalysisConfirmation,
      isJointAnalysis,
    ),
    documentReviewWait: optional(payload.documentReviewWait, isDocumentReview),
    supportRequests: optional(payload.supportRequests, isSupportRequests),
    pipelineDropoff: optional(payload.pipelineDropoff, isPipeline),
  };
}
