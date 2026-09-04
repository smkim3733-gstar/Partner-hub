export function isCrossSiteRequest(request: Request) {
  const origin = request.headers.get('origin');
  return (
    // Mutation callers must prove same-origin; a missing Origin is not proof.
    origin !== new URL(request.url).origin ||
    request.headers.get('sec-fetch-site')?.trim().toLowerCase() === 'cross-site'
  );
}
