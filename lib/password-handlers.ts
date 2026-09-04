import { portalStateId } from '@/db/schema';
import { readPortalState } from '@/lib/portal-state';
import { requirePortalUser, PortalAccessError } from '@/lib/portal-auth';
import {
  defaultPartnerPermissions,
  membersRevisionOf,
  validatePartnerRegistration,
  type PartnerAccount,
} from '@/lib/partner-registration';
import { normalizeLoginEmail, isValidLoginEmail } from '@/lib/member-email';
import { passwordProblem } from '@/lib/password-policy';
import { PORTAL_STATE_LIMIT_BYTES } from '@/lib/pilot-readiness';
import { schedulePasswordLinkMetric } from '@/lib/password-link-metrics';
import {
  hashPassword,
  verifyPassword,
  opaqueToken,
  tokenHash,
} from '@/lib/password-crypto';
import {
  PasswordError,
  passwordBody,
  passwordDatabase,
  passwordResponse,
  passwordErrorResponse,
  limitAuthenticationAttempts,
  sessionCookie,
  sessionToken,
  sessionLifetimeSeconds,
} from '@/lib/password-store';

type State = { members: PartnerAccount[]; [key: string]: unknown };
type Account = {
  member_id: string;
  email: string;
  password_hash: string;
  credential_version: string;
};
const genericLoginError = '이메일 또는 비밀번호를 확인해 주세요.';
const existingAccountMessage =
  '이미 사용 중이거나 가입할 수 없는 이메일입니다. 기존 파트너는 대표님께 비밀번호 설정 링크를 요청해 주세요.';
const reservedEmails = new Set(['smkim3733@gmail.com', 'seedy@sites.test']);
function stateWithMembers(raw: unknown): State {
  if (!raw || !Array.isArray((raw as State).members))
    throw new PasswordError(
      '운영정보를 준비 중입니다. 대표님께 문의해 주세요.',
      503,
    );
  return raw as State;
}
function usableMember(state: State, id: string, email: string) {
  return state.members.find(
    (m) =>
      m.id === id &&
      normalizeLoginEmail(m.email) === email &&
      m.status !== '정지',
  );
}
function checkedPassword(value: unknown) {
  const problem = passwordProblem(value);
  if (problem) throw new PasswordError(problem);
  return value as string;
}
export function passwordHandler(
  action: (request: Request) => Promise<Response>,
) {
  return async (request: Request) => {
    try {
      return await action(request);
    } catch (error) {
      if (error instanceof PortalAccessError)
        return passwordResponse({ error: error.message }, error.status);
      return passwordErrorResponse(error);
    }
  };
}

