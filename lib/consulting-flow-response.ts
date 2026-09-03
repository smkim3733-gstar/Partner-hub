import type { ConsultingFlow } from './consulting-flow';

type JsonRecord = Record<string, unknown>;

export type ConsultingFlowMutationPayload = JsonRecord & {
  flow: ConsultingFlow;
  error?: string;
};

export type ConsultingFlowReadPayload = ConsultingFlowMutationPayload & {
  role: 'admin' | 'partner';
  canUpload: boolean;
  readiness: { aiConnected: boolean; model: string };
};

export class ConsultingFlowResponseError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
  ) {
    super(message);
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object'
    ? (value as JsonRecord)
    : null;
}

function flowShape(value: unknown): value is ConsultingFlow {
  const flow = asRecord(value);
  if (!flow) return false;
  const analysis = asRecord(flow.analysis);
  const ai = asRecord(flow.ai);
  const arrayKeys = [
    'reports',
    'files',
    'meetings',
    'recordings',
    'requests',
    'payments',
    'jobs',
    'audit',
    'commandIds',
  ];
  return (
    flow.schemaVersion === 1 &&
    typeof flow.caseId === 'string' &&
    typeof flow.company === 'string' &&
    typeof flow.partnerId === 'string' &&
    typeof flow.partnerName === 'string' &&
    typeof flow.revision === 'number' &&
    Number.isInteger(flow.revision) &&
    flow.revision >= 0 &&
    typeof flow.updatedAt === 'string' &&
    arrayKeys.every((key) => Array.isArray(flow[key])) &&
    analysis !== null &&
    typeof analysis.reportId === 'string' &&
    ai !== null &&
    typeof ai.enabled === 'boolean' &&
    typeof ai.sourceText === 'string'
  );
}

async function readJson(response: Response, unreadableMessage: string) {
  try {
    return await response.json();
  } catch {
    throw new ConsultingFlowResponseError(unreadableMessage, response.status);
  }
}

function responseProblem(
  response: Response,
  payload: JsonRecord | null,
  failedMessage: string,
) {
  if (response.ok) return;
  throw new ConsultingFlowResponseError(
    payload && typeof payload.error === 'string' && payload.error.trim()
      ? payload.error
      : failedMessage,
    response.status,
  );
}

type ResponseMessages = {
  unreadableMessage: string;
  failedMessage: string;
  invalidMessage: string;
};

const defaultMessages: ResponseMessages = {
  unreadableMessage:
    '진행 정보를 불러오지 못했습니다. 연결을 확인한 뒤 다시 불러오기 또는 새로고침으로 최신 진행 상태를 확인해 주세요.',
  failedMessage: '진행 정보를 불러오지 못했습니다.',
  invalidMessage:
    '진행 정보 응답 형식이 올바르지 않습니다. 새로고침으로 최신 상태를 확인해 주세요.',
};

export async function readConsultingFlowMutationResponse(
  response: Response,
  messages: Partial<ResponseMessages> = {},
): Promise<ConsultingFlowMutationPayload> {
  const resolved = { ...defaultMessages, ...messages };
  const payload = asRecord(await readJson(response, resolved.unreadableMessage));
  responseProblem(response, payload, resolved.failedMessage);
  if (!payload || !flowShape(payload.flow))
    throw new ConsultingFlowResponseError(resolved.invalidMessage, null);
  return payload as ConsultingFlowMutationPayload;
}

export async function readConsultingFlowStateResponse(
  response: Response,
  messages: Partial<ResponseMessages> = {},
): Promise<ConsultingFlowReadPayload> {
  const payload = await readConsultingFlowMutationResponse(response, messages);
  const readiness = asRecord(payload.readiness);
  if (
    (payload.role !== 'admin' && payload.role !== 'partner') ||
    typeof payload.canUpload !== 'boolean' ||
    !readiness ||
    typeof readiness.aiConnected !== 'boolean' ||
    typeof readiness.model !== 'string'
  ) {
    throw new ConsultingFlowResponseError(
      messages.invalidMessage ?? defaultMessages.invalidMessage,
      null,
    );
  }
  return payload as ConsultingFlowReadPayload;
}
