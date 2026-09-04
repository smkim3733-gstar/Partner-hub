export class HeaderRequestError extends Error {
  readonly status = 400;
}

function readHeader(
  request: Request,
  name: string,
  maxLength: number,
  message: string,
) {
  const value = request.headers.get(name);
  if (value === null) return null;
  if (value.length === 0 || value.length > maxLength)
    throw new HeaderRequestError(message);
  return value;
}

export function readIfMatchRevision(request: Request) {
  const message = '저장 기준 버전을 확인해 주세요.';
  const value = readHeader(request, 'if-match', 66, message);
  if (value === null) return null;
  const match = /^(?:"([a-f0-9]{64})"|([a-f0-9]{64}))$/.exec(value);
  if (!match) throw new HeaderRequestError(message);
  return match[1] ?? match[2];
}

export function readIdempotencyKey(request: Request) {
  const message = '업로드 요청 식별값이 올바르지 않습니다.';
  const value = readHeader(request, 'idempotency-key', 128, message);
  if (value === null) return null;
  if (value.length < 10 || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new HeaderRequestError(message);
  return value;
}
