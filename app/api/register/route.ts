import {
  isReservedPortalOwnerEmail,
  isValidLoginEmail,
} from '@/lib/member-email';
import { mutatePortalState, PortalStateConflict } from '@/lib/portal-state';
import { membersRevisionOf } from '@/lib/partner-registration';
import { assertSameOrigin } from '@/lib/consulting-flow-store';
import { FlowError } from '@/lib/consulting-flow';
import {
  issuePortalConflictReceipt,
  PORTAL_CONFLICT_RECEIPT_TTL_SECONDS,
  schedulePortalConflictRecovery,
  schedulePortalSaveConflict,
} from '@/lib/portal-conflict-metrics';
import { portalConflictReceiptFromRequest } from '@/lib/portal-conflict-receipt';
import { JsonRequestError, readBoundedJsonObject } from '@/lib/request-json';
import { chatGPTIdentityFromRequest } from '@/lib/request-auth';
import { privateJsonResponse } from '@/lib/private-response';
import {
  limitAuthenticationAttempts,
  PasswordError,
  chatGPTIdentityConflictMessage,
  chatGPTMemberBindingStatements,
  chatGPTMemberBindingStatus,
  passwordCredentialEmailConflictMessage,
  passwordCredentialEmailReserved,
} from '@/lib/password-store';

const MAX_REQUEST_BYTES = 12_000;

type RegistrationMember = {
  id: string;
  name: string;
  phone?: string;
  affiliation?: string;
  email: string;
  cohort: string;
  memberType?: string;
  role: '교육생' | '리더 교육생' | '일반 파트너' | '리더 파트너';
  status: '활성' | '승인대기' | '초대대기' | '정지';
  companies: number;
  permissions: {
    sharedSchedule: boolean;
    collaborationApply: boolean;
    ownCases: boolean;
    fileUpload: boolean;
    quoteContract: boolean;
  };
  [key: string]: unknown;
};

type RegistrationState = {
  members: RegistrationMember[];
  [key: string]: unknown;
};

function asRegistrationState(value: unknown): RegistrationState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const state = value as Partial<RegistrationState>;
  return Array.isArray(state.members) ? (state as RegistrationState) : null;
}

