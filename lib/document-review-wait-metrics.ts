import {
  readConsultingFlowMetricRows,
  type ConsultingFlowMetricRow,
} from '@/lib/consulting-flow-metrics';
import { operationalPilotRecords } from '@/lib/pilot-readiness';

const DURATION_DISCLOSURE_THRESHOLD = 5;

type CaseRecord = Record<string, unknown> & { id?: unknown };
type RequestMetric = {
  status?: unknown;
  hasFile?: unknown;
  receivedAt?: unknown;
  reviewedAt?: unknown;
};
type DurationBuckets = {
  under4Hours: number;
  fourTo24Hours: number;
  oneTo3Days: number;
  threeDaysOrMore: number;
};

export type DocumentReviewWaitSummary = {
  requestsCreated: number;
  awaitingReceipt: number;
  pendingReview: number;
  reviewed: number;
  approvedReviews: number;
  needsFixReviews: number;
  legacyUnmeasurable: number;
  invalidTransitions: number;
  durationDisclosureThreshold: number;
  completedDurationBuckets: DurationBuckets | null;
  pendingAgeBuckets: DurationBuckets | null;
};

function casesOf(value: unknown): CaseRecord[] {
  if (!value || typeof value !== 'object') return [];
  const cases = (value as { cases?: unknown }).cases;
  return Array.isArray(cases)
    ? cases.filter(
        (item): item is CaseRecord =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}

function serverTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function requestMetrics(value: unknown): RequestMetric[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is RequestMetric =>
            Boolean(item) && typeof item === 'object' && !Array.isArray(item),
        )
      : [];
  } catch {
    return [];
  }
}

function emptyBuckets(): DurationBuckets {
  return {
    under4Hours: 0,
    fourTo24Hours: 0,
    oneTo3Days: 0,
    threeDaysOrMore: 0,
  };
}

function durationBucket(elapsedMs: number) {
  if (elapsedMs < 4 * 60 * 60 * 1000) return 'under4Hours' as const;
  if (elapsedMs < 24 * 60 * 60 * 1000) return 'fourTo24Hours' as const;
  if (elapsedMs < 3 * 24 * 60 * 60 * 1000) return 'oneTo3Days' as const;
  return 'threeDaysOrMore' as const;
}

export async function readDocumentReviewWaitSummary(
  state: unknown,
  suppliedRows?: ConsultingFlowMetricRow[],
  now = new Date().toISOString(),
): Promise<DocumentReviewWaitSummary> {
  if (!serverTimestamp(now)) throw new Error('Invalid metric request time.');
  const operationalCaseIds = new Set(
    operationalPilotRecords('case', casesOf(state))
      .map((item) => item.id)
      .filter((id): id is string => typeof id === 'string'),
  );
  const rows = suppliedRows ?? (await readConsultingFlowMetricRows());
  let requestsCreated = 0;
  let awaitingReceipt = 0;
  let pendingReview = 0;
  let reviewed = 0;
  let approvedReviews = 0;
  let needsFixReviews = 0;
  let legacyUnmeasurable = 0;
  let invalidTransitions = 0;
  let validCompletedDurations = 0;
  let validPendingAges = 0;
  const completedDurationBuckets = emptyBuckets();
  const pendingAgeBuckets = emptyBuckets();
  const nowTime = Date.parse(now);

  for (const row of rows) {
    if (!operationalCaseIds.has(row.case_id)) continue;
    for (const request of requestMetrics(row.request_metrics_json)) {
      requestsCreated++;
      const status = request.status;
      const hasFile = request.hasFile === 1 || request.hasFile === true;
      const hasReceivedAt =
        request.receivedAt !== null &&
        request.receivedAt !== undefined &&
        request.receivedAt !== '';
      const hasReviewedAt =
        request.reviewedAt !== null &&
        request.reviewedAt !== undefined &&
        request.reviewedAt !== '';

      if (
        status === 'requested' &&
        !hasFile &&
        !hasReceivedAt &&
        !hasReviewedAt
      ) {
        awaitingReceipt++;
        continue;
      }
      if (
        ['received', 'verified', 'needs_fix'].includes(String(status)) &&
        hasFile &&
        !hasReceivedAt
      ) {
        legacyUnmeasurable++;
        continue;
      }
      if (
        status === 'received' &&
        hasFile &&
        serverTimestamp(request.receivedAt) &&
        !hasReviewedAt
      ) {
        const receivedTime = Date.parse(request.receivedAt);
        if (receivedTime > nowTime) {
          invalidTransitions++;
          continue;
        }
        pendingReview++;
        validPendingAges++;
        pendingAgeBuckets[durationBucket(nowTime - receivedTime)]++;
        continue;
      }
      if (
        (status === 'verified' || status === 'needs_fix') &&
        hasFile &&
        serverTimestamp(request.receivedAt) &&
        serverTimestamp(request.reviewedAt)
      ) {
        const receivedTime = Date.parse(request.receivedAt);
        const reviewedTime = Date.parse(request.reviewedAt);
        if (reviewedTime < receivedTime || reviewedTime > nowTime) {
          invalidTransitions++;
          continue;
        }
        reviewed++;
        if (status === 'verified') approvedReviews++;
        else needsFixReviews++;
        validCompletedDurations++;
        completedDurationBuckets[durationBucket(reviewedTime - receivedTime)]++;
        continue;
      }
      invalidTransitions++;
    }
  }

  return {
    requestsCreated,
    awaitingReceipt,
    pendingReview,
    reviewed,
    approvedReviews,
    needsFixReviews,
    legacyUnmeasurable,
    invalidTransitions,
    durationDisclosureThreshold: DURATION_DISCLOSURE_THRESHOLD,
    completedDurationBuckets:
      validCompletedDurations >= DURATION_DISCLOSURE_THRESHOLD
        ? completedDurationBuckets
        : null,
    pendingAgeBuckets:
      validPendingAges >= DURATION_DISCLOSURE_THRESHOLD
        ? pendingAgeBuckets
        : null,
  };
}
