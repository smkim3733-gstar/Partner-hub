import {
  AI_DIAGNOSIS_RUN_FIELD_LIMITS,
  AI_PROVIDER_REQUEST_ID_LIMIT,
} from './storage-limits';
import { isSafeStoredText } from './unicode-text';

export class AnthropicMessageResponseError extends Error {}

type ParsedAnthropicMessage = {
  stopReason: string | null;
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  requestId: string | null;
  model: string | null;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalText(
  value: unknown,
  label: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    !isSafeStoredText(value) ||
    Array.from(value).length > maxLength
  )
    throw new AnthropicMessageResponseError(
      `${label} 형식이 올바르지 않습니다.`,
    );
  return value;
}

function tokenCount(value: unknown, label: string, required: boolean) {
  if (value === undefined && !required) return 0;
  if (!Number.isSafeInteger(value) || (value as number) < (required ? 1 : 0))
    throw new AnthropicMessageResponseError(
      `${label} 형식이 올바르지 않습니다.`,
    );
  return value as number;
}

export function parseAnthropicMessageResponse(
  value: unknown,
  options: { requireUsage?: boolean; responseRequestId?: unknown } = {},
): ParsedAnthropicMessage {
  if (!isObject(value))
    throw new AnthropicMessageResponseError(
      'Claude 응답 객체 형식이 올바르지 않습니다.',
    );

  const stopReason = optionalText(value.stop_reason, 'Claude 완료 사유', 100);
  const bodyRequestId = optionalText(
    value.request_id,
    'Claude 요청 식별값',
    AI_PROVIDER_REQUEST_ID_LIMIT,
  );
  const responseRequestId = optionalText(
    options.responseRequestId,
    'Claude 응답 헤더 요청 식별값',
    AI_PROVIDER_REQUEST_ID_LIMIT,
  );
  const model = optionalText(
    value.model,
    'Claude 응답 모델',
    AI_DIAGNOSIS_RUN_FIELD_LIMITS.model,
  );
  const content = value.content;
  const textBlocks: string[] = [];
  if (content !== undefined) {
    if (!Array.isArray(content))
      throw new AnthropicMessageResponseError(
        'Claude 응답 내용 형식이 올바르지 않습니다.',
      );
    for (const block of content) {
      if (
        !isObject(block) ||
        typeof block.type !== 'string' ||
        !block.type ||
        block.type.length > 100
      )
        throw new AnthropicMessageResponseError(
          'Claude 응답 블록 형식이 올바르지 않습니다.',
        );
      if (block.type !== 'text') continue;
      if (typeof block.text !== 'string')
        throw new AnthropicMessageResponseError(
          'Claude 텍스트 응답 형식이 올바르지 않습니다.',
        );
      textBlocks.push(block.text);
    }
  }
  const text = textBlocks.join('\n');
  if (text.length > 100_000)
    throw new AnthropicMessageResponseError(
      'Claude 텍스트 응답 허용 길이를 초과했습니다.',
    );

  const usage = value.usage;
  const requireUsage = options.requireUsage ?? true;
  if (
    (responseRequestId &&
      bodyRequestId &&
      responseRequestId !== bodyRequestId) ||
    (requireUsage && (!responseRequestId || !model))
  )
    throw new AnthropicMessageResponseError(
      'Claude 요청 식별값 형식이 올바르지 않습니다.',
    );
  if ((requireUsage || usage !== undefined) && !isObject(usage))
    throw new AnthropicMessageResponseError(
      'Claude 토큰 사용량 형식이 올바르지 않습니다.',
    );

  return {
    stopReason,
    text,
    usage: {
      inputTokens: tokenCount(
        usage?.input_tokens,
        'Claude 입력 토큰 수',
        requireUsage,
      ),
      outputTokens: tokenCount(
        usage?.output_tokens,
        'Claude 출력 토큰 수',
        requireUsage,
      ),
    },
    requestId: responseRequestId ?? bodyRequestId,
    model,
  };
}

export async function readAnthropicMessageResponse(response: Response) {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new AnthropicMessageResponseError(
      'Claude 응답을 JSON으로 읽지 못했습니다.',
    );
  }
  return parseAnthropicMessageResponse(value, {
    requireUsage: response.ok,
    responseRequestId: response.headers.get('request-id'),
  });
}