function normalizedText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function registrationError(
  name: string,
  phone: string,
  affiliation: string,
  email: string,
) {
  if (name.length < 2 || name.length > 40)
    return '이름은 2자 이상 40자 이하로 입력해 주세요.';
  if (!/^[0-9+()\-\s.]{7,24}$/.test(phone))
    return '연락처를 숫자와 하이픈을 사용해 정확히 입력해 주세요.';
  if (affiliation.length < 2 || affiliation.length > 80)
    return '소속은 2자 이상 80자 이하로 입력해 주세요.';
  if (!isValidLoginEmail(email)) return '올바른 이메일 형식으로 입력해 주세요.';
  return '';
}

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const presentedReceipt = portalConflictReceiptFromRequest(request);
  try {
    assertSameOrigin(request);
    const identity = chatGPTIdentityFromRequest(request);
    if (!identity) {
      return privateJsonResponse(
        { error: 'ChatGPT 로그인 후 등록을 신청해 주세요.' },
        { status: 401 },
      );
    }
    await limitAuthenticationAttempts(request, 'chatgpt-register', {
      kind: 'identity',
      value: identity.id,
    });
    const body = await readBoundedJsonObject(request, MAX_REQUEST_BYTES);
    const name = normalizedText(body.name);
    const phone = normalizedText(body.phone);
    const affiliation = normalizedText(body.affiliation);
    const email = normalizedText(body.email).toLowerCase();
    const fieldError = registrationError(name, phone, affiliation, email);
    if (fieldError)
      return privateJsonResponse({ error: fieldError }, { status: 400 });
    if (email !== identity.email) {
      return privateJsonResponse(
        {
          error: '현재 ChatGPT 로그인 이메일과 신청 이메일이 일치해야 합니다.',
        },
        { status: 403 },
      );
    }
    if (isReservedPortalOwnerEmail(email)) {
      return privateJsonResponse(
        { error: '대표 관리자 이메일은 파트너 등록에 사용할 수 없습니다.' },
        { status: 409 },
      );
    }

    let binding: {
      memberId: string;
      needsInsert: boolean;
      createdAt: string;
    } | null = null;
    await mutatePortalState(
      async (rawState) => {
        const state = asRegistrationState(rawState);
        if (!state) {
          throw new FlowError(
            '파트너 운영정보가 준비되지 않았습니다. 관리자에게 문의해 주세요.',
            503,
          );
        }

        const existingIndexes = state.members.reduce<number[]>(
          (indexes, member, index) => {
            if (
              typeof member.email === 'string' &&
              member.email.trim().toLowerCase() === email
            )
              indexes.push(index);
            return indexes;
          },
          [],
        );
        if (existingIndexes.length > 1)
          throw new FlowError(chatGPTIdentityConflictMessage, 409);
        const existingIndex = existingIndexes[0] ?? -1;
        const existing =
          existingIndex >= 0 ? state.members[existingIndex] : null;
        if (existing?.status === '활성') {
          throw new FlowError(
            '이미 활성화된 파트너 계정입니다. 화면을 새로고침해 주세요.',
            409,
          );
        }
        if (existing?.status === '정지') {
          throw new FlowError(
            '이용이 정지된 계정입니다. 대표님께 문의해 주세요.',
            403,
          );
        }
        if (await passwordCredentialEmailReserved(email, existing?.id))
          throw new FlowError(passwordCredentialEmailConflictMessage, 409);
        const memberId = existing?.id ?? `partner-${crypto.randomUUID()}`;
        const bindingStatus = await chatGPTMemberBindingStatus(
          identity.id,
          memberId,
        );
        if (bindingStatus === 'conflict')
          throw new FlowError(chatGPTIdentityConflictMessage, 409);
        binding = {
          memberId,
          needsInsert: bindingStatus === 'available',
          createdAt: new Date().toISOString(),
        };

        const pendingMember: RegistrationMember = {
          ...existing,
          id: memberId,
          name,
          phone,
          affiliation,
          email,
          cohort: existing?.cohort ?? '',
          role: existing?.role ?? '일반 파트너',
          status: '승인대기',
          companies: existing?.companies ?? 0,
          permissions: existing?.permissions ?? {
            sharedSchedule: true,
            collaborationApply: true,
            ownCases: true,
            fileUpload: true,
            quoteContract: false,
          },
        };

        if (
          existing?.status === '승인대기' &&
          existing.name === pendingMember.name &&
          existing.phone === pendingMember.phone &&
          existing.affiliation === pendingMember.affiliation &&
          existing.email === pendingMember.email
        )
          return state;

        const nextMembers = [...state.members];
        if (existingIndex >= 0) nextMembers[existingIndex] = pendingMember;
        else nextMembers.push(pendingMember);
        return {
          ...state,
          members: nextMembers,
          membersRevision: membersRevisionOf(state) + 1,
        };
      },
      undefined,
      (db, committedPayload) =>
        binding?.needsInsert
          ? chatGPTMemberBindingStatements(
              db,
              identity.id,
              binding.memberId,
              committedPayload,
              binding.createdAt,
            )
          : [],
    );

    schedulePortalConflictRecovery({
      token: presentedReceipt,
      source: 'public_registration',
      actorRole: 'unauthenticated',
    });
    return privateJsonResponse({ ok: true, status: '승인대기' });
  } catch (error) {
    if (error instanceof PasswordError)
      return privateJsonResponse(
        { error: error.message },
        {
          status: error.status,
          headers: error.status === 429 ? { 'retry-after': '900' } : {},
        },
      );
    if (error instanceof JsonRequestError)
      return privateJsonResponse(
        { error: error.message },
        { status: error.status },
      );
    if (error instanceof FlowError)
      return privateJsonResponse(
        { error: error.message },
        { status: error.status },
      );
    if (error instanceof PortalStateConflict) {
      const metric = {
        source: 'public_registration',
        kind: error.kind,
        actorRole: 'unauthenticated',
      } as const;
      schedulePortalSaveConflict(metric);
      const recoveryReceipt = await issuePortalConflictReceipt(metric).catch(
        (receiptError) => {
          console.error(
            'Failed to issue portal conflict receipt',
            receiptError instanceof Error ? receiptError.name : 'unknown',
          );
          return null;
        },
      );
      return privateJsonResponse(
        {
          error: error.message,
          ...(recoveryReceipt
            ? {
                recoveryReceipt,
                recoveryReceiptExpiresInSeconds:
                  PORTAL_CONFLICT_RECEIPT_TTL_SECONDS,
              }
            : {}),
        },
        { status: 409 },
      );
    }
    console.error(
      'Failed to submit partner registration',
      error instanceof Error ? error.name : 'unknown',
    );
    return privateJsonResponse(
      { error: '등록 신청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 500 },
    );
  }
}
