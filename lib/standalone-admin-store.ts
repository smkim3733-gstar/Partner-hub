import { randomUUID } from 'node:crypto';
import { PORTAL_OWNER_EMAIL, normalizeLoginEmail } from './member-email';
import {
  passwordProblem,
  standaloneAdminPasswordProblem,
} from './password-policy';
import {
  hashPassword,
  verifyPassword,
  opaqueToken,
  tokenHash,
} from './password-crypto';

// DB-only core for independent Next authentication and interactive provisioning.
// No public bootstrap endpoint, Sites bindings, environment secrets or mock DB.
export const standaloneAdminId = 'primary-admin';
export const standaloneAdminLifetimeSeconds = 60 * 60;
export type StandaloneAdminIdentity = {
  id: string;
  email: string;
  displayName: string;
};
type Account = {
  id: string;
  email: string;
  password_hash: string;
  credential_version: string;
  active: number;
};

export async function provisionStandaloneAdmin(
  db: D1Database,
  input: { email: string; password: string; deployment?: 'local' | 'remote' },
) {
  if (
    input.deployment !== undefined &&
    input.deployment !== 'local' &&
    input.deployment !== 'remote'
  )
    throw new Error('관리자 설정 대상을 확인해 주세요.');
  const label = input.deployment === 'remote' ? '운영' : '로컬';
  if (normalizeLoginEmail(input.email) !== PORTAL_OWNER_EMAIL)
    throw new Error(
      `현재 지정된 대표 이메일로만 ${label} 관리자를 설정할 수 있습니다.`,
    );
  const problem =
    input.deployment === 'remote'
      ? standaloneAdminPasswordProblem(input.password)
      : passwordProblem(input.password);
  if (problem) throw new Error(problem);
  const version = randomUUID();
  const now = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(`INSERT INTO standalone_admin_accounts
      (id, email, display_name, password_hash, credential_version, created_at, updated_at)
      VALUES (?1, ?2, ?6, ?3, ?4, ?5, ?5) ON CONFLICT DO NOTHING`)
      .bind(
        standaloneAdminId,
        PORTAL_OWNER_EMAIL,
        hashPassword(input.password),
        version,
        now,
        input.deployment === 'remote' ? '대표 관리자' : '대표 관리자(로컬)',
      ),
    db
      .prepare(`INSERT INTO standalone_admin_audit (id, admin_id, action, created_at)
      SELECT ?1, ?2, 'provision', ?3 WHERE EXISTS
      (SELECT 1 FROM standalone_admin_accounts WHERE id = ?2 AND credential_version = ?4)`)
      .bind(randomUUID(), standaloneAdminId, now, version),
  ]);
  if (results[0].meta.changes !== 1)
    throw new Error(
      `${label} 관리자가 이미 설정되어 있습니다. 기존 자격증명은 변경하지 않았습니다.`,
    );
}

export function standaloneAdminRevocations(
  db: D1Database,
  token: string | null,
  action: 'logout' | 'switch' = 'logout',
): D1PreparedStatement[] {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return [];
  const digest = tokenHash(token);
  return [
    db
      .prepare(`INSERT INTO standalone_admin_audit (id, admin_id, action, created_at)
      SELECT ?1, admin_id, ?2, ?3 FROM standalone_admin_sessions WHERE token_hash = ?4`)
      .bind(randomUUID(), action, new Date().toISOString(), digest),
    db
      .prepare('DELETE FROM standalone_admin_sessions WHERE token_hash = ?1')
      .bind(digest),
  ];
}

export async function issueStandaloneAdminSession(
  db: D1Database,
  email: string,
  password: string,
  previous: string | null,
): Promise<string | null> {
  const account = await db
    .prepare(`SELECT id, email, password_hash, credential_version, active
    FROM standalone_admin_accounts WHERE id = ?1 AND email = ?2`)
    .bind(standaloneAdminId, PORTAL_OWNER_EMAIL)
    .first<Account>();
  const valid = verifyPassword(password, account?.password_hash);
  if (
    !valid ||
    !account ||
    account.active !== 1 ||
    email !== PORTAL_OWNER_EMAIL
  )
    return null;
  const token = opaqueToken();
  const digest = tokenHash(token);
  const priorHash =
    previous && /^[a-f0-9]{64}$/.test(previous) ? tokenHash(previous) : '';
  const now = Date.now();
  // Credential changes racing password verification cannot create a usable session.
  // Rotate the same cookie across partner/admin roles and revoke its previous DB row.
  const results = await db.batch([
    db
      .prepare(`INSERT INTO standalone_admin_sessions
      (token_hash, admin_id, credential_version, issued_at, expires_at)
      SELECT ?1, id, credential_version, ?2, ?3 FROM standalone_admin_accounts
      WHERE id = ?4 AND email = ?5 AND credential_version = ?6 AND password_hash = ?7 AND active = 1`)
      .bind(
        digest,
        now,
        now + standaloneAdminLifetimeSeconds * 1000,
        account.id,
        email,
        account.credential_version,
        account.password_hash,
      ),
    db
      .prepare(`DELETE FROM portal_password_sessions WHERE token_hash = ?1
      AND EXISTS (SELECT 1 FROM standalone_admin_sessions WHERE token_hash = ?2)`)
      .bind(priorHash, digest),
    db
      .prepare(`DELETE FROM standalone_admin_sessions WHERE (token_hash = ?1 OR expires_at <= ?2)
      AND EXISTS (SELECT 1 FROM standalone_admin_sessions WHERE token_hash = ?3)`)
      .bind(priorHash, now, digest),
    db
      .prepare(`INSERT INTO standalone_admin_audit (id, admin_id, action, created_at)
      SELECT ?1, admin_id, 'login', ?2 FROM standalone_admin_sessions WHERE token_hash = ?3`)
      .bind(randomUUID(), new Date(now).toISOString(), digest),
  ]);
  return results[0].meta.changes === 1 ? token : null;
}

export async function readStandaloneAdminIdentity(
  db: D1Database,
  token: string | null,
): Promise<StandaloneAdminIdentity | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return db
    .prepare(`SELECT a.id, a.email, a.display_name AS "displayName"
    FROM standalone_admin_sessions s JOIN standalone_admin_accounts a
    ON a.id = s.admin_id AND a.credential_version = s.credential_version
    WHERE s.token_hash = ?1 AND s.issued_at <= ?2 AND s.expires_at > ?2
    AND a.active = 1 AND a.id = ?3 AND a.email = ?4`)
    .bind(tokenHash(token), Date.now(), standaloneAdminId, PORTAL_OWNER_EMAIL)
    .first<StandaloneAdminIdentity>();
}
