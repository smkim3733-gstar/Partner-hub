type JsonObject = Record<string, unknown>;

export type PasswordAuthAction = 'login' | 'register' | 'setup' | 'logout';
export type PasswordAuthResult = { ok: true } | { message: string };

export class PasswordAuthResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'PasswordAuthResponseError';
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

const labels: Record<PasswordAuthAction, string> = {
  login: '로그인',
  register: '가입 신청',
  setup: '비밀번호 설정',
  logout: '로그아웃',
};

const expectedStatuses: Record<PasswordAuthAction, number> = {
  login: 200,
  register: 201,
  setup: 200,
  logout: 200,
};

export async function readPasswordAuthResponse(
  response: Response,
  action: PasswordAuthAction,
): Promise<PasswordAuthResult> {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new PasswordAuthResponseError(
      `${labels[action]} 응답을 읽지 못했습니다. 연결을 확인한 후 다시 시도해 주세요.`,
      response.status,
    );
  }

  const payload = asObject(raw);
  if (!response.ok)
    throw new PasswordAuthResponseError(
      boundedText(payload?.error, 1_000)
        ? (payload?.error as string)
        : '요청을 처리하지 못했습니다.',
      response.status,
    );

  if (response.status !== expectedStatuses[action] || !payload)
    throw new PasswordAuthResponseError(
      `${labels[action]} 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.`,
      response.status,
    );

  if (action === 'login' || action === 'logout') {
    if (payload.ok !== true)
      throw new PasswordAuthResponseError(
        `${labels[action]} 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.`,
        response.status,
      );
    return { ok: true };
  }

  if (!boundedText(payload.message, 1_000))
    throw new PasswordAuthResponseError(
      `${labels[action]} 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.`,
      response.status,
    );
  return { message: payload.message as string };
}