export const registerPassword = passwordHandler(async (request) => {
  const body = await passwordBody(request);
  await limitAuthenticationAttempts(request, 'register');
  if (body.consent !== true)
    throw new PasswordError('가입정보 이용에 동의해 주세요.');
  const { value, errors } = validatePartnerRegistration({
    ...body,
    memberType: '기타',
    confirmed: true,
  });
  if (Object.keys(errors).length)
    throw new PasswordError(Object.values(errors)[0]!);
  const password = checkedPassword(body.password);
  if (reservedEmails.has(value.email))
    throw new PasswordError(existingAccountMessage, 409);
  await readPortalState();
  const db = await passwordDatabase();
  const encoded = hashPassword(password);
  const memberId = `partner-${crypto.randomUUID()}`;
  const version = crypto.randomUUID();
  const now = new Date().toISOString();
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await db
      .prepare('SELECT payload FROM portal_state WHERE id = ?1')
      .bind(portalStateId)
      .first<{ payload: string }>();
    const state = stateWithMembers(row ? JSON.parse(row.payload) : null);
    if (
      state.members.some((m) => normalizeLoginEmail(m.email) === value.email) ||
      (await db
        .prepare(
          'SELECT member_id FROM portal_password_accounts WHERE email = ?1',
        )
        .bind(value.email)
        .first())
    )
      throw new PasswordError(existingAccountMessage, 409);
    const member: PartnerAccount = {
      id: memberId,
      ...value,
      cohort: '',
      role: '일반 파트너',
      status: '승인대기',
      companies: 0,
      permissions: { ...defaultPartnerPermissions },
      registration: {
        method: 'self_password',
        requestId: version,
        createdBy: memberId,
        createdAt: now,
      },
    };
    const payload = JSON.stringify({
      ...state,
      members: [...state.members, member],
      membersRevision: membersRevisionOf(state) + 1,
    });
    if (new TextEncoder().encode(payload).length > PORTAL_STATE_LIMIT_BYTES)
      throw new PasswordError(
        '등록 저장 한도에 도달했습니다. 대표님께 문의해 주세요.',
        503,
      );
    // D1 batch is a transaction: the credential and pending roster entry are created together, or neither is created.
    const results = await db.batch([
      db
        .prepare(`INSERT INTO portal_password_accounts (member_id, email, password_hash, credential_version, created_at, updated_at)
        SELECT ?1, ?2, ?3, ?4, ?5, ?5 WHERE EXISTS (SELECT 1 FROM portal_state WHERE id = ?6 AND payload = ?7) ON CONFLICT DO NOTHING`)
        .bind(
          memberId,
          value.email,
          encoded,
          version,
          now,
          portalStateId,
          row!.payload,
        ),
      db
        .prepare(`UPDATE portal_state SET payload = ?1, updated_at = ?2 WHERE id = ?3 AND payload = ?4
        AND EXISTS (SELECT 1 FROM portal_password_accounts WHERE member_id = ?5 AND credential_version = ?6)`)
        .bind(payload, now, portalStateId, row!.payload, memberId, version),
    ]);
    if (results[1].meta.changes === 1)
      return passwordResponse(
        {
          message:
            '가입 신청이 접수되었습니다. 대표님이 연락처와 신청정보를 확인해 승인하면 이메일과 사이트 비밀번호로 로그인할 수 있습니다.',
        },
        201,
      );
  }
  throw new PasswordError(
    '다른 가입 신청을 처리 중입니다. 잠시 후 다시 시도해 주세요.',
    409,
  );
});

export const loginPassword = passwordHandler(async (request) => {
  const body = await passwordBody(request);
  const email =
    typeof body.email === 'string' ? normalizeLoginEmail(body.email) : '';
  await limitAuthenticationAttempts(request, 'login', {
    kind: 'email',
    value: email.slice(0, 254),
  });
  if (
    !isValidLoginEmail(email) ||
    email.length > 254 ||
    typeof body.password !== 'string' ||
    !body.password ||
    Array.from(body.password).length > 128
  )
    throw new PasswordError(genericLoginError, 401);
  const db = await passwordDatabase();
  const account = await db
    .prepare(
      'SELECT member_id, email, password_hash, credential_version FROM portal_password_accounts WHERE email = ?1',
    )
    .bind(email)
    .first<Account>();
  if (!verifyPassword(body.password, account?.password_hash) || !account)
    throw new PasswordError(genericLoginError, 401);
  const state = stateWithMembers(await readPortalState());
  const member = usableMember(state, account.member_id, email);
  if (!member || member.status !== '활성')
    throw new PasswordError(
      '대표 승인 전이거나 이용이 정지된 계정입니다. 대표님께 문의해 주세요.',
      403,
    );
  const token = opaqueToken();
  const now = Date.now();
  const previous = sessionToken(request);
  const results = await db.batch([
    db
      .prepare(
        'DELETE FROM portal_password_sessions WHERE expires_at <= ?1 OR token_hash = ?2',
      )
      .bind(now, previous ? tokenHash(previous) : ''),
    db
      .prepare(
        `INSERT INTO portal_password_sessions (token_hash, member_id, email, credential_version, expires_at)
        SELECT ?1, ?2, ?3, ?4, ?5
        WHERE EXISTS (SELECT 1 FROM portal_password_accounts a
          WHERE a.member_id = ?2 AND a.email = ?3 AND a.credential_version = ?4)
          AND EXISTS (SELECT 1 FROM portal_state s, json_each(s.payload, '$.members') m
          WHERE s.id = ?6 AND json_extract(m.value, '$.id') = ?2
          AND lower(trim(json_extract(m.value, '$.email'))) = ?3
          AND json_extract(m.value, '$.status') = '활성')`,
      )
      .bind(
        tokenHash(token),
        account.member_id,
        email,
        account.credential_version,
        now + sessionLifetimeSeconds * 1000,
        portalStateId,
      ),
  ]);
  if (results[1].meta.changes !== 1)
    throw new PasswordError(
      '계정 상태나 비밀번호가 변경되었습니다. 다시 확인해 주세요.',
      403,
    );
  return passwordResponse({ ok: true }, 200, sessionCookie(request, token));
});

