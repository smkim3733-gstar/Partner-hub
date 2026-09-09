// Operator-only DB workflow. Never import from a public route or auth handler.
import { randomUUID } from 'node:crypto';
import { PORTAL_OWNER_EMAIL, normalizeLoginEmail } from './member-email';
import { standaloneAdminId } from './standalone-admin-store';
import { hashPassword, tokenHash, verifyPassword } from './password-crypto';
import { passwordProblem } from './password-policy';

export type RecoveryReason =
  | 'lost-password'
  | 'credential-compromise'
  | 'rotation';
export class AdminRecoveryError extends Error {
  constructor(
    public readonly code: 'INPUT' | 'ACCOUNT' | 'STALE' | 'REUSED_PASSWORD',
  ) {
    super(`ADMIN_RECOVERY_${code}`);
  }
}
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export async function recoverStandaloneAdmin(
  db: D1Database,
  input: {
    email: string;
    password: string;
    expectedCredentialVersion: string;
    recoveryId: string;
    reason: RecoveryReason;
  },
) {
  if (
    normalizeLoginEmail(input.email) !== PORTAL_OWNER_EMAIL ||
    passwordProblem(input.password) ||
    !uuid.test(input.expectedCredentialVersion) ||
    !uuid.test(input.recoveryId) ||
    !['lost-password', 'credential-compromise', 'rotation'].includes(
      input.reason,
    )
  )
    throw new AdminRecoveryError('INPUT');
  const account = await db
    .prepare(`SELECT password_hash, credential_version, active
    FROM standalone_admin_accounts WHERE id = ?1 AND email = ?2`)
    .bind(standaloneAdminId, PORTAL_OWNER_EMAIL)
    .first<{
      password_hash: string;
      credential_version: string;
      active: number;
    }>();
  // Recovery does not create accounts, change identity or reactivate a suspended account.
  if (!account || account.active !== 1) throw new AdminRecoveryError('ACCOUNT');
  if (account.credential_version !== input.expectedCredentialVersion)
    throw new AdminRecoveryError('STALE');
  if (verifyPassword(input.password, account.password_hash))
    throw new AdminRecoveryError('REUSED_PASSWORD');
  const nextVersion = randomUUID();
  const now = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(`UPDATE standalone_admin_accounts
      SET password_hash = ?1, credential_version = ?2, updated_at = ?3
      WHERE id = ?4 AND email = ?5 AND active = 1
      AND credential_version = ?6 AND password_hash = ?7`)
      .bind(
        hashPassword(input.password),
        nextVersion,
        now,
        standaloneAdminId,
        PORTAL_OWNER_EMAIL,
        input.expectedCredentialVersion,
        account.password_hash,
      ),
    db
      .prepare(`DELETE FROM standalone_admin_sessions WHERE admin_id = ?1
      AND EXISTS (SELECT 1 FROM standalone_admin_accounts
        WHERE id = ?1 AND credential_version = ?2)`)
      .bind(standaloneAdminId, nextVersion),
    db
      .prepare(`INSERT INTO standalone_admin_recovery_audit
      (id, admin_id, reason, previous_version_hash, next_version_hash, created_at)
      SELECT ?1, id, ?2, ?3, ?4, ?5 FROM standalone_admin_accounts
      WHERE id = ?6 AND credential_version = ?7`)
      .bind(
        input.recoveryId,
        input.reason,
        tokenHash(input.expectedCredentialVersion),
        tokenHash(nextVersion),
        now,
        standaloneAdminId,
        nextVersion,
      ),
  ]);
  if (results[0].meta.changes !== 1) throw new AdminRecoveryError('STALE');
  return {
    recoveryId: input.recoveryId,
    revokedSessions: results[1].meta.changes,
  };
}
