import { flowDatabase } from '@/lib/consulting-flow-store';
import { operationalPilotRecords } from '@/lib/pilot-readiness';

const SUBMISSION_TRACKING_VERSION = 1;
const DURATION_DISCLOSURE_THRESHOLD = 5;

type CaseRecord = Record<string, unknown> & { id?: unknown };
type FlowMetricRow = {
  case_id: string;
  first_completed_at: string | null;
};

export type ApplicationConsultationSummary = {
  trackedApplications: number;
  flowStarted: number;
  firstConsultationsCompleted: number;
  flowPending: number;
  legacyConsultationsUnmeasurable: number;
  flowNotStarted: number;
  invalidCompletionTimes: number;
  completionRatePercent: number;
  durationDisclosureThreshold: number;
  durationBuckets: {
    under1Day: number;
    oneTo3Days: number;
    threeTo7Days: number;
    sevenDaysOrMore: number;
  } | null;
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

function trackedSubmission(caseRecord: CaseRecord) {
  return (
    caseRecord.submissionTrackingVersion === SUBMISSION_TRACKING_VERSION &&
    serverTimestamp(caseRecord.submittedAt)
  );
}

/**
 * Remove client-owned submission times from every case. Restore an existing
 * server stamp, or create one only for the exact draft-authorized new case.
 */
export function protectApplicationSubmissionTimes(
  currentState: unknown,
  nextState: Record<string, unknown>,
  authorizedCaseId: string | null,
  now = new Date().toISOString(),
): Record<string, unknown> {
  if (!serverTimestamp(now))
    throw new Error('Invalid application submission timestamp.');
  const storedById = new Map(
    casesOf(currentState)
      .filter((item) => typeof item.id === 'string')
      .map((item) => [item.id as string, item]),
  );
  return {
    ...nextState,
    cases: casesOf(nextState).map((incoming) => {
      const {
        submittedAt: _clientSubmittedAt,
        submissionTrackingVersion: _clientTrackingVersion,
        ...rest
      } = incoming;
      const id = typeof incoming.id === 'string' ? incoming.id : '';
      const stored = storedById.get(id);
      if (stored) {
        return trackedSubmission(stored)
          ? {
              ...rest,
              submittedAt: stored.submittedAt,
              submissionTrackingVersion: SUBMISSION_TRACKING_VERSION,
            }
          : rest;
      }
      return id === authorizedCaseId && id.startsWith('case-draft-')
        ? {
            ...rest,
            submittedAt: now,
            submissionTrackingVersion: SUBMISSION_TRACKING_VERSION,
          }
        : rest;
    }),
  };
}

function hasLegacyConsultationEvidence(caseRecord: CaseRecord) {
  if (Number(caseRecord.consultationCount) > 0) return true;
  const stage = typeof caseRecord.stage === 'string' ? caseRecord.stage : '';
  return ['상담진행', '계약', '컨설팅수행', '사후관리'].includes(stage);
}

function durationBucket(elapsedMs: number) {
  if (elapsedMs < 24 * 60 * 60 * 1000) return 'under1Day' as const;
  if (elapsedMs < 3 * 24 * 60 * 60 * 1000) return 'oneTo3Days' as const;
  if (elapsedMs < 7 * 24 * 60 * 60 * 1000) return 'threeTo7Days' as const;
  return 'sevenDaysOrMore' as const;
}

export async function readApplicationConsultationSummary(
  state: unknown,
): Promise<ApplicationConsultationSummary> {
  const tracked = operationalPilotRecords('case', casesOf(state)).filter(
    trackedSubmission,
  );
  const rows = await (
    await flowDatabase()
  )
    .prepare(`
      SELECT f.case_id,
        (SELECT MIN(json_extract(m.value, '$.completedAt'))
         FROM json_each(f.payload, '$.meetings') m
         WHERE json_extract(m.value, '$.kind') = 'first'
           AND json_extract(m.value, '$.status') = 'completed'
           AND json_type(m.value, '$.completedAt') = 'text') AS first_completed_at
      FROM consulting_flows f
    `)
    .all<FlowMetricRow>();
  const flowByCase = new Map(rows.results.map((row) => [row.case_id, row]));
  let flowStarted = 0;
  let firstConsultationsCompleted = 0;
  let flowPending = 0;
  let legacyConsultationsUnmeasurable = 0;
  let invalidCompletionTimes = 0;
  let validCompletionDurations = 0;
  const durationBuckets = {
    under1Day: 0,
    oneTo3Days: 0,
    threeTo7Days: 0,
    sevenDaysOrMore: 0,
  };

  for (const caseRecord of tracked) {
    const id = typeof caseRecord.id === 'string' ? caseRecord.id : '';
    const flow = flowByCase.get(id);
    if (!flow) {
      if (hasLegacyConsultationEvidence(caseRecord))
        legacyConsultationsUnmeasurable++;
      continue;
    }
    flowStarted++;
    if (!flow.first_completed_at) {
      flowPending++;
      continue;
    }
    firstConsultationsCompleted++;
    const submittedTime = Date.parse(caseRecord.submittedAt as string);
    const completedTime = Date.parse(flow.first_completed_at);
    if (!Number.isFinite(completedTime) || completedTime < submittedTime) {
      invalidCompletionTimes++;
      continue;
    }
    validCompletionDurations++;
    durationBuckets[durationBucket(completedTime - submittedTime)]++;
  }

  return {
    trackedApplications: tracked.length,
    flowStarted,
    firstConsultationsCompleted,
    flowPending,
    legacyConsultationsUnmeasurable,
    flowNotStarted:
      tracked.length - flowStarted - legacyConsultationsUnmeasurable,
    invalidCompletionTimes,
    completionRatePercent:
      flowStarted > 0
        ? Math.round((firstConsultationsCompleted / flowStarted) * 1000) / 10
        : 0,
    durationDisclosureThreshold: DURATION_DISCLOSURE_THRESHOLD,
    durationBuckets:
      validCompletionDurations >= DURATION_DISCLOSURE_THRESHOLD
        ? durationBuckets
        : null,
  };
}
