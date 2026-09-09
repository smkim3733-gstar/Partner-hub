// Sites and local Next retain their existing rate-limit trust boundary.
export function platformRateLimitClientKey(_request: Request): string | null {
  return null;
}
