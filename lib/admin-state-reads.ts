import { runBatchedReadsTogether } from '@/lib/batched-read';
import {
  consultingFlowStateRead,
  stateWithConsultingFlows,
} from '@/lib/consulting-flow-store';
import {
  consultingFlowMetricRowsRead,
  readConsultingFlowMetricRows,
  type ConsultingFlowMetricRow,
} from '@/lib/consulting-flow-metrics';
import {
  portalLoginStatsRead,
  readPortalLoginStats,
  type PortalLoginStat,
} from '@/lib/portal-state';
import {
  passwordLinkSummaryRead,
  readPasswordLinkSummary,
} from '@/lib/password-link-metrics';
import {
  duplicateRequestSummaryRead,
  readDuplicateRequestSummary,
} from '@/lib/duplicate-request-metrics';
import {
  portalSaveConflictSummaryRead,
  readPortalSaveConflictSummary,
} from '@/lib/portal-conflict-metrics';

/**
 * The DB reads behind the administrator `/api/state` response. Each value is
 * produced only when asked for, so a caller that stops at an earlier error
 * never leaves a rejected read behind. The caller keeps its own handling for
 * each read: FLOW state and login stats are required, the summaries may fail
 * on their own and show as unavailable.
 */
export type AdministratorStateReads = {
  state(): Promise<unknown>;
  loginStats(): Promise<PortalLoginStat[]>;
  flowMetricRows(): Promise<ConsultingFlowMetricRow[]>;
  saveConflicts(): Promise<
    Awaited<ReturnType<typeof readPortalSaveConflictSummary>>
  >;
  passwordLinks(): Promise<
    Awaited<ReturnType<typeof readPasswordLinkSummary>>
  >;
  duplicateRequests(): Promise<
    Awaited<ReturnType<typeof readDuplicateRequestSummary>>
  >;
};

function once<T>(run: () => T | Promise<T>): () => Promise<T> {
  let value: Promise<T> | undefined;
  return () => (value ??= Promise.resolve().then(run));
}

/** The reads one after another, exactly as before batching. */
function separateReads(rawState: unknown): AdministratorStateReads {
  return {
    state: once(() => stateWithConsultingFlows(rawState)),
    loginStats: once(() => readPortalLoginStats()),
    flowMetricRows: once(() => readConsultingFlowMetricRows()),
    saveConflicts: once(() => readPortalSaveConflictSummary()),
    passwordLinks: once(() => readPasswordLinkSummary()),
    duplicateRequests: once(() => readDuplicateRequestSummary()),
  };
}

async function preparedReads(rawState: unknown) {
  // Preparing a PostgreSQL read sends nothing to the DB.
  const state = await consultingFlowStateRead(rawState);
  const flowRows = await consultingFlowMetricRowsRead();
  if (!state || !flowRows) return null;
  const [loginStats, conflicts, passwordLinks, duplicates] = await Promise.all([
    portalLoginStatsRead(),
    portalSaveConflictSummaryRead(),
    passwordLinkSummaryRead(),
    duplicateRequestSummaryRead(),
  ]);
  return [
    state,
    loginStats,
    flowRows,
    conflicts,
    passwordLinks,
    duplicates,
  ] as const;
}

/**
 * Reads everything the administrator screen needs after sign-in in one DB
 * batch (one PostgreSQL transaction, one round trip). The schema guards of
 * every read run first in that same transaction.
 *
 * One failing statement or guard fails the whole batch, which would also fail
 * reads that are allowed to fail on their own. So on any failure, and on
 * legacy SQLite databases, the reads run separately exactly as before, and
 * each keeps its own failure handling.
 */
export async function readAdministratorState(
  rawState: unknown,
): Promise<AdministratorStateReads> {
  const reads = await preparedReads(rawState).catch(() => null);
  // Preparing a read failed before any DB batch, or this is a legacy SQLite
  // database: the separate reads report any error where the response expects
  // it.
  if (!reads) return separateReads(rawState);
  const [state, loginStats, flowRows, conflicts, passwordLinks, duplicates] =
    reads;
  let results: Awaited<ReturnType<typeof runBatchedReadsTogether>>;
  try {
    results = await runBatchedReadsTogether([
      state,
      loginStats,
      flowRows,
      conflicts,
      passwordLinks,
      duplicates,
    ]);
  } catch (error) {
    console.error(
      'Failed to read administrator state in one batch',
      error instanceof Error ? error.name : 'unknown',
    );
    return separateReads(rawState);
  }
  return {
    state: once(() => state.parse(results[0])),
    loginStats: once(() => loginStats.parse(results[1])),
    flowMetricRows: once(() => flowRows.parse(results[2])),
    saveConflicts: once(() => conflicts.parse(results[3])),
    passwordLinks: once(() => passwordLinks.parse(results[4])),
    duplicateRequests: once(() => duplicates.parse(results[5])),
  };
}
