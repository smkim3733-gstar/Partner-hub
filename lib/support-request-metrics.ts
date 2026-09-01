import { operationalPilotRecords } from '@/lib/pilot-readiness';

const SUPPORT_TRACKING_VERSION = 1;
const DURATION_DISCLOSURE_THRESHOLD = 5;
export const SUPPORT_REQUEST_COMPANY = '파트너 허브 지원';
export const SUPPORT_CATEGORIES = [
  'account_access',
  'save_sync',
  'files_documents',
  'consulting_flow',
  'other',
] as const;

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];
export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  account_access: '로그인·계정',
  save_sync: '저장·동기화',
  files_documents: '파일·자료',
  consulting_flow: '상담 FLOW',
  other: '기타',
};

type PortalRecord = Record<string, unknown> & { id?: unknown };
type SupportActorRole = 'admin' | 'partner';
type DurationBuckets = {
  under4Hours: number;
  fourTo24Hours: number;
  oneTo3Days: number;
  threeDaysOrMore: number;
};

export class SupportRequestError extends Error {}

export type SupportRequestSummary = {
  trackedRequests: number;
  byCategory: Record<SupportCategory, number>;
  partnerSelfService: number;
  adminLogged: number;
  waitingForAcknowledgement: number;
  acknowledgedOpen: number;
  adminResolved: number;
  requesterClosed: number;
  reopenedCurrentCycles: number;
  legacyUnmeasurable: number;
  invalidTransitions: number;
  durationDisclosureThreshold: number;
  responseTimeBuckets: DurationBuckets | null;
  adminHandlingTimeBuckets: DurationBuckets | null;
  unacknowledgedAgeBuckets: DurationBuckets | null;
};

