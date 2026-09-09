import 'server-only';
import { PORTAL_OWNER_EMAIL } from './member-email';
import { supabaseBackendConfig } from './supabase-backend-config.server';
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
import {
  nextBackendRequestAllowed,
} from './next-backend-config';

function checkConfigured(request: Request) {
  const config = supabaseBackendConfig();
  if (!nextBackendRequestAllowed(request, config))
    throw new PasswordError(
      '설정된 보안 사이트에서 다시 요청해 주세요.',
      403,
    );
}

export async function loginStandaloneAdmin(
  request: Request,
  email: string,
  password: string,
) {
  supabaseBackendConfig();
  if (email !== PORTAL_OWNER_EMAIL) return null;
  checkConfigured(request);
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
  supabaseBackendConfig();
  checkConfigured(request);
  const token = sessionToken(request);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return readStandaloneAdminIdentity(await passwordDatabase(), token);
}

export function standaloneAdminRevocationStatements(
  db: D1Database,
  token: string | null,
  action: 'logout' | 'switch',
) {
  if (!token) return [];
  supabaseBackendConfig();
  return standaloneAdminRevocations(db, token, action);
}
