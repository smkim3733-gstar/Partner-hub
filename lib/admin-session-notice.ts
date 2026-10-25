// Administrator logins expire one hour after login (security design, see
// `standaloneAdminLifetimeSeconds`). The screen warns shortly before that so
// work can be saved, and explains how to keep on-screen work after expiry.

export const ADMIN_SESSION_WARNING_MS = 10 * 60 * 1000;

export type AdminSessionNotice =
  | { kind: 'none' }
  | { kind: 'warning'; minutesLeft: number }
  | { kind: 'expired' };

/** What to tell the administrator, given the login deadline (epoch ms). */
export function adminSessionNotice(
  deadline: number | null,
  now: number,
): AdminSessionNotice {
  if (deadline === null || !Number.isFinite(deadline)) return { kind: 'none' };
  const left = deadline - now;
  if (left <= 0) return { kind: 'expired' };
  if (left > ADMIN_SESSION_WARNING_MS) return { kind: 'none' };
  return { kind: 'warning', minutesLeft: Math.max(1, Math.ceil(left / 60000)) };
}

/** Login deadline (epoch ms) from a server "seconds left" value. */
export function adminSessionDeadline(
  expiresInSeconds: unknown,
  now: number,
): number | null {
  return Number.isSafeInteger(expiresInSeconds) &&
    (expiresInSeconds as number) >= 0
    ? now + (expiresInSeconds as number) * 1000
    : null;
}

/**
 * Asks the server how long the administrator login has left. Returns the new
 * deadline, `'signed-out'` when no administrator login is live, or `null` when
 * the answer is unknown (network or server trouble).
 */
export async function readAdminSessionDeadline(
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<number | 'signed-out' | null> {
  try {
    const response = await fetcher('/api/auth/admin-session', {
      cache: 'no-store',
    });
    if (response.status === 401 || response.status === 403)
      return 'signed-out';
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      sessionExpiresInSeconds?: unknown;
    } | null;
    return adminSessionDeadline(payload?.sessionExpiresInSeconds, now());
  } catch {
    return null;
  }
}
