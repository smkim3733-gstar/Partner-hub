export class JsonRequestError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 413 | 415,
  ) {
    super(message);
  }
}

function requestError(status: 400 | 413 | 415): never {
  throw new JsonRequestError(
    status === 413
      ? '요청 데이터의 크기가 허용 범위를 초과했습니다.'
      : status === 415
        ? 'JSON 형식의 요청이 필요합니다.'
        : '요청 형식이 올바르지 않습니다.',
    status,
  );
}

export async function readBoundedJsonObject(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get('content-type') ?? '',
    )
  )
    requestError(415);

  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const normalized = declaredLength.trim();
    if (!/^\d+$/.test(normalized)) requestError(400);
    if (Number(normalized) > maxBytes) requestError(413);
  }

  const reader = request.body?.getReader();
  if (!reader) requestError(400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      requestError(413);
    }
    chunks.push(part.value);
  }
  if (!size) requestError(400);

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    requestError(400);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    requestError(400);
  return parsed as Record<string, unknown>;
}
