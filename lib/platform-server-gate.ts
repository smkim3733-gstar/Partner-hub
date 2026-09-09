// Existing Sites and isolated local modes retain their route-owned checks.
export function serverRequestGate(_request: Request): Response | null {
  return null;
}
