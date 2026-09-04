export class MultipartRequestError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 413 | 415,
  ) {
    super(message);
  }
}

function requestError(status: 400 | 413 | 415): never {
  throw new MultipartRequestError(
    status === 413
      ? '첨부 용량이 허용 범위를 초과했습니다.'
      : status === 415
        ? '멀티파트 형식의 요청이 필요합니다.'
        : '파일 업로드 요청을 읽지 못했습니다.',
    status,
  );
}

export function isMultipartFormDataContentType(value: string) {
  return /^multipart\/form-data(?:\s*;|$)/i.test(value);
}

export async function readBoundedMultipartFormData(
  request: Request,
  maxBytes: number,
) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!isMultipartFormDataContentType(contentType)) requestError(415);

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

  try {
    return await new Response(bytes, {
      headers: { 'content-type': contentType },
    }).formData();
  } catch {
    requestError(400);
  }
}
