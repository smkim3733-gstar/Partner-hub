import { PORTAL_STATE_LIMIT_BYTES } from './storage-limits';

export { PORTAL_STATE_LIMIT_BYTES } from './storage-limits';

export const PROVISIONAL_STORAGE_WARNING_RATIO = 0.7;

export type PilotSeedKind =
  | 'case'
  | 'task'
  | 'document'
  | 'schedule'
  | 'member'
  | 'diagnosis';

const pilotDiagnosisIds = Array.from(
  { length: 3 },
  (_, index) => `diagnosis-${index + 1}`,
);
const pilotDiagnosisReviewTaskIds = new Map(
  pilotDiagnosisIds.map((diagnosisId, index) => [
    diagnosisId,
    `task-diagnosis-review-${index + 1}`,
  ]),
);

const seedIds: Record<PilotSeedKind, ReadonlySet<string>> = {
  case: new Set(Array.from({ length: 10 }, (_, index) => `case-${index + 1}`)),
  task: new Set([
    ...Array.from({ length: 7 }, (_, index) => `task-${index + 1}`),
    ...pilotDiagnosisReviewTaskIds.values(),
  ]),
  document: new Set(
    Array.from({ length: 6 }, (_, index) => `file-${index + 1}`),
  ),
  schedule: new Set(
    Array.from({ length: 5 }, (_, index) => `schedule-${index + 1}`),
  ),
  member: new Set(
    Array.from({ length: 4 }, (_, index) => `trainee-${index + 1}`),
  ),
  diagnosis: new Set(pilotDiagnosisIds),
};

export function pilotDiagnosisReviewTaskId(diagnosisId: unknown) {
  return typeof diagnosisId === 'string'
    ? (pilotDiagnosisReviewTaskIds.get(diagnosisId) ?? null)
    : null;
}

export function isPilotSeedId(kind: PilotSeedKind, id: unknown) {
  return typeof id === 'string' && seedIds[kind].has(id);
}

export function isPilotSeedRecord(
  kind: PilotSeedKind,
  record: { id?: unknown },
) {
  return isPilotSeedId(kind, record.id);
}

export function countPilotSeedRecords(
  kind: PilotSeedKind,
  records: Array<{ id?: unknown }>,
) {
  return records.filter((record) => isPilotSeedRecord(kind, record)).length;
}

export function operationalPilotRecords<T extends { id?: unknown }>(
  kind: PilotSeedKind,
  records: T[],
) {
  return records.filter((record) => !isPilotSeedRecord(kind, record));
}

export type PortalStorageTelemetry = {
  storedBytes: number;
  nextRequestBytes: number;
  effectiveBytes: number;
  limitBytes: number;
  remainingBytes: number;
  usagePercent: number;
  warning: boolean;
  warningPercent: number;
  thresholdProvisional: true;
};

export function isPortalStorageTelemetry(
  value: unknown,
): value is PortalStorageTelemetry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const storage = value as Record<string, unknown>;
  return (
    [
      'storedBytes',
      'nextRequestBytes',
      'effectiveBytes',
      'limitBytes',
      'remainingBytes',
      'usagePercent',
      'warningPercent',
    ].every(
      (key) =>
        typeof storage[key] === 'number' &&
        Number.isFinite(storage[key]) &&
        Number(storage[key]) >= 0,
    ) &&
    typeof storage.warning === 'boolean' &&
    storage.thresholdProvisional === true
  );
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function portalStorageTelemetry({
  payload,
  state,
  expectedUserId,
  warningRatio = PROVISIONAL_STORAGE_WARNING_RATIO,
}: {
  payload: string | null;
  state: unknown;
  expectedUserId: string;
  warningRatio?: number;
}): PortalStorageTelemetry {
  const storedBytes = payload === null ? 0 : utf8Bytes(payload);
  const nextRequestBytes = utf8Bytes(JSON.stringify({ state, expectedUserId }));
  const effectiveBytes = Math.max(storedBytes, nextRequestBytes);
  const normalizedWarningRatio = Math.min(1, Math.max(0, warningRatio));
  return {
    storedBytes,
    nextRequestBytes,
    effectiveBytes,
    limitBytes: PORTAL_STATE_LIMIT_BYTES,
    remainingBytes: Math.max(0, PORTAL_STATE_LIMIT_BYTES - effectiveBytes),
    usagePercent: Number(
      ((effectiveBytes / PORTAL_STATE_LIMIT_BYTES) * 100).toFixed(1),
    ),
    warning:
      effectiveBytes >= PORTAL_STATE_LIMIT_BYTES * normalizedWarningRatio,
    warningPercent: Number((normalizedWarningRatio * 100).toFixed(1)),
    thresholdProvisional: true,
  };
}

export function emptyPortalStateBaseline() {
  return {
    version: 1 as const,
    consultationNumber: 0,
    timeline: [],
    schedule: [],
    tasks: [],
    companyDocuments: [],
    cases: [],
    members: [],
    membersRevision: 0,
    diagnosisAssessments: [],
  };
}
