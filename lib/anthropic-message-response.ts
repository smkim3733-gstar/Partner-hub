export class AnthropicMessageResponseError extends Error {}

type ParsedAnthropicMessage = {
  stopReason: string | null;
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  requestId: string | null;
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
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength)
    throw new AnthropicMessageResponseError(`${label} 형식이 올바르지 않습니다.`);
  return value;
}

function tokenCount(value: unknown, label: string) {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new AnthropicMessageResponseError(`${label} 형식이 올바르지 않습니다.`);
  return value as number;
}

export function parseAnthropicMessageResponse(
  value: unknown,
): ParsedAnthropicMessage {
  if (!isObject(value))
    throw new AnthropicMessageResponseError(
      'Claude 응답 객체 형식이 올바르지 않습니다.',
    );

  const stopReason = optionalText(value.stop_reason, 'Claude 완료 사유', 100);
  const requestId = optionalText(value.request_id, 'Claude 요청 식별값', 200);
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
  if (usage !== undefined && !isObject(usage))
    throw new AnthropicMessageResponseError(
      'Claude 토큰 사용량 형식이 올바르지 않습니다.',
    );

  return {
    stopReason,
    text,
    usage: {
      inputTokens: tokenCount(usage?.input_tokens, 'Claude 입력 토큰 수'),
      outputTokens: tokenCount(usage?.output_tokens, 'Claude 출력 토큰 수'),
    },
    requestId,
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
  return parseAnthropicMessageResponse(value);
}
