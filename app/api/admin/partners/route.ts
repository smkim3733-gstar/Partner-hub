import { requirePortalUser, PortalAccessError } from '@/lib/portal-auth';
import {
  readPortalState,
  mutatePortalState,
  PortalStateConflict,
} from '@/lib/portal-state';
import { assertSameOrigin } from '@/lib/consulting-flow-store';
import { FlowError } from '@/lib/consulting-flow';
import {
  defaultPartnerPermissions,
  membersRevisionOf,
  validatePartnerRegistration,
  type PartnerAccount,
} from '@/lib/partner-registration';
import {
  issuePortalConflictReceipt,
  PORTAL_CONFLICT_RECEIPT_TTL_SECONDS,
  schedulePortalConflictRecovery,
  schedulePortalSaveConflict,
} from '@/lib/portal-conflict-metrics';
import { portalConflictReceiptFromRequest } from '@/lib/portal-conflict-receipt';
import {
  scheduleDuplicateRequestMetric,
  type DuplicateRequestOutcome,
} from '@/lib/duplicate-request-metrics';
import { JsonRequestError, readBoundedJsonObject } from '@/lib/request-json';
import { privateJsonResponse } from '@/lib/private-response';
import { isReservedPortalOwnerEmail } from '@/lib/member-email';
import {
  passwordCredentialEmailConflictMessage,
  passwordCredentialEmailReserved,
} from '@/lib/password-store';

export const dynamic = 'force-dynamic';
const response = (data: unknown, status = 200) =>
  privateJsonResponse(data, { status });

export async function POST(request: Request) {
  const presentedReceipt = portalConflictReceiptFromRequest(request);
  let duplicateOutcome: DuplicateRequestOutcome | null = null;
  const observeDuplicateOnce = () => {
    if (!duplicateOutcome) return;
    scheduleDuplicateRequestMetric({
      source: 'admin_partner_registration',
      outcome: duplicateOutcome,
    });
    duplicateOutcome = null;
  };
  try {
    assertSameOrigin(request);
    const actor = await requirePortalUser(request, await readPortalState());
    if (actor.role !== 'admin')
      throw new PortalAccessError(
        '파트너 직접등록은 대표 관리자만 할 수 있습니다.',
        403,
      );
    const body = await readBoundedJsonObject(request, 12_000);
    const { value, errors } = validatePartnerRegistration(body);
    if (Object.keys(errors).length)
      return response({ error: '입력 항목을 확인해 주세요.', errors }, 400);
    if (isReservedPortalOwnerEmail(value.email) || value.email === actor.email)
      return response(
        {
          error: '대표 관리자 이메일은 파트너로 중복 등록할 수 없습니다.',
          errors: { email: '파트너 본인의 로그인 이메일을 입력해 주세요.' },
        },
        409,
      );
    if (
      typeof body.requestId !== 'string' ||
      !/^[a-zA-Z0-9_-]{16,100}$/.test(body.requestId)
    )
      return response({ error: '등록 요청번호를 확인해 주세요.' }, 400);
    const requestId = body.requestId;
    const id = `partner-${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    let registered: PartnerAccount;
    let replayed = false;
    const result = await mutatePortalState(async (raw) => {
      duplicateOutcome = null;
      const currentUser = await requirePortalUser(request, raw);
      if (currentUser.role !== 'admin')
        throw new PortalAccessError('대표 관리자만 등록할 수 있습니다.', 403);
      const state = raw as {
        members?: PartnerAccount[];
        [key: string]: unknown;
      } | null;
      if (!state || !Array.isArray(state.members))
        throw new FlowError('운영정보를 먼저 불러온 후 등록해 주세요.', 503);
      const prior = state.members.find(
        (m) => m.registration?.requestId === requestId,
      );
      if (prior) {
        if (
          prior.registration?.createdBy !== actor.id ||
          Object.entries(value).some(
            ([key, val]) => prior[key as keyof PartnerAccount] !== val,
          )
        ) {
          duplicateOutcome = 'request_key_conflict';
          throw new FlowError(
            '이 요청번호로 이미 다른 내용이 등록되었습니다. 명단을 확인해 주세요.',
            409,
          );
        }
        duplicateOutcome = 'safe_retry';
        registered = prior;
        replayed = true;
        return state;
      }
      if (await passwordCredentialEmailReserved(value.email)) {
        duplicateOutcome = 'existing_record_blocked';
        throw new FlowError(passwordCredentialEmailConflictMessage, 409);
      }
      if (
        state.members.some((m) => m.email.trim().toLowerCase() === value.email)
      ) {
        duplicateOutcome = 'existing_record_blocked';
        throw new FlowError(
          '이미 등록된 이메일입니다. 기존 계정을 검색해 확인해 주세요.',
          409,
        );
      }
      registered = {
        id,
        ...value,
        cohort: '',
        role: '일반 파트너',
        status: '활성',
        companies: 0,
        permissions: { ...defaultPartnerPermissions },
        registration: {
          method: 'admin',
          requestId,
          createdAt,
          createdBy: actor.id,
        },
      };
      replayed = false;
      return {
        ...state,
        members: [...state.members, registered],
        membersRevision: membersRevisionOf(state) + 1,
      };
    });
    observeDuplicateOnce();
    schedulePortalConflictRecovery({
      token: presentedReceipt,
      source: 'admin_partner_registration',
      actorRole: 'admin',
    });
    return response(
      {
        member: registered!,
        members: result.state.members,
        membersRevision: membersRevisionOf(result.state),
        replayed,
      },
      replayed ? 200 : 201,
    );
  } catch (error) {
    if (error instanceof PortalAccessError || error instanceof FlowError) {
      observeDuplicateOnce();
      return response({ error: error.message }, error.status);
    }
    if (error instanceof PortalStateConflict) {
      const metric = {
        source: 'admin_partner_registration',
        kind: error.kind,
        actorRole: 'admin',
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
      return response(
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
        409,
      );
    }
    if (error instanceof JsonRequestError)
      return response({ error: error.message }, error.status);
    console.error(
      'Partner registration failed',
      error instanceof Error ? error.name : 'unknown',
    );
    return response(
      {
        error:
          '등록 여부를 명단에서 먼저 확인해 주세요. 확인 후 같은 내용으로 다시 시도할 수 있습니다.',
      },
      500,
    );
  }
}