export const logoutPassword = passwordHandler(async (request) => {
  await passwordBody(request);
  const token = sessionToken(request);
  if (token)
    await (
      await passwordDatabase()
    )
      .prepare('DELETE FROM portal_password_sessions WHERE token_hash = ?1')
      .bind(tokenHash(token))
      .run();
  return passwordResponse({ ok: true }, 200, sessionCookie(request, '', true));
});

export const createPasswordLink = passwordHandler(async (request) => {
  const body = await passwordBody(request);
  const state = stateWithMembers(await readPortalState());
  const actor = await requirePortalUser(request, state);
  if (actor.role !== 'admin')
    throw new PasswordError(
      '대표 관리자만 비밀번호 설정 링크를 발급할 수 있습니다.',
      403,
    );
  if (body.confirmed !== true)
    throw new PasswordError('기존 연락처로 본인을 확인한 후 발급해 주세요.');
  const member = state.members.find(
    (m) => m.id === body.memberId && m.status !== '정지',
  );
  if (
    !member ||
    !isValidLoginEmail(member.email) ||
    reservedEmails.has(normalizeLoginEmail(member.email))
  )
    throw new PasswordError('설정 가능한 파트너를 확인해 주세요.');
  await limitAuthenticationAttempts(request, 'setup-link');
  const db = await passwordDatabase();
  const token = opaqueToken();
  const memberEmail = normalizeLoginEmail(member.email);
  const nowTime = Date.now();
  const expiresAt = nowTime + 30 * 60_000;
  const priorLink = await db
    .prepare(
      'SELECT expires_at, consumed_by FROM portal_password_links WHERE member_id = ?1 ORDER BY created_at DESC LIMIT 1',
    )
    .bind(member.id)
    .first<{ expires_at: number; consumed_by: string | null }>()
    .catch((error) => {
      console.error(
        'Failed to classify prior password link',
        error instanceof Error ? error.name : 'unknown',
      );
      return null;
    });
  const replacesActive =
    Boolean(priorLink) &&
    priorLink!.consumed_by == null &&
    Number(priorLink!.expires_at) > nowTime;
  const replacesExpired =
    Boolean(priorLink) &&
    priorLink!.consumed_by == null &&
    Number(priorLink!.expires_at) <= nowTime;
  const results = await db.batch([
    db
      .prepare(
        `DELETE FROM portal_password_links WHERE (member_id = ?1 OR expires_at <= ?2)
        AND EXISTS (SELECT 1 FROM portal_state s, json_each(s.payload, '$.members') m
          WHERE s.id = ?3 AND json_extract(m.value, '$.id') = ?1
          AND lower(trim(json_extract(m.value, '$.email'))) = ?4
          AND json_extract(m.value, '$.status') != '정지')`,
      )
      .bind(member.id, nowTime, portalStateId, memberEmail),
    db
      .prepare(
        `INSERT INTO portal_password_links (token_hash, member_id, email, expires_at, created_by, created_at)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6
        WHERE EXISTS (SELECT 1 FROM portal_state s, json_each(s.payload, '$.members') m
          WHERE s.id = ?7 AND json_extract(m.value, '$.id') = ?2
          AND lower(trim(json_extract(m.value, '$.email'))) = ?3
          AND json_extract(m.value, '$.status') != '정지')`,
      )
      .bind(
        tokenHash(token),
        member.id,
        memberEmail,
        expiresAt,
        actor.id,
        new Date().toISOString(),
        portalStateId,
      ),
  ]);
  if (results[1].meta.changes !== 1)
    throw new PasswordError(
      '계정 정보가 변경되었습니다. 최신 명단을 확인한 후 다시 발급해 주세요.',
      409,
    );
  schedulePasswordLinkMetric({
    issued: 1,
    activeReplacement: replacesActive ? 1 : 0,
    expiredAtReissue: replacesExpired ? 1 : 0,
  });
  // Fragment keeps the one-time bearer secret out of HTTP requests, access logs and Referer headers.
  return passwordResponse(
    { path: `/account/setup#token=${token}`, expiresAt },
    201,
  );
});

