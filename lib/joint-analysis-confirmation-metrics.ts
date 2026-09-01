import {
  readConsultingFlowMetricRows,
  type ConsultingFlowMetricRow,
} from '@/lib/consulting-flow-metrics';
import { operationalPilotRecords } from '@/lib/pilot-readiness';

const DURATION_DISCLOSURE_THRESHOLD = 5;

type CaseRecord = Record<string, unknown> & { id?: unknown };
export type JointAnalysisConfirmationSummary = {
  flowsWithFirstReport: number;
  eligibleJointAnalyses: number;
  currentReportMismatches: number;
  awaitingBoth: number;
  partnerFirstPending: number;
  ownerFirstPending: number;
  partnerFirstCompleted: number;
  ownerFirstCompleted: number;
  invalidTimestamps: number;
  durationDisclosureThreshold: number;
  durationBuckets: {
    under4Hours: number;
    fourTo24Hours: number;
    oneTo3Days: number;
    threeDaysOrMore: number;
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

function present(value: unknown) {
  return value !== null && value !== undefined && value !== '';
}

function durationBucket(elapsedMs: number) {
  if (elapsedMs < 4 * 60 * 60 * 1000) return 'under4Hours' as const;
  if (elapsedMs < 24 * 60 * 60 * 1000) return 'fourTo24Hours' as const;
  if (elapsedMs < 3 * 24 * 60 * 60 * 1000) return 'oneTo3Days' as const;
  return 'threeDaysOrMore' as const;
}

export async function readJointAnalysisConfirmationSummary(
  state: unknown,
  suppliedRows?: ConsultingFlowMetricRow[],
): Promise<JointAnalysisConfirmationSummary> {
  const operationalCaseIds = new Set(
    operationalPilotRecords('case', casesOf(state))
      .map((item) => item.id)
      .filter((id): id is string => typeof id === 'string'),
  );
  const rows = suppliedRows ?? (await readConsultingFlowMetricRows());
  let flowsWithFirstReport = 0;
  let eligibleJointAnalyses = 0;
  let currentReportMismatches = 0;
  let awaitingBoth = 0;
  let partnerFirstPending = 0;
  let ownerFirstPending = 0;
  let partnerFirstCompleted = 0;
  let ownerFirstCompleted = 0;
  let invalidTimestamps = 0;
  let validPartnerFirstDurations = 0;
  const durationBuckets = {
    under4Hours: 0,
    fourTo24Hours: 0,
    oneTo3Days: 0,
    threeDaysOrMore: 0,
  };

  for (const row of rows) {
    if (
      !operationalCaseIds.has(row.case_id) ||
      typeof row.latest_stage1_report_id !== 'string'
    )
      continue;
    flowsWithFirstReport++;
    if (row.analysis_report_id !== row.latest_stage1_report_id) {
      currentReportMismatches++;
      continue;
    }
    eligibleJointAnalyses++;
    const hasAdmin = present(row.analysis_admin_at);
    const hasPartner = present(row.analysis_partner_at);
    if (!hasAdmin && !hasPartner) {
      awaitingBoth++;
      continue;
    }
    if (
      (hasAdmin && !serverTimestamp(row.analysis_admin_at)) ||
      (hasPartner && !serverTimestamp(row.analysis_partner_at))
    ) {
      invalidTimestamps++;
      continue;
    }
    if (!hasAdmin) {
      partnerFirstPending++;
      continue;
    }
    if (!hasPartner) {
      ownerFirstPending++;
      continue;
    }
    const adminTime = Date.parse(row.analysis_admin_at as string);
    const partnerTime = Date.parse(row.analysis_partner_at as string);
    if (adminTime < partnerTime) {
      ownerFirstCompleted++;
      continue;
    }
    partnerFirstCompleted++;
    validPartnerFirstDurations++;
    durationBuckets[durationBucket(adminTime - partnerTime)]++;
  }

  return {
    flowsWithFirstReport,
    eligibleJointAnalyses,
    currentReportMismatches,
    awaitingBoth,
    partnerFirstPending,
    ownerFirstPending,
    partnerFirstCompleted,
    ownerFirstCompleted,
    invalidTimestamps,
    durationDisclosureThreshold: DURATION_DISCLOSURE_THRESHOLD,
    durationBuckets:
      validPartnerFirstDurations >= DURATION_DISCLOSURE_THRESHOLD
        ? durationBuckets
        : null,
  };
}
