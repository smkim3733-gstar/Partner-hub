import { env } from 'cloudflare:workers';
import { portalPasswordSchemaSql, portalStateId } from '@/db/schema';
import { normalizeLoginEmail } from '@/lib/member-email';
import { tokenHash } from '@/lib/password-crypto';
import { isCrossSiteRequest } from '@/lib/request-origin';
import { JsonRequestError, readBoundedJsonObject } from '@/lib/request-json';
import { rateLimitClientKey, readSessionCookieToken } from '@/lib/request-auth';
import { privateJsonResponse } from '@/lib/private-response';

export class PasswordError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}
export async function passwordDatabase() {
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) throw new PasswordError('계정 저장소를 사용할 수 없습니다.', 503);
  await db.batch(portalPasswordSchemaSql.map((sql) => db.prepare(sql)));
  return db;
}
export function assertPasswordOrigin(request: Request) {
  const url = new URL(request.url);
  if (
    url.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    throw new PasswordError('보안 연결(HTTPS)에서 로그인해 주세요.', 403);
  if (
    request.headers.get('origin') !== url.origin ||
    isCrossSiteRequest(request)
  )
    throw new PasswordError('현재 사이트에서 다시 요청해 주세요.', 403);
}
export async function passwordBody(
  request: Request,
): Promise<Record<string, unknown>> {
  assertPasswordOrigin(request);
  try {
    return await readBoundedJsonObject(request, 12_000);
  } catch (error) {
    if (error instanceof JsonRequestError)
      throw new PasswordError(
        error.status === 413
          ? '입력 내용이 너무 깁니다.'
          : error.status === 415
            ? 'JSON 형식의 요청이 필요합니다.'
            : '입력 내용을 확인해 주세요.',
        error.status,
      );
    throw error;
  }
}
export function passwordResponse(data: unknown, status = 200, cookie?: string) {
  return privateJsonResponse(data, {
    status,
    headers: {
      ...(cookie ? { 'set-cookie': cookie } : {}),
      ...(status === 429 ? { 'retry-after': '900' } : {}),
    },
  });
}
export function passwordErrorResponse(error: unknown) {
  if (error instanceof PasswordError)
    return passwordResponse({ error: error.message }, error.status);
  // Never log requests, password values, raw credential records, or setup tokens.
  console.error(
    'Password account request failed',
    error instanceof Error ? error.name : 'unknown',
  );
  return passwordResponse(
    { error: '처리 결과를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
    503,
  );
}
export async function limitAuthenticationAttempts(
  request: Request,
  purpose: string,
  subject?: { kind: 'email' | 'identity'; value: string },
) {
  const db = await passwordDatabase();
  const now = Date.now();
  const until = now + 15 * 60_000;
  // This header is supplied by Cloudflare at the edge; do not trust client-supplied X-Forwarded-For.
  const ip = rateLimitClientKey(request);
  const buckets: [string, number][] = [
    [`${purpose}:ip:${ip}`, purpose === 'register' ? 8 : 30],
  ];
  if (subject) buckets.push([`${purpose}:${subject.kind}:${subject.value}`, 8]);
  await db
    .prepare('DELETE FROM portal_auth_limits WHERE expires_at < ?1')
    .bind(now)
    .run();
  for (const [key, max] of buckets) {
    const row = await db
      .prepare(`INSERT INTO portal_auth_limits (key_hash, attempts, expires_at) VALUES (?1, 1, ?2)
      ON CONFLICT(key_hash) DO UPDATE SET attempts = portal_auth_limits.attempts + 1 RETURNING attempts`)
      .bind(tokenHash(key), until)
      .first<{ attempts: number }>();
    if (!row || row.attempts > max)
      throw new PasswordError(
        '요청이 많습니다. 15분 후 다시 시도해 주세요.',
        429,
      );
  }
}

type PasswordAccessMember = {
  id?: unknown;
  email?: unknown;
  status?: unknown;
};

function passwordAccessMembers(state: unknown): PasswordAccessMember[] {
  const members = (state as { members?: unknown } | null)?.members;
  return Array.isArray(members) ? members : [];
}

export const passwordCredentialEmailConflictMessage =
  '이 이메일에는 다른 사이트 비밀번호 자격이 남아 있습니다. 이메일을 확인하거나 기존 자격을 정리한 뒤 다시 시도해 주세요.';

async function passwordCredentialEmailOwner(
  db: D1Database,
  email: string,
) {
  const row = await db
    .prepare(
      'SELECT member_id FROM portal_password_accounts WHERE email = ?1',
    )
    .bind(email)
    .first<{ member_id: string }>();
  return row?.member_id ?? null;
}

export async function passwordCredentialEmailReserved(
  email: string,
  allowedMemberId?: string,
) {
  const normalizedEmail = normalizeLoginEmail(email);
  if (!normalizedEmail) return false;
  const owner = await passwordCredentialEmailOwner(
    await passwordDatabase(),
    normalizedEmail,
  );
  return owner !== null && owner !== allowedMemberId;
}

export async function passwordCredentialEmailConflictForStateChange(
  currentState: unknown,
  nextState: unknown,
) {
  const currentById = new Map(
    passwordAccessMembers(currentState)
      .filter((member) => typeof member.id === 'string')
      .map((member) => [member.id as string, member]),
  );
  const candidates = passwordAccessMembers(nextState).flatMap((member) => {
    if (typeof member.id !== 'string' || typeof member.email !== 'string')
      return [];
    const email = normalizeLoginEmail(member.email);
    if (!email) return [];
    const current = currentById.get(member.id);
    const currentEmail =
      typeof current?.email === 'string'
        ? normalizeLoginEmail(current.email)
        : '';
    if (current && currentEmail === email) return [];
    return [{ email, allowedMemberId: current ? member.id : undefined }];
  });
  if (candidates.length === 0) return false;
  const db = await passwordDatabase();
  for (const candidate of candidates) {
    const owner = await passwordCredentialEmailOwner(db, candidate.email);
    if (owner !== null && owner !== candidate.allowedMemberId) return true;
  }
  return false;
}

export function passwordAccessRevocationForStateChange(
  currentState: unknown,
  nextState: unknown,
) {
  const nextById = new Map(
    passwordAccessMembers(nextState)
      .filter((member) => typeof member.id === 'string')
      .map((member) => [member.id as string, member]),
  );
  const sessionMemberIds = new Set<string>();
  const setupLinkMemberIds = new Set<string>();
  const credentialMemberIds = new Set<string>();
  for (const member of passwordAccessMembers(currentState)) {
    if (typeof member.id !== 'string') continue;
    const next = nextById.get(member.id);
    const currentEmail =
      typeof member.email === 'string' ? normalizeLoginEmail(member.email) : '';
    const nextEmail =
      typeof next?.email === 'string' ? normalizeLoginEmail(next.email) : '';
    const identityChanged = !next || currentEmail !== nextEmail;
    const statusChanged = member.status !== next?.status;
    if (identityChanged || statusChanged) sessionMemberIds.add(member.id);
    if (identityChanged || member.status === '정지' || next?.status === '정지')
      setupLinkMemberIds.add(member.id);
    if (identityChanged) credentialMemberIds.add(member.id);
  }
  return {
    sessionMemberIds: [...sessionMemberIds],
    setupLinkMemberIds: [...setupLinkMemberIds],
    credentialMemberIds: [...credentialMemberIds],
  };
}

export function passwordAccessRevocationStatements(
  db: D1Database,
  revocation: {
    sessionMemberIds: readonly string[];
    setupLinkMemberIds: readonly string[];
    credentialMemberIds: readonly string[];
  },
  committedPortalPayload: string,
) {
  const sessionMemberIds = [
    ...new Set(revocation.sessionMemberIds.filter(Boolean)),
  ];
  const setupLinkMemberIds = [
    ...new Set(revocation.setupLinkMemberIds.filter(Boolean)),
  ];
  const credentialMemberIds = [
    ...new Set(revocation.credentialMemberIds.filter(Boolean)),
  ];
  if (
    sessionMemberIds.length === 0 &&
    setupLinkMemberIds.length === 0 &&
    credentialMemberIds.length === 0
  )
    return [];
  const committed = `EXISTS (SELECT 1 FROM portal_state WHERE id = ?2 AND payload = ?3)`;
  return [
    ...portalPasswordSchemaSql.map((sql) => db.prepare(sql)),
    ...sessionMemberIds.map((memberId) =>
      db
        .prepare(
          `DELETE FROM portal_password_sessions WHERE member_id = ?1 AND ${committed}`,
        )
        .bind(memberId, portalStateId, committedPortalPayload),
    ),
    ...setupLinkMemberIds.map((memberId) =>
      db
        .prepare(
          `DELETE FROM portal_password_links WHERE member_id = ?1 AND ${committed}`,
        )
        .bind(memberId, portalStateId, committedPortalPayload),
    ),
    ...credentialMemberIds.map((memberId) =>
      db
        .prepare(
          `DELETE FROM portal_password_accounts WHERE member_id = ?1 AND ${committed}`,
        )
        .bind(memberId, portalStateId, committedPortalPayload),
    ),
  ];
}

function cookieName(request: Request) {
  return new URL(request.url).protocol === 'https:'
    ? '__Host-keve_session'
    : 'keve_local_session';
}
export function sessionToken(request: Request): string | null {
  return readSessionCookieToken(request, cookieName(request));
}
export const sessionLifetimeSeconds = 12 * 60 * 60;
export function sessionCookie(request: Request, token: string, clear = false) {
  return `${cookieName(request)}=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : sessionLifetimeSeconds}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export async function passwordIdentity(request: Request) {
  const token = sessionToken(request);
  if (token === null) return null;
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new PasswordError('다시 로그인해 주세요.', 401);
  const db = await passwordDatabase();
  const row = await db
    .prepare(`SELECT s.member_id, s.email FROM portal_password_sessions s
    JOIN portal_password_accounts a ON a.member_id = s.member_id AND a.credential_version = s.credential_version AND a.email = s.email
    WHERE s.token_hash = ?1 AND s.expires_at > ?2`)
    .bind(tokenHash(token), Date.now())
    .first<{ member_id: string; email: string }>();
  if (!row)
    throw new PasswordError(
      '로그인이 만료되었습니다. 다시 로그인해 주세요.',
      401,
    );
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method))
    assertPasswordOrigin(request);
  return row;
}
