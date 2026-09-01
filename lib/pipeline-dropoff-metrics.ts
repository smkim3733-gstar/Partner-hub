import { operationalPilotRecords } from '@/lib/pilot-readiness';

export const PIPELINE_LIFECYCLE_VERSION = 1;
export const PIPELINE_STAGES = [
  '접수',
  '기업진단',
  '상담예약',
  '상담진행',
  '계약',
  '컨설팅수행',
  '사후관리',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export type PipelineStageSource = 'flow_verified' | 'manual_reported';
type PipelineLifecycleStatus = 'active' | 'discontinued';
type PortalRecord = Record<string, unknown> & { id?: unknown };
type ActorRole = 'admin' | 'partner';

export class PipelineLifecycleError extends Error {}

export type PipelineStageMetric = {
  stage: PipelineStage;
  reached: number;
  discontinued: number;
  discontinuationRatePercent: number | null;
};

export type PipelineDropoffSummary = {
  trackedCases: number;
  activeCases: number;
  discontinuedCases: number;
  reopenedCases: number;
  reachedAftercare: number;
  legacyUnmeasurable: number;
  invalidStates: number;
  observationStatus: 'no_discontinuations_observed' | 'observed';
  flowVerified: {
    cases: number;
    stages: PipelineStageMetric[];
  };
  manualReported: {
    cases: number;
    stages: PipelineStageMetric[];
  };
};

function casesOf(value: unknown): PortalRecord[] {
  if (!value || typeof value !== 'object') return [];
  const cases = (value as Record<string, unknown>).cases;
  return Array.isArray(cases)
    ? cases.filter(
        (item): item is PortalRecord =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}

function pipelineStage(value: unknown): value is PipelineStage {
  return PIPELINE_STAGES.includes(value as PipelineStage);
}

function serverTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function lifecycleStatus(value: unknown): value is PipelineLifecycleStatus {
  return value === 'active' || value === 'discontinued';
}

function stageSource(value: unknown): value is PipelineStageSource {
  return value === 'flow_verified' || value === 'manual_reported';
}

function stripLifecycle(record: PortalRecord): PortalRecord {
  const {
    pipelineLifecycleVersion: _version,
    pipelineLifecycleStatus: _status,
    pipelineHighestStage: _highest,
    pipelineStageSource: _source,
    pipelineDiscontinuedAt: _discontinuedAt,
    pipelineDiscontinuedStage: _discontinuedStage,
    pipelineReopenCount: _reopenCount,
    ...rest
  } = record;
  return rest;
}

function restoreStoredLifecycle(
  stored: PortalRecord,
  incoming: PortalRecord,
): PortalRecord {
  return {
    ...stripLifecycle(incoming),
    pipelineLifecycleVersion: stored.pipelineLifecycleVersion,
    pipelineLifecycleStatus: stored.pipelineLifecycleStatus,
    pipelineHighestStage: stored.pipelineHighestStage,
    pipelineStageSource: stored.pipelineStageSource,
    pipelineReopenCount: stored.pipelineReopenCount,
    ...(stored.pipelineDiscontinuedAt !== undefined
      ? { pipelineDiscontinuedAt: stored.pipelineDiscontinuedAt }
      : {}),
    ...(stored.pipelineDiscontinuedStage !== undefined
      ? { pipelineDiscontinuedStage: stored.pipelineDiscontinuedStage }
      : {}),
  };
}

function stageProgression(
  storedHighest: PipelineStage,
  storedSource: PipelineStageSource,
  current: PortalRecord,
) {
  if (!pipelineStage(current.stage))
    return { highest: storedHighest, source: storedSource, valid: false };
  const currentSource: PipelineStageSource =
    current.flowManaged === true ? 'flow_verified' : 'manual_reported';
  const storedIndex = PIPELINE_STAGES.indexOf(storedHighest);
  const currentIndex = PIPELINE_STAGES.indexOf(current.stage);
  if (currentIndex > storedIndex)
    return { highest: current.stage, source: currentSource, valid: true };
  if (currentIndex === storedIndex && currentSource === 'flow_verified')
    return { highest: storedHighest, source: currentSource, valid: true };
  return { highest: storedHighest, source: storedSource, valid: true };
}

function newLifecycle(record: PortalRecord) {
  return {
    ...stripLifecycle(record),
    stage: '접수',
    pipelineLifecycleVersion: PIPELINE_LIFECYCLE_VERSION,
    pipelineLifecycleStatus: 'active',
    pipelineHighestStage: '접수',
    pipelineStageSource: 'manual_reported',
    pipelineReopenCount: 0,
  };
}

function protectedLifecycle(
  stored: PortalRecord,
  incoming: PortalRecord,
  actorRole: ActorRole,
  now: string,
) {
  const storedStatus = lifecycleStatus(stored.pipelineLifecycleStatus)
    ? stored.pipelineLifecycleStatus
    : null;
  const storedHighest = pipelineStage(stored.pipelineHighestStage)
    ? stored.pipelineHighestStage
    : null;
  const storedSource = stageSource(stored.pipelineStageSource)
    ? stored.pipelineStageSource
    : null;
  const storedReopenCount =
    Number.isSafeInteger(stored.pipelineReopenCount) &&
    Number(stored.pipelineReopenCount) >= 0
      ? Number(stored.pipelineReopenCount)
      : null;
  if (!storedStatus || !storedHighest || !storedSource || storedReopenCount === null)
    return restoreStoredLifecycle(stored, incoming);

  const desiredStatus = lifecycleStatus(incoming.pipelineLifecycleStatus)
    ? incoming.pipelineLifecycleStatus
    : storedStatus;
  const desiredByActor = actorRole === 'admin' ? desiredStatus : storedStatus;
  const freezeClosedStage =
    storedStatus === 'discontinued' && desiredByActor === 'discontinued';
  const authoritativeIncoming = freezeClosedStage
    ? { ...incoming, stage: stored.stage }
    : pipelineStage(incoming.stage)
      ? incoming
      : { ...incoming, stage: stored.stage };
  const progression = stageProgression(
    storedHighest,
    storedSource,
    authoritativeIncoming,
  );
  const base = {
    ...stripLifecycle(authoritativeIncoming),
    pipelineLifecycleVersion: PIPELINE_LIFECYCLE_VERSION,
    pipelineLifecycleStatus: storedStatus,
    pipelineHighestStage: storedHighest,
    pipelineStageSource: storedSource,
    pipelineReopenCount: storedReopenCount,
    ...(stored.pipelineDiscontinuedAt
      ? { pipelineDiscontinuedAt: stored.pipelineDiscontinuedAt }
      : {}),
    ...(stored.pipelineDiscontinuedStage
      ? { pipelineDiscontinuedStage: stored.pipelineDiscontinuedStage }
      : {}),
  };

  if (storedStatus === 'active' && desiredByActor === 'discontinued') {
    if (!progression.valid || !pipelineStage(authoritativeIncoming.stage))
      throw new PipelineLifecycleError(
        '진행 중단 전에 현재 진행단계를 다시 확인해 주세요.',
      );
    return {
      ...base,
      pipelineLifecycleStatus: 'discontinued',
      pipelineHighestStage: progression.highest,
      pipelineStageSource: progression.source,
      pipelineDiscontinuedAt: now,
      pipelineDiscontinuedStage: authoritativeIncoming.stage,
    };
  }

  if (storedStatus === 'discontinued' && desiredByActor === 'active') {
    if (!progression.valid)
      throw new PipelineLifecycleError(
        '진행 재개 전에 현재 진행단계를 다시 확인해 주세요.',
      );
    return {
      ...stripLifecycle(base),
      pipelineLifecycleVersion: PIPELINE_LIFECYCLE_VERSION,
      pipelineLifecycleStatus: 'active',
      pipelineHighestStage: progression.highest,
      pipelineStageSource: progression.source,
      pipelineReopenCount: storedReopenCount + 1,
    };
  }

  if (storedStatus === 'active' && progression.valid)
    return {
      ...base,
      pipelineHighestStage: progression.highest,
      pipelineStageSource: progression.source,
    };

  return base;
}

/**
 * Preserve server-owned lifecycle fields after both states have been projected
 * through the authoritative FLOW records. Existing pre-feature cases are never
 * backfilled from their current stage.
 */
export function protectPipelineLifecycle(
  currentProjectedState: unknown,
  nextProjectedState: Record<string, unknown>,
  actorRole: ActorRole,
  now = new Date().toISOString(),
): Record<string, unknown> {
  if (!serverTimestamp(now)) throw new Error('Invalid pipeline lifecycle time.');
  const storedById = new Map(
    casesOf(currentProjectedState)
      .filter((item) => typeof item.id === 'string')
      .map((item) => [item.id as string, item]),
  );
  return {
    ...nextProjectedState,
    cases: casesOf(nextProjectedState).map((incoming) => {
      const id = typeof incoming.id === 'string' ? incoming.id : '';
      const stored = storedById.get(id);
      if (stored?.pipelineLifecycleVersion === PIPELINE_LIFECYCLE_VERSION)
        return protectedLifecycle(stored, incoming, actorRole, now);
      if (stored) return stripLifecycle(incoming);
      if (
        incoming.submissionTrackingVersion === 1 &&
        serverTimestamp(incoming.submittedAt)
      )
        return newLifecycle(incoming);
      return stripLifecycle(incoming);
    }),
  };
}

function emptyStageMetrics(): PipelineStageMetric[] {
  return PIPELINE_STAGES.map((stage) => ({
    stage,
    reached: 0,
    discontinued: 0,
    discontinuationRatePercent: null,
  }));
}

export function isPipelineDiscontinued(state: unknown, caseId: string) {
  const item = casesOf(state).find((record) => record.id === caseId);
  return (
    item?.pipelineLifecycleVersion === PIPELINE_LIFECYCLE_VERSION &&
    item.pipelineLifecycleStatus === 'discontinued'
  );
}

/** Current-state aggregate; no case identifiers or exact timestamps leave it. */
export function readPipelineDropoffSummary(
  projectedState: unknown,
): PipelineDropoffSummary {
  const series = {
    flow_verified: { cases: 0, stages: emptyStageMetrics() },
    manual_reported: { cases: 0, stages: emptyStageMetrics() },
  };
  let trackedCases = 0;
  let activeCases = 0;
  let discontinuedCases = 0;
  let reopenedCases = 0;
  let reachedAftercare = 0;
  let legacyUnmeasurable = 0;
  let invalidStates = 0;

  for (const item of operationalPilotRecords('case', casesOf(projectedState))) {
    if (item.pipelineLifecycleVersion !== PIPELINE_LIFECYCLE_VERSION) {
      legacyUnmeasurable++;
      continue;
    }
    trackedCases++;
    const status = lifecycleStatus(item.pipelineLifecycleStatus)
      ? item.pipelineLifecycleStatus
      : null;
    const storedHighest = pipelineStage(item.pipelineHighestStage)
      ? item.pipelineHighestStage
      : null;
    const storedSource = stageSource(item.pipelineStageSource)
      ? item.pipelineStageSource
      : null;
    const reopenCount =
      Number.isSafeInteger(item.pipelineReopenCount) &&
      Number(item.pipelineReopenCount) >= 0
        ? Number(item.pipelineReopenCount)
        : null;
    if (!status || !storedHighest || !storedSource || reopenCount === null) {
      invalidStates++;
      continue;
    }
    const progression = stageProgression(storedHighest, storedSource, item);
    if (!progression.valid) {
      invalidStates++;
      continue;
    }
    let highest = storedHighest;
    let source = storedSource;
    let discontinuedStage: PipelineStage | null = null;
    if (status === 'active') {
      if (
        item.pipelineDiscontinuedAt !== undefined ||
        item.pipelineDiscontinuedStage !== undefined
      ) {
        invalidStates++;
        continue;
      }
      activeCases++;
      highest = progression.highest;
      source = progression.source;
    } else {
      if (
        !serverTimestamp(item.pipelineDiscontinuedAt) ||
        !pipelineStage(item.pipelineDiscontinuedStage)
      ) {
        invalidStates++;
        continue;
      }
      discontinuedStage = item.pipelineDiscontinuedStage;
      if (
        PIPELINE_STAGES.indexOf(discontinuedStage) >
          PIPELINE_STAGES.indexOf(storedHighest) ||
        (item.flowManaged === true &&
          pipelineStage(item.stage) &&
          PIPELINE_STAGES.indexOf(item.stage) >
            PIPELINE_STAGES.indexOf(discontinuedStage))
      ) {
        invalidStates++;
        continue;
      }
      discontinuedCases++;
    }
    if (reopenCount > 0) reopenedCases++;
    if (PIPELINE_STAGES.indexOf(highest) >= PIPELINE_STAGES.indexOf('사후관리'))
      reachedAftercare++;
    series[source].cases++;
    const highestIndex = PIPELINE_STAGES.indexOf(highest);
    for (let index = 0; index < PIPELINE_STAGES.length; index++) {
      if (highestIndex >= index) series[source].stages[index].reached++;
      if (discontinuedStage === PIPELINE_STAGES[index])
        series[source].stages[index].discontinued++;
    }
  }

  for (const value of Object.values(series))
    for (const stage of value.stages)
      stage.discontinuationRatePercent = stage.reached
        ? Math.round((stage.discontinued / stage.reached) * 1000) / 10
        : null;

  return {
    trackedCases,
    activeCases,
    discontinuedCases,
    reopenedCases,
    reachedAftercare,
    legacyUnmeasurable,
    invalidStates,
    observationStatus:
      discontinuedCases > 0 ? 'observed' : 'no_discontinuations_observed',
    flowVerified: series.flow_verified,
    manualReported: series.manual_reported,
  };
}
