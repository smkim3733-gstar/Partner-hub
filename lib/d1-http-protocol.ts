// Private server-to-server protocol, never a browser API or a SQL migration API.
export const d1HttpPath = '/internal/d1/v1/batch';
export const d1HttpLimits = {
  requestBytes: 8 * 1024 * 1024,
  responseBytes: 8 * 1024 * 1024,
  statements: 256,
  sqlBytes: 100_000,
  parameters: 100,
} as const;
export type D1HttpValue = string | number | null;
export type D1HttpStatement = { sql: string; params: D1HttpValue[] };
export type D1HttpCode =
  | 'D1_HTTP_INVALID_INPUT'
  | 'D1_HTTP_UNAVAILABLE'
  | 'D1_HTTP_AUTH_FAILED'
  | 'D1_HTTP_OUTCOME_UNKNOWN'
  | 'D1_HTTP_UNSUPPORTED';

export class D1HttpError extends Error {
  constructor(public readonly code: D1HttpCode) {
    // Never carry SQL, parameters, endpoint credentials or upstream errors.
    super(code);
    this.name = 'D1HttpError';
  }
}
export function isD1HttpSecret(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function validateD1HttpStatements(value: unknown): D1HttpStatement[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > d1HttpLimits.statements
  )
    throw new D1HttpError('D1_HTTP_INVALID_INPUT');
  for (const item of value) {
    if (
      !isRecord(item) ||
      Object.keys(item).sort().join(',') !== 'params,sql' ||
      typeof item.sql !== 'string' ||
      !item.sql.trim() ||
      item.sql.includes('\0') ||
      new TextEncoder().encode(item.sql).length > d1HttpLimits.sqlBytes ||
      !Array.isArray(item.params) ||
      item.params.length > d1HttpLimits.parameters ||
      item.params.some(
        (value) =>
          value !== null &&
          typeof value !== 'string' &&
          !(typeof value === 'number' && Number.isFinite(value)),
      )
    )
      throw new D1HttpError('D1_HTTP_INVALID_INPUT');
  }
  return value as D1HttpStatement[];
}
export async function readD1HttpJson(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<unknown> {
  if (!body) throw new D1HttpError('D1_HTTP_INVALID_INPUT');
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new D1HttpError('D1_HTTP_INVALID_INPUT');
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new D1HttpError('D1_HTTP_INVALID_INPUT');
  }
}
