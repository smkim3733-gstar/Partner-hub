type JsonObject = Record<string, unknown>;

export type PasswordLinkResult = { path: string; expiresAt: number };

export class PasswordLinkResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'PasswordLinkResponseError';
  }
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function boundedText(value: unknown, maxLength: number) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

export async function readPasswordLinkResponse(
  response: Response,
  now = Date.now(),
): Promise<PasswordLinkResult> {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new PasswordLinkResponseError(
      '링크 발급 응답을 읽지 못했습니다. 계정 상태를 확인한 후 다시 시도해 주세요.',
      response.status,
    );
  }

  const payload = asObject(raw);
  if (!response.ok)
    throw new PasswordLinkResponseError(
      boundedText(payload?.error, 1_000)
        ? (payload?.error as string)
        : '링크를 발급하지 못했습니다.',
      response.status,
    );

  if (
    response.status !== 201 ||
    !payload ||
    typeof payload.path !== 'string' ||
    !/^\/account\/setup#token=[a-f0-9]{64}$/.test(payload.path) ||
    !Number.isSafeInteger(payload.expiresAt) ||
    Number(payload.expiresAt) <= now ||
    Number(payload.expiresAt) > now + 31 * 60_000
  )
    throw new PasswordLinkResponseError(
      '링크 발급 응답 형식이 올바르지 않습니다. 계정 상태를 확인한 후 다시 시도해 주세요.',
      response.status,
    );

  return {
    path: payload.path,
    expiresAt: payload.expiresAt as number,
  };
}
