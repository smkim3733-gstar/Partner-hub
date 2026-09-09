import { timingSafeEqual } from 'node:crypto';
import {
  R2HttpError,
  r2HttpPath,
  r2RequestHeader,
  r2ObjectHeader,
  isR2HttpSecret,
  decodeR2Header,
  encodeR2Header,
  parseR2Request,
  nativeR2PutOptions,
  encodeR2Object,
  readR2Bytes,
} from '../../lib/r2-http-protocol';

export type R2BridgeEnvironment = {
  AI_SOURCE_FILES: R2Bucket;
  R2_BRIDGE_ENABLED?: string;
  R2_BRIDGE_SECRET?: string;
};
function headers() {
  return new Headers({
    'x-partner-hub-r2-version': '1',
    'cache-control': 'private, no-store, max-age=0',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
}
function failure(code: string, status: number) {
  return Response.json({ version: 1, code }, { status, headers: headers() });
}
export async function handleR2Bridge(
  request: Request,
  env: R2BridgeEnvironment,
): Promise<Response> {
  if (env.R2_BRIDGE_ENABLED !== '1' || !isR2HttpSecret(env.R2_BRIDGE_SECRET))
    return failure('R2_HTTP_UNAVAILABLE', 503);
  const url = new URL(request.url);
  const candidate = request.headers
    .get('authorization')
    ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (
    (url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      )) ||
    !candidate ||
    !timingSafeEqual(
      new TextEncoder().encode(candidate),
      new TextEncoder().encode(env.R2_BRIDGE_SECRET),
    )
  )
    return failure('R2_HTTP_AUTH_FAILED', 401);
  // A distinct server credential, never an end-user cookie or browser ticket.
  if (request.headers.has('origin') || request.headers.has('cookie'))
    return failure('R2_HTTP_AUTH_FAILED', 403);
  if (url.pathname !== r2HttpPath || url.search)
    return failure('R2_HTTP_INVALID_INPUT', 404);
  if (request.method !== 'POST') return failure('R2_HTTP_INVALID_INPUT', 405);
  if (
    request.headers.get('content-type') !== 'application/octet-stream' ||
    request.headers.has('content-encoding')
  )
    return failure('R2_HTTP_INVALID_INPUT', 415);
  let operation;
  let bytes;
  try {
    operation = parseR2Request(
      decodeR2Header(request.headers.get(r2RequestHeader)),
    );
    const size = operation.operation === 'put' ? operation.size : 0;
    const length = request.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) !== size))
      throw new R2HttpError('R2_HTTP_INVALID_INPUT');
    // Validate bounded input completely before the first side effect. The
    // ArrayBuffer also preserves known-length semantics through local Wrangler.
    bytes = await readR2Bytes(request.body, size);
    if (bytes.byteLength !== size)
      throw new R2HttpError('R2_HTTP_INVALID_INPUT');
  } catch {
    return failure('R2_HTTP_INVALID_INPUT', 400);
  }
  try {
    if (operation.operation === 'delete') {
      await env.AI_SOURCE_FILES.delete(operation.key);
      return new Response(null, { status: 204, headers: headers() });
    }
    const object =
      operation.operation === 'put'
        ? await env.AI_SOURCE_FILES.put(
            operation.key,
            bytes,
            nativeR2PutOptions(operation.options),
          )
        : operation.operation === 'get'
          ? await env.AI_SOURCE_FILES.get(operation.key)
          : await env.AI_SOURCE_FILES.head(operation.key);
    if (object === null)
      return operation.operation === 'put'
        ? failure('R2_HTTP_PRECONDITION_FAILED', 412)
        : failure('R2_HTTP_NOT_FOUND', 404);
    const responseHeaders = headers();
    responseHeaders.set(r2ObjectHeader, encodeR2Header(encodeR2Object(object)));
    responseHeaders.set('content-type', 'application/octet-stream');
    if (operation.operation === 'get') {
      if (!('body' in object)) throw new Error();
      responseHeaders.set('content-length', String(object.size));
      return new Response((object as R2ObjectBody).body, {
        headers: responseHeaders,
      });
    }
    return new Response(null, { headers: responseHeaders });
  } catch {
    // A lost acknowledgement can follow a committed put/delete. Never retry,
    // claim absence, or delete a possibly committed object as compensation.
    return failure('R2_HTTP_OUTCOME_UNKNOWN', 502);
  }
}
// No resource identifiers or deployment configuration until cutover validation.
const worker = { fetch: handleR2Bridge };
export default worker;
