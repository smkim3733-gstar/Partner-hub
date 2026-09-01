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
  PORTAL_CONFLICT_RECEIPT_HEADER,
  PORTAL_CONFLICT_RECEIPT_TTL_SECONDS,
  schedulePortalConflictRecovery,
  schedulePortalSaveConflict,
} from '@/lib/portal-conflict-metrics';

export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'private, no-store' };
const response = (data: unknown, status = 200) =>
  Response.json(data, { status, headers });

export async function POST(request: Request) {
  const presentedReceipt = request.headers.get(PORTAL_CONFLICT_RECEIPT_HEADER);
  try {
    const actor = await requirePortalUser(request, await readPortalState());
    if (actor.role !== 'admin')
      throw new PortalAccessError(
        '파트너 직접등록은 대표 관리자만 할 수 있습니다.',
        403,
      );
    assertSameOrigin(request);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return response({ error: 'JSON 형식으로 요청해 주세요.' }, 415);
    const text = await request.text();
    if (!text || new TextEncoder().encode(text).length > 12_000)
      return response({ error: '등록 요청 크기를 확인해 주세요.' }, 413);
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return response({ error: '등록정보 형식을 확인해 주세요.' }, 400);
    const { value, errors } = validatePartnerRegistration(body);
    if (Object.keys(errors).length)
      return response({ error: '입력 항목을 확인해 주세요.', errors }, 400);
    if (value.email === actor.email)
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
    const id = `partner-${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    let registered: PartnerAccount;
    let replayed = false;
    const result = await mutatePortalState(async (raw) => {
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
        (m) => m.registration?.requestId === body.requestId,
      );
      if (prior) {
        if (
          prior.registration?.createdBy !== actor.id ||
          Object.entries(value).some(
            ([key, val]) => prior[key as keyof PartnerAccount] !== val,
          )
        )
          throw new FlowError(
            '이 요청번호로 이미 다른 내용이 등록되었습니다. 명단을 확인해 주세요.',
            409,
          );
        registered = prior;
        replayed = true;
        return state;
      }
      if (
        state.members.some((m) => m.email.trim().toLowerCase() === value.email)
      )
        throw new FlowError(
          '이미 등록된 이메일입니다. 기존 계정을 검색해 확인해 주세요.',
          409,
        );
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
          requestId: body.requestId,
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
    if (error instanceof PortalAccessError || error instanceof FlowError)
      return response({ error: error.message }, error.status);
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
    if (error instanceof SyntaxError)
      return response({ error: '등록 요청 형식이 올바르지 않습니다.' }, 400);
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
