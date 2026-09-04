export const PRIVATE_RESPONSE_CACHE_CONTROL = 'private, no-store, max-age=0';

export function privateResponseHeaders(headers?: HeadersInit) {
  const result = new Headers(headers);
  result.set('cache-control', PRIVATE_RESPONSE_CACHE_CONTROL);
  result.set('expires', '0');
  result.set('pragma', 'no-cache');
  result.set('referrer-policy', 'no-referrer');
  result.set('x-content-type-options', 'nosniff');
  return result;
}

export function privateJsonResponse(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, {
    ...init,
    headers: privateResponseHeaders(init.headers),
  });
}
