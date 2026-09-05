import type { ConsultingFlow } from './consulting-flow';
import { hasConsultingFlowStructure } from './consulting-flow-shape';

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

export type ConsultingFlowStateRefreshResult =
  | { current: false }
  | { current: true; payload: ConsultingFlowReadPayload };

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
  const payload = asRecord(
    await readJson(response, resolved.unreadableMessage),
  );
  responseProblem(response, payload, resolved.failedMessage);
  if (!payload || !hasConsultingFlowStructure(payload.flow))
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

export class ConsultingFlowStateRefresh {
  private requestVersion = 0;

  cancel() {
    this.requestVersion += 1;
  }

  async refresh(
    request: () => Promise<Response>,
    messages: Partial<ResponseMessages> = {},
  ): Promise<ConsultingFlowStateRefreshResult> {
    const requestVersion = ++this.requestVersion;
    try {
      const payload = await readConsultingFlowStateResponse(
        await request(),
        messages,
      );
      return requestVersion === this.requestVersion
        ? { current: true, payload }
        : { current: false };
    } catch (error) {
      if (requestVersion !== this.requestVersion) return { current: false };
      throw error;
    }
  }
}
