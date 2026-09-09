import 'server-only';
import { PORTAL_OWNER_EMAIL } from './member-email';
import { nextLocalStorageEnabled } from './next-local-storage-policy.mjs';
import {
  PasswordError,
  assertPasswordOrigin,
  passwordDatabase,
  sessionToken,
  sessionCookie,
} from '@/lib/password-store';
import {
  issueStandaloneAdminSession,
  readStandaloneAdminIdentity,
  standaloneAdminRevocations,
  standaloneAdminLifetimeSeconds,
} from './standalone-admin-store';

// Selected only by opted-in Next dev; a second guard prevents accidental reuse.
export async function loginStandaloneAdmin(
  request: Request,
  email: string,
  password: string,
) {
  if (!nextLocalStorageEnabled(process.env) || email !== PORTAL_OWNER_EMAIL)
    return null;
  assertPasswordOrigin(request);
  const token = await issueStandaloneAdminSession(
    await passwordDatabase(),
    email,
    password,
    sessionToken(request),
  );
  if (!token)
    throw new PasswordError('이메일 또는 비밀번호를 확인해 주세요.', 401);
  return {
    cookie: sessionCookie(
      request,
      token,
      false,
      standaloneAdminLifetimeSeconds,
    ),
  };
}
export async function standaloneAdminIdentity(request: Request) {
  if (!nextLocalStorageEnabled(process.env)) return null;
  const token = sessionToken(request);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const identity = await readStandaloneAdminIdentity(
    await passwordDatabase(),
    token,
  );
  if (identity && !['GET', 'HEAD', 'OPTIONS'].includes(request.method))
    assertPasswordOrigin(request);
  return identity;
}
export function standaloneAdminRevocationStatements(
  db: D1Database,
  token: string | null,
  action: 'logout' | 'switch',
) {
  return nextLocalStorageEnabled(process.env)
    ? standaloneAdminRevocations(db, token, action)
    : [];
}
