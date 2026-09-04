import {
  applicationDraftDatabase,
  draftOwnerKey,
} from '@/lib/application-draft-store';
import {
  requirePortalUser,
  PortalAccessError,
  stateForPortalUser,
} from '@/lib/portal-auth';
import { readPortalState } from '@/lib/portal-state';
import { assertSameOrigin } from '@/lib/consulting-flow-store';
import { readFlowJsonObject } from '@/lib/consulting-flow-http';
import { FlowError } from '@/lib/consulting-flow';
import {
  draftCaseId,
  parseApplicationDraft,
  type DraftEnvelope,
} from '@/lib/application-draft';
import { privateJsonResponse } from '@/lib/private-response';

export const dynamic = 'force-dynamic';
type Row = {
  revision: number;
  draft_id: string;
  payload: string | null;
  updated_at: string;
};
const json = (data: unknown, status = 200) =>
  privateJsonResponse(data, { status });

async function handle(request: Request) {
  try {
    if (request.method !== 'GET') assertSameOrigin(request);
    const state = await readPortalState();
    const user = await requirePortalUser(request, state);
    if (user.role !== 'admin' && !user.permissions?.collaborationApply)
      throw new PortalAccessError('협업신청 권한이 없습니다.', 403);
    const owner = draftOwnerKey(user);
    const db = await applicationDraftDatabase();
    const row = await db
      .prepare(
        'SELECT revision, draft_id, payload, updated_at FROM application_drafts WHERE owner_key = ?1',
      )
      .bind(owner)
      .first<Row>();
    const visible = stateForPortalUser(state, user) as {
      cases?: Array<{ id: string }>;
    } | null;
    const submitted =
      row?.payload &&
      visible?.cases?.some((item) => item.id === draftCaseId(row.draft_id))
        ? draftCaseId(row.draft_id)
        : null;
    const envelope = (): DraftEnvelope => ({
      revision: row?.revision ?? 0,
      draftId: row?.payload ? row.draft_id : null,
      draft: row?.payload
        ? parseApplicationDraft(JSON.parse(row.payload))
        : null,
      submittedCaseId: submitted,
      updatedAt: row?.updated_at ?? null,
    });
    if (request.method === 'GET') return json(envelope());
    const body = (await readFlowJsonObject(request, 40_000)) as {
      expectedUserId?: unknown;
      revision?: unknown;
      draftId?: unknown;
      draft?: unknown;
    };
    if (!body || body.expectedUserId !== user.id)
      throw new PortalAccessError(
        '작성하던 계정으로 로그인한 후 임시저장해 주세요.',
        403,
      );
    if (
      !Number.isSafeInteger(body.revision) ||
      Number(body.revision) < 0 ||
      typeof body.draftId !== 'string' ||
      !/^[a-zA-Z0-9-]{10,80}$/.test(body.draftId)
    )
      throw new FlowError('임시저장 식별값을 확인해 주세요.');
    let payload: string | null = null;
    if (request.method === 'PUT') {
      let draft;
      try {
        draft = parseApplicationDraft(body.draft);
      } catch (error) {
        throw new FlowError((error as Error).message);
      }
      if (user.role !== 'admin') {
        draft.partnerMemberId = user.memberId!;
        draft.applicantName = user.memberName!;
      }
      if (submitted && body.draftId === row?.draft_id)
        throw new FlowError(
          '이미 접수된 신청입니다. 새로고침 후 새 신청을 작성해 주세요.',
          409,
        );
      payload = JSON.stringify(draft);
    }
    if (row?.draft_id === body.draftId && row.payload === payload)
      return json(envelope());
    if (
      body.revision !== (row?.revision ?? 0) ||
      (row?.payload && row.draft_id !== body.draftId) ||
      (!row?.payload && row?.draft_id === body.draftId && payload !== null)
    )
      throw new FlowError(
        '다른 창에서 임시저장을 변경했습니다. 현재 입력을 유지한 채 최신 내용을 확인해 주세요.',
        409,
      );
    if (request.method === 'DELETE' && row?.draft_id !== body.draftId)
      throw new FlowError('삭제할 임시저장이 변경되었습니다.', 409);
    const updatedAt = new Date().toISOString();
    const revision = (row?.revision ?? 0) + 1;
    const result = row
      ? await db
          .prepare(
            'UPDATE application_drafts SET revision = ?1, draft_id = ?2, payload = ?3, updated_at = ?4 WHERE owner_key = ?5 AND revision = ?6',
          )
          .bind(revision, body.draftId, payload, updatedAt, owner, row.revision)
          .run()
      : await db
          .prepare(
            'INSERT INTO application_drafts (owner_key, revision, draft_id, payload, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(owner_key) DO NOTHING',
          )
          .bind(owner, revision, body.draftId, payload, updatedAt)
          .run();
    if (result.meta.changes !== 1)
      throw new FlowError(
        '다른 창에서 먼저 저장했습니다. 현재 입력을 보관하고 다시 확인해 주세요.',
        409,
      );
    return json({
      revision,
      draftId: payload ? body.draftId : null,
      draft: payload ? JSON.parse(payload) : null,
      submittedCaseId: null,
      updatedAt,
    });
  } catch (error) {
    if (error instanceof PortalAccessError || error instanceof FlowError)
      return json({ error: error.message }, error.status);
    if (error instanceof SyntaxError)
      return json({ error: '임시저장 요청 형식이 올바르지 않습니다.' }, 400);
    return json(
      {
        error:
          '임시저장을 처리하지 못했습니다. 현재 입력을 유지하고 다시 시도해 주세요.',
      },
      500,
    );
  }
}
export const GET = handle;
export const PUT = handle;
export const DELETE = handle;
