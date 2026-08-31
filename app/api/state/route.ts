import {
  readPortalLoginStats,
  readPortalState,
  recordPortalLogin,
  mutatePortalState,
  PortalStateConflict,
} from '@/lib/portal-state';
import {
  assertSameOrigin,
  stateWithConsultingFlows,
} from '@/lib/consulting-flow-store';
import { FlowError } from '@/lib/consulting-flow';
import {
  ApplicationDetailsError,
  preserveApplicationDetails,
} from '@/lib/application-details';
import {
  membersRevisionOf,
  sameMemberRecords,
} from '@/lib/partner-registration';
import {
  mergeStateForPortalUser,
  PortalAccessError,
  requirePortalUser,
  stateForPortalUser,
  stateWithPortalLoginStats,
} from '@/lib/portal-auth';

const MAX_STATE_BYTES = 900_000;
const privateJson = (data: unknown, init?: ResponseInit) =>
  Response.json(data, {
    ...init,
    headers: { 'cache-control': 'private, no-store' },
  });

export const dynamic = 'force-dynamic';

function accessErrorResponse(error: unknown, request: Request) {
  if (error instanceof PortalAccessError) {
    const authenticatedEmail =
      error.status === 403
        ? request.headers
            .get('oai-authenticated-user-email')
            ?.trim()
            .toLowerCase()
        : undefined;
    return privateJson(
      { error: error.message, authenticatedEmail },
      { status: error.status },
    );
  }
  return null;
}

export async function GET(request: Request) {
  try {
    const rawState = await readPortalState();
    const currentUser = await requirePortalUser(request, rawState);
    const state = await stateWithConsultingFlows(rawState);
    if (currentUser.role === 'trainee' && currentUser.memberId) {
      await recordPortalLogin(currentUser.memberId);
    }
    const responseState =
      currentUser.role === 'admin'
        ? stateWithPortalLoginStats(state, await readPortalLoginStats())
        : stateForPortalUser(state, currentUser);
    return privateJson({ state: responseState, currentUser });
  } catch (error) {
    const accessResponse = accessErrorResponse(error, request);
    if (accessResponse) return accessResponse;
    console.error('Failed to read portal state', error);
    return privateJson(
      { error: '저장된 운영 데이터를 불러오지 못했습니다.' },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    await requirePortalUser(request, await readPortalState());
    assertSameOrigin(request);
    const bodyText = await request.text();
    if (
      !bodyText ||
      new TextEncoder().encode(bodyText).byteLength > MAX_STATE_BYTES
    ) {
      return privateJson(
        { error: '저장 데이터의 크기가 허용 범위를 초과했습니다.' },
        { status: 413 },
      );
    }

    const body = JSON.parse(bodyText) as {
      state?: unknown;
      expectedUserId?: unknown;
    } | null;
    if (
      !body?.state ||
      typeof body.state !== 'object' ||
      Array.isArray(body.state)
    ) {
      return privateJson(
        { error: '저장할 운영 데이터 형식이 올바르지 않습니다.' },
        { status: 400 },
      );
    }

    const result = await mutatePortalState(async (currentState) => {
      const currentUser = await requirePortalUser(request, currentState);
      if (
        body.expectedUserId !== undefined &&
        body.expectedUserId !== currentUser.id
      )
        throw new PortalAccessError(
          '로그인 계정이 변경되었습니다. 작성하던 계정으로 다시 로그인한 후 저장해 주세요.',
          403,
        );
      const merged = preserveApplicationDetails(
        currentState,
        mergeStateForPortalUser(
          currentUser.role === 'admin'
            ? currentState
            : await stateWithConsultingFlows(currentState),
          body.state,
          currentUser,
        ),
      ) as Record<string, unknown>;
      const memberChange =
        currentUser.role === 'admin' &&
        !sameMemberRecords(
          (currentState as Record<string, unknown> | null)?.members,
          merged.members,
        );
      if (
        memberChange &&
        membersRevisionOf(body.state) !== membersRevisionOf(currentState)
      ) {
        throw new PortalStateConflict(
          '다른 창에서 파트너 명단을 변경했습니다. 저장되지 않은 내용을 확인하고 새로고침 후 다시 수정해 주세요.',
        );
      }
      const membersRevision =
        membersRevisionOf(currentState) + (memberChange ? 1 : 0);
      return await stateWithConsultingFlows({ ...merged, membersRevision });
    });
    return privateJson({
      ok: true,
      updatedAt: result.updatedAt,
      membersRevision: membersRevisionOf(result.state),
    });
  } catch (error) {
    const accessResponse = accessErrorResponse(error, request);
    if (accessResponse) return accessResponse;
    if (error instanceof PortalStateConflict)
      return privateJson({ error: error.message }, { status: 409 });
    if (error instanceof ApplicationDetailsError)
      return privateJson({ error: error.message }, { status: 400 });
    if (error instanceof FlowError)
      return privateJson({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError)
      return privateJson(
        { error: '저장 요청 형식이 올바르지 않습니다.' },
        { status: 400 },
      );
    console.error('Failed to write portal state', error);
    return privateJson(
      { error: '운영 데이터를 저장하지 못했습니다.' },
      { status: 500 },
    );
  }
}
