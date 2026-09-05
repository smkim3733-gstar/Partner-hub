import type { ConsultingFlow } from './consulting-flow';

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

function hasBaseStructure(value: unknown, projected: boolean) {
  const flow = asRecord(value);
  if (!flow) return false;
  const analysis = asRecord(flow.analysis);
  const ai = asRecord(flow.ai);
  const requiredStrings = ['caseId', 'company', 'partnerId', 'partnerName'];
  const commonArrays = [
    'reports',
    'meetings',
    'recordings',
    'requests',
    'payments',
  ];
  const privateArrays = ['files', 'jobs', 'audit', 'commandIds'];
  const optionalObjects = ['decision', 'contract', 'aftercare'];
  return (
    flow.schemaVersion === 1 &&
    requiredStrings.every(
      (key) => typeof flow[key] === 'string' && flow[key].trim().length > 0,
    ) &&
    typeof flow.updatedAt === 'string' &&
    Number.isSafeInteger(flow.revision) &&
    (flow.revision as number) >= 0 &&
    commonArrays.every((key) => Array.isArray(flow[key])) &&
    (projected || privateArrays.every((key) => Array.isArray(flow[key]))) &&
    analysis !== null &&
    typeof analysis.reportId === 'string' &&
    ai !== null &&
    typeof ai.enabled === 'boolean' &&
    (projected || typeof ai.sourceText === 'string') &&
    optionalObjects.every(
      (key) => flow[key] === undefined || asRecord(flow[key]) !== null,
    ) &&
    (flow.executionStartedAt === undefined ||
      typeof flow.executionStartedAt === 'string') &&
    (flow.commandReceipts === undefined ||
      asRecord(flow.commandReceipts) !== null)
  );
}

export function hasConsultingFlowStructure(
  value: unknown,
): value is ConsultingFlow {
  return hasBaseStructure(value, false);
}

export function hasProjectedConsultingFlowStructure(value: unknown) {
  return hasBaseStructure(value, true);
}
