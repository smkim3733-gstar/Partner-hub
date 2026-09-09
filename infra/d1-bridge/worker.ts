import { timingSafeEqual } from 'node:crypto';
import {
  D1HttpError,
  d1HttpPath,
  d1HttpLimits,
  isD1HttpSecret,
  isRecord,
  readD1HttpJson,
  validateD1HttpStatements,
} from '../../lib/d1-http-protocol';

export type D1BridgeEnvironment = {
  DB: D1Database;
  D1_BRIDGE_ENABLED?: string;
  D1_BRIDGE_SECRET?: string;
};
function reply(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'private, no-store, max-age=0',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      // No CORS or browser access to this privileged database connection.
    },
  });
}
export async function handleD1Bridge(
  request: Request,
  env: D1BridgeEnvironment,
): Promise<Response> {
  if (env.D1_BRIDGE_ENABLED !== '1' || !isD1HttpSecret(env.D1_BRIDGE_SECRET))
    return reply({ code: 'D1_HTTP_UNAVAILABLE' }, 503);
  const url = new URL(request.url);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !loopback)
    return reply({ code: 'D1_HTTP_AUTH_FAILED' }, 401);
  const candidate = request.headers
    .get('authorization')
    ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (
    !candidate ||
    !timingSafeEqual(
      new TextEncoder().encode(candidate),
      new TextEncoder().encode(env.D1_BRIDGE_SECRET),
    )
  )
    return reply({ code: 'D1_HTTP_AUTH_FAILED' }, 401);
  // End-user cookies / Sites headers never serve as database credentials.
  if (request.headers.has('origin') || request.headers.has('cookie'))
    return reply({ code: 'D1_HTTP_AUTH_FAILED' }, 403);
  if (url.pathname !== d1HttpPath || url.search)
    return reply({ code: 'D1_HTTP_INVALID_INPUT' }, 404);
  if (request.method !== 'POST')
    return reply({ code: 'D1_HTTP_INVALID_INPUT' }, 405);
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get('content-type') ?? '',
    ) ||
    request.headers.has('content-encoding')
  )
    return reply({ code: 'D1_HTTP_INVALID_INPUT' }, 415);
  const length = request.headers.get('content-length');
  if (
    length !== null &&
    (!/^\d+$/.test(length) || Number(length) > d1HttpLimits.requestBytes)
  )
    return reply({ code: 'D1_HTTP_INVALID_INPUT' }, 413);
  let statements;
  try {
    const body = await readD1HttpJson(request.body, d1HttpLimits.requestBytes);
    if (
      !isRecord(body) ||
      body.version !== 1 ||
      Object.keys(body).sort().join(',') !== 'statements,version'
    )
      throw new D1HttpError('D1_HTTP_INVALID_INPUT');
    statements = validateD1HttpStatements(body.statements);
  } catch {
    return reply({ code: 'D1_HTTP_INVALID_INPUT' }, 400);
  }
  let results;
  try {
    // One wire batch = one native D1 transaction, in original order. No split or
    // retry. Direct binding uses the primary, avoiding stale authorization reads.
    results = await env.DB.batch(
      statements.map(({ sql, params }) => env.DB.prepare(sql).bind(...params)),
    );
  } catch {
    // A SQL constraint failure rolls back. A binding/transport failure may be
    // ambiguous, so never promise a rollback solely from an exception.
    // Never expose SQL/parameters/constraint text or invite an automatic retry.
    return reply({ version: 1, ok: false, code: 'D1_HTTP_OUTCOME_UNKNOWN' });
  }
  const serialized = JSON.stringify({ version: 1, ok: true, results });
  if (new TextEncoder().encode(serialized).length > d1HttpLimits.responseBytes)
    // Queries may already have committed; callers MUST NOT automatically replay.
    return reply({ code: 'D1_HTTP_OUTCOME_UNKNOWN' }, 502);
  return new Response(serialized, {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'private, no-store, max-age=0',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}
// Intentionally no deploy config or resource IDs. Validate in isolation first.
const worker = { fetch: handleD1Bridge };
export default worker;