export const setupPassword = passwordHandler(async (request) => {
  const body = await passwordBody(request);
  await limitAuthenticationAttempts(request, 'setup');
  const password = checkedPassword(body.password);
  if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token))
    throw new PasswordError(
      '설정 링크가 유효하지 않습니다. 대표님께 새 링크를 요청해 주세요.',
    );
  const db = await passwordDatabase();
  const digest = tokenHash(body.token);
  const nowTime = Date.now();
  const link = await db
    .prepare(
      'SELECT member_id, email, expires_at, consumed_by FROM portal_password_links WHERE token_hash = ?1',
    )
    .bind(digest)
    .first<{
      member_id: string;
      email: string;
      expires_at: number;
      consumed_by: string | null;
    }>();
  const state = stateWithMembers(await readPortalState());
  const observedExpired =
    Boolean(link) &&
    link!.consumed_by == null &&
    Number(link!.expires_at) <= nowTime;
  if (
    !link ||
    Number(link.expires_at) <= nowTime ||
    !usableMember(state, link.member_id, link.email)
  ) {
    if (observedExpired)
      schedulePasswordLinkMetric({ observedExpiredAttempt: 1 });
    throw new PasswordError(
      '설정 링크가 만료되었거나 계정이 변경되었습니다. 대표님께 새 링크를 요청해 주세요.',
    );
  }
  const encoded = hashPassword(password);
  const version = crypto.randomUUID();
  const now = new Date().toISOString();
  // Guard against approval/email changes between the read above and redemption, and against double redemption.
  const results = await db.batch([
    db
      .prepare(`INSERT INTO portal_password_accounts (member_id, email, password_hash, credential_version, created_at, updated_at)
      SELECT l.member_id, l.email, ?1, ?2, ?3, ?3 FROM portal_password_links l
      WHERE l.token_hash = ?4 AND l.consumed_by IS NULL AND l.expires_at > ?5
        AND EXISTS (SELECT 1 FROM portal_state s, json_each(s.payload, '$.members') m
          WHERE s.id = ?6 AND json_extract(m.value, '$.id') = l.member_id
          AND lower(trim(json_extract(m.value, '$.email'))) = l.email AND json_extract(m.value, '$.status') != '정지')
      ON CONFLICT(member_id) DO UPDATE SET email = excluded.email, password_hash = excluded.password_hash,
        credential_version = excluded.credential_version, updated_at = excluded.updated_at`)
      .bind(encoded, version, now, digest, nowTime, portalStateId),
    db
      .prepare(`UPDATE portal_password_links SET consumed_by = ?1 WHERE token_hash = ?2 AND consumed_by IS NULL
      AND EXISTS (SELECT 1 FROM portal_password_accounts a WHERE a.member_id = portal_password_links.member_id AND a.credential_version = ?1)`)
      .bind(version, digest),
    db
      .prepare(
        `DELETE FROM portal_password_sessions WHERE member_id = ?1 AND EXISTS (SELECT 1 FROM portal_password_accounts WHERE member_id = ?1 AND credential_version = ?2)`,
      )
      .bind(link.member_id, version),
  ]);
  if (results[1].meta.changes !== 1)
    throw new PasswordError(
      '이미 사용했거나 만료된 설정 링크입니다. 대표님께 새 링크를 요청해 주세요.',
    );
  schedulePasswordLinkMetric({ redeemed: 1 });
  return passwordResponse({
    message:
      '사이트 비밀번호가 설정되었습니다. 대표 승인 완료 계정은 이메일과 새 비밀번호로 로그인할 수 있습니다.',
  });
});
