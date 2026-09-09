import type { StandaloneAdminIdentity } from './standalone-admin-store';

// Sites and production Next never enable the local standalone administrator.
export async function loginStandaloneAdmin(
  _request: Request,
  _email: string,
  _password: string,
): Promise<{ cookie: string } | null> {
  return null;
}
export async function standaloneAdminIdentity(
  _request: Request,
): Promise<StandaloneAdminIdentity | null> {
  return null;
}
export function standaloneAdminRevocationStatements(
  _db: D1Database,
  _token: string | null,
  _action: 'logout' | 'switch',
): D1PreparedStatement[] {
  return [];
}