function recordsOf(value: unknown, key: 'tasks'): PortalRecord[] {
  if (!value || typeof value !== 'object') return [];
  const records = (value as Record<string, unknown>)[key];
  return Array.isArray(records)
    ? records.filter(
        (item): item is PortalRecord =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}

function supportCategory(value: unknown): value is SupportCategory {
  return SUPPORT_CATEGORIES.includes(value as SupportCategory);
}

function serverTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function taskStatus(value: unknown): '대기' | '진행' | '완료' | null {
  return value === '대기' || value === '진행' || value === '완료'
    ? value
    : null;
}

function stripSupportMetadata(record: PortalRecord): PortalRecord {
  const {
    supportTrackingVersion: _tracking,
    supportCategory: _category,
    supportOrigin: _origin,
    supportOpenedAt: _openedAt,
    supportAcknowledgedAt: _acknowledgedAt,
    supportResolvedAt: _resolvedAt,
    supportResolvedByRole: _resolvedByRole,
    supportCycle: _cycle,
    ...rest
  } = record;
  return rest;
}

function newTrackedSupport(
  record: PortalRecord,
  actorRole: SupportActorRole,
  now: string,
) {
  if (!supportCategory(record.supportCategory))
    throw new SupportRequestError('지원 요청 유형을 확인해 주세요.');
  return {
    ...stripSupportMetadata(record),
    company: SUPPORT_REQUEST_COMPANY,
    kind: '지원요청',
    status: '대기',
    supportTrackingVersion: SUPPORT_TRACKING_VERSION,
    supportCategory: record.supportCategory,
    supportOrigin:
      actorRole === 'admin' ? 'admin_logged' : 'partner_self_service',
    supportOpenedAt: now,
    supportCycle: 1,
  };
}

function protectedTrackedSupport(
  stored: PortalRecord,
  incoming: PortalRecord,
  actorRole: SupportActorRole,
  now: string,
) {
  const base = {
    ...stripSupportMetadata(incoming),
    company: SUPPORT_REQUEST_COMPANY,
    kind: '지원요청',
    supportTrackingVersion: SUPPORT_TRACKING_VERSION,
    supportCategory: stored.supportCategory,
    supportOrigin: stored.supportOrigin,
    supportOpenedAt: stored.supportOpenedAt,
    supportCycle: stored.supportCycle,
    ...(stored.supportAcknowledgedAt
      ? { supportAcknowledgedAt: stored.supportAcknowledgedAt }
      : {}),
    ...(stored.supportResolvedAt
      ? { supportResolvedAt: stored.supportResolvedAt }
      : {}),
    ...(stored.supportResolvedByRole
      ? { supportResolvedByRole: stored.supportResolvedByRole }
      : {}),
  };
  const storedStatus = taskStatus(stored.status) ?? '대기';
  const desiredStatus = taskStatus(incoming.status) ?? storedStatus;

  if (storedStatus === '완료' && desiredStatus !== '완료') {
    const supportCycle =
      Number.isSafeInteger(stored.supportCycle) && Number(stored.supportCycle) > 0
        ? Number(stored.supportCycle) + 1
        : 1;
    return {
      ...stripSupportMetadata(base),
      status: actorRole === 'admin' && desiredStatus === '진행' ? '진행' : '대기',
      supportTrackingVersion: SUPPORT_TRACKING_VERSION,
      supportCategory: stored.supportCategory,
      supportOrigin: stored.supportOrigin,
      supportOpenedAt: now,
      ...(actorRole === 'admin' && desiredStatus === '진행'
        ? { supportAcknowledgedAt: now }
        : {}),
      supportCycle,
    };
  }

  if (storedStatus !== '완료' && desiredStatus === '완료') {
    return {
      ...base,
      status: '완료',
      ...(actorRole === 'admin' && !stored.supportAcknowledgedAt
        ? { supportAcknowledgedAt: now }
        : {}),
      supportResolvedAt: now,
      supportResolvedByRole: actorRole === 'admin' ? 'admin' : 'requester',
    };
  }

  if (
    actorRole === 'admin' &&
    storedStatus === '대기' &&
    desiredStatus === '진행'
  ) {
    return {
      ...base,
      status: '진행',
      supportAcknowledgedAt: stored.supportAcknowledgedAt ?? now,
    };
  }

  return { ...base, status: storedStatus };
}

/** Remove client-owned support timing and restore only server-authoritative state. */
export function protectSupportRequestTracking(
  currentState: unknown,
  nextState: Record<string, unknown>,
  actorRole: SupportActorRole,
  now = new Date().toISOString(),
): Record<string, unknown> {
  if (!serverTimestamp(now)) throw new Error('Invalid support request time.');
  const storedById = new Map(
    recordsOf(currentState, 'tasks')
      .filter((item) => typeof item.id === 'string')
      .map((item) => [item.id as string, item]),
  );
  return {
    ...nextState,
    tasks: recordsOf(nextState, 'tasks').map((incoming) => {
      const id = typeof incoming.id === 'string' ? incoming.id : '';
      const stored = storedById.get(id);
      if (
        stored?.supportTrackingVersion === SUPPORT_TRACKING_VERSION &&
        stored.kind === '지원요청'
      )
        return protectedTrackedSupport(stored, incoming, actorRole, now);
      if (stored?.kind === '지원요청') {
        const category = supportCategory(stored.supportCategory)
          ? { supportCategory: stored.supportCategory }
          : {};
        return {
          ...stripSupportMetadata(incoming),
          ...category,
          company: SUPPORT_REQUEST_COMPANY,
          kind: '지원요청',
        };
      }
      if (incoming.kind === '지원요청')
        return newTrackedSupport(incoming, actorRole, now);
      return stripSupportMetadata(incoming);
    }),
  };
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

export function readSupportRequestSummary(
  state: unknown,
  now = new Date().toISOString(),
): SupportRequestSummary {
  if (!serverTimestamp(now)) throw new Error('Invalid metric request time.');
  const byCategory = Object.fromEntries(
    SUPPORT_CATEGORIES.map((category) => [category, 0]),
  ) as Record<SupportCategory, number>;
  let trackedRequests = 0;
  let partnerSelfService = 0;
  let adminLogged = 0;
  let waitingForAcknowledgement = 0;
  let acknowledgedOpen = 0;
  let adminResolved = 0;
  let requesterClosed = 0;
  let reopenedCurrentCycles = 0;
  let legacyUnmeasurable = 0;
  let invalidTransitions = 0;
  let validResponses = 0;
  let validAdminHandling = 0;
  let validUnacknowledgedAges = 0;
  const responseTimeBuckets = emptyBuckets();
  const adminHandlingTimeBuckets = emptyBuckets();
  const unacknowledgedAgeBuckets = emptyBuckets();
  const nowTime = Date.parse(now);

  for (const task of operationalPilotRecords('task', recordsOf(state, 'tasks'))) {
    if (task.kind !== '지원요청') continue;
    if (task.supportTrackingVersion !== SUPPORT_TRACKING_VERSION) {
      legacyUnmeasurable++;
      continue;
    }
    trackedRequests++;
    if (supportCategory(task.supportCategory)) byCategory[task.supportCategory]++;
    if (task.supportOrigin === 'partner_self_service') partnerSelfService++;
    else if (task.supportOrigin === 'admin_logged') adminLogged++;
    if (Number(task.supportCycle) > 1) reopenedCurrentCycles++;

    const status = taskStatus(task.status);
    const openedAt = task.supportOpenedAt;
    const acknowledgedAt = task.supportAcknowledgedAt;
    const resolvedAt = task.supportResolvedAt;
    if (
      !supportCategory(task.supportCategory) ||
      !['partner_self_service', 'admin_logged'].includes(
        String(task.supportOrigin),
      ) ||
      !Number.isSafeInteger(task.supportCycle) ||
      Number(task.supportCycle) < 1 ||
      !serverTimestamp(openedAt)
    ) {
      invalidTransitions++;
      continue;
    }
    const openedTime = Date.parse(openedAt);
    if (openedTime > nowTime) {
      invalidTransitions++;
      continue;
    }
    const hasAcknowledged = acknowledgedAt !== undefined && acknowledgedAt !== null;
    const hasResolved = resolvedAt !== undefined && resolvedAt !== null;
    const acknowledgedTime = serverTimestamp(acknowledgedAt)
      ? Date.parse(acknowledgedAt)
      : Number.NaN;
    const resolvedTime = serverTimestamp(resolvedAt)
      ? Date.parse(resolvedAt)
      : Number.NaN;

    if (
      (hasAcknowledged &&
        (!Number.isFinite(acknowledgedTime) ||
          acknowledgedTime < openedTime ||
          acknowledgedTime > nowTime)) ||
      (hasResolved &&
        (!Number.isFinite(resolvedTime) ||
          resolvedTime < openedTime ||
          resolvedTime > nowTime))
    ) {
      invalidTransitions++;
      continue;
    }

    if (status === '대기' && !hasAcknowledged && !hasResolved) {
      waitingForAcknowledgement++;
      validUnacknowledgedAges++;
      unacknowledgedAgeBuckets[durationBucket(nowTime - openedTime)]++;
      continue;
    }
    if (status === '진행' && hasAcknowledged && !hasResolved) {
      acknowledgedOpen++;
      validResponses++;
      responseTimeBuckets[durationBucket(acknowledgedTime - openedTime)]++;
      continue;
    }
    if (
      status === '완료' &&
      hasResolved &&
      (task.supportResolvedByRole === 'admin' ||
        task.supportResolvedByRole === 'requester') &&
      (!hasAcknowledged || acknowledgedTime <= resolvedTime)
    ) {
      if (hasAcknowledged) {
        validResponses++;
        responseTimeBuckets[durationBucket(acknowledgedTime - openedTime)]++;
      }
      if (task.supportResolvedByRole === 'admin') {
        if (!hasAcknowledged) {
          invalidTransitions++;
          continue;
        }
        adminResolved++;
        validAdminHandling++;
        adminHandlingTimeBuckets[durationBucket(resolvedTime - openedTime)]++;
      } else requesterClosed++;
      continue;
    }
    invalidTransitions++;
  }

  return {
    trackedRequests,
    byCategory,
    partnerSelfService,
    adminLogged,
    waitingForAcknowledgement,
    acknowledgedOpen,
    adminResolved,
    requesterClosed,
    reopenedCurrentCycles,
    legacyUnmeasurable,
    invalidTransitions,
    durationDisclosureThreshold: DURATION_DISCLOSURE_THRESHOLD,
    responseTimeBuckets:
      validResponses >= DURATION_DISCLOSURE_THRESHOLD
        ? responseTimeBuckets
        : null,
    adminHandlingTimeBuckets:
      validAdminHandling >= DURATION_DISCLOSURE_THRESHOLD
        ? adminHandlingTimeBuckets
        : null,
    unacknowledgedAgeBuckets:
      validUnacknowledgedAges >= DURATION_DISCLOSURE_THRESHOLD
        ? unacknowledgedAgeBuckets
        : null,
  };
}
