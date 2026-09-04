export function isCrossSiteRequest(request: Request) {
  const origin = request.headers.get('origin');
  return (
    (origin !== null && origin !== new URL(request.url).origin) ||
    request.headers.get('sec-fetch-site')?.trim().toLowerCase() === 'cross-site'
  );
}
