import { env } from 'cloudflare:workers';
import { consultingFlowsTableSql, portalStateId } from '@/db/schema';
import {
  FlowError,
  newConsultingFlow,
  type ConsultingFlow,
} from '@/lib/consulting-flow';
import { resolveFlowAssignment } from '@/lib/consulting-flow-access';
import {
  hasPortalStateStructure,
  requirePortalUser,
  PortalAccessError,
  type PortalUser,
} from '@/lib/portal-auth';
import { readPortalStateSnapshot } from '@/lib/portal-state';
import { projectFlowState } from '@/lib/consulting-flow-projection';
import { isPipelineDiscontinued } from '@/lib/pipeline-dropoff-metrics';
import { isCrossSiteRequest } from '@/lib/request-origin';
import { QueryRequestError } from '@/lib/request-query';
import { readRouteParam, RouteParamError } from '@/lib/request-path';
import { privateJsonResponse } from '@/lib/private-response';

export function flowEnvironment() {
  return env as unknown as {
    DB?: D1Database;
    AI_SOURCE_FILES?: R2Bucket;
    ANTHROPIC_API_KEY?: string;
    ANTHROPIC_MODEL?: string;
  };
}
export async function flowDatabase() {
  const db = flowEnvironment().DB;
  if (!db) throw new FlowError('진행 저장소가 연결되지 않았습니다.', 503);
  await db.prepare(consultingFlowsTableSql).run();
  return db;
}
export function flowBucket() {
  const bucket = flowEnvironment().AI_SOURCE_FILES;
  if (!bucket)
    throw new FlowError('보안 파일 저장소가 연결되지 않았습니다.', 503);
  return bucket;
}
type StoredFlowRow = {
  case_id: string;
  partner_id: string;
  revision: number;
  updated_at: string;
  payload: string | null;
};
const storedFlowIntegrityError = () =>
  new FlowError(
    '저장된 상담 FLOW 무결성을 확인할 수 없습니다. 관리자 복구가 필요합니다.',
    503,
  );
const validFlowTimestamp = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  Number.isFinite(Date.parse(value));
function storedFlowFromRow(
  row: StoredFlowRow,
  expectedCaseId?: string,
): ConsultingFlow {
  let value: unknown;
  try {
    value = typeof row.payload === 'string' ? JSON.parse(row.payload) : null;
  } catch {
    throw storedFlowIntegrityError();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw storedFlowIntegrityError();
  const flow = value as ConsultingFlow;
  if (
    flow.schemaVersion !== 1 ||
    typeof row.case_id !== 'string' ||
    !row.case_id ||
    typeof row.partner_id !== 'string' ||
    !row.partner_id ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 0 ||
    flow.caseId !== row.case_id ||
    (expectedCaseId !== undefined && flow.caseId !== expectedCaseId) ||
    flow.partnerId !== row.partner_id ||
    !Number.isSafeInteger(flow.revision) ||
    flow.revision !== row.revision ||
    !validFlowTimestamp(row.updated_at) ||
    !validFlowTimestamp(flow.updatedAt) ||
    flow.updatedAt !== row.updated_at
  )
    throw storedFlowIntegrityError();
  return flow;
}
export async function readFlow(caseId: string): Promise<ConsultingFlow | null> {
  const row = await (
    await flowDatabase()
  )
    .prepare(
      'SELECT case_id, partner_id, revision, updated_at, payload FROM consulting_flows WHERE case_id = ?1',
    )
    .bind(caseId)
    .first<StoredFlowRow>();
  return row ? storedFlowFromRow(row, caseId) : null;
}
export async function stateWithConsultingFlows(raw: unknown) {
  if (raw !== null && !hasPortalStateStructure(raw))
    throw new FlowError(
      '저장된 운영 데이터 구조를 확인할 수 없습니다. 관리자 복구가 필요합니다.',
      503,
    );
  const rows = await (
    await flowDatabase()
  )
    // Project inside SQLite: a dashboard refresh must not load every firm's report or transcript.
    .prepare(`SELECT case_id, partner_id, revision, updated_at,
      CASE WHEN json_valid(payload) THEN json_set(
        json_remove(payload, '$.files', '$.ai.sourceText', '$.audit', '$.commandIds', '$.commandReceipts', '$.jobs'),
        '$.reports', json((SELECT json_group_array(json_object(
          'id', json_extract(r.value, '$.id'), 'stage', json_extract(r.value, '$.stage'),
          'sourceReportId', json_extract(r.value, '$.sourceReportId'), 'sourceRecordingId', json_extract(r.value, '$.sourceRecordingId'),
          'decisionId', json_extract(r.value, '$.decisionId'), 'documentsKey', json_extract(r.value, '$.documentsKey')
        )) FROM json_each(payload, '$.reports') r)),
        '$.recordings', json((SELECT json_group_array(json_object('id', json_extract(v.value, '$.id'))) FROM json_each(payload, '$.recordings') v))
      ) ELSE NULL END AS payload FROM consulting_flows`)
    .all<StoredFlowRow>();
  const projected = projectFlowState(
    raw,
    rows.results.map((row) => storedFlowFromRow(row)),
  );
  if (projected !== null && !hasPortalStateStructure(projected))
    throw new FlowError(
      '저장된 운영 데이터 구조를 확인할 수 없습니다. 관리자 복구가 필요합니다.',
      503,
    );
  return projected;
}
function assertFlowCommitTransition(
  before: ConsultingFlow,
  after: ConsultingFlow,
) {
  if (
    before.schemaVersion !== 1 ||
    after.schemaVersion !== 1 ||
    typeof before.caseId !== 'string' ||
    !before.caseId ||
    after.caseId !== before.caseId ||
    typeof before.partnerId !== 'string' ||
    !before.partnerId ||
    after.partnerId !== before.partnerId ||
    !Number.isSafeInteger(before.revision) ||
    before.revision < 0 ||
    !Number.isSafeInteger(after.revision) ||
    after.revision !== before.revision + 1 ||
    (before.revision > 0 && !validFlowTimestamp(before.updatedAt)) ||
    !validFlowTimestamp(after.updatedAt)
  )
    throw storedFlowIntegrityError();
}
export async function commitFlow(
  before: ConsultingFlow,
  after: ConsultingFlow,
  statePayload?: string | null,
) {
  if (after === before) return;
  assertFlowCommitTransition(before, after);
  const payload = JSON.stringify(after);
  if (new TextEncoder().encode(payload).length > 1_800_000)
    throw new FlowError(
      '이 진행의 저장 한도에 가까워졌습니다. 관리자 검토가 필요합니다.',
      413,
    );
  const db = await flowDatabase();
  const result =
    before.revision === 0
      ? await db
          .prepare(
            `INSERT INTO consulting_flows (case_id, partner_id, revision, payload, updated_at)
            SELECT ?1, ?2, ?3, ?4, ?5 WHERE (?6 = 0 OR (SELECT payload FROM portal_state WHERE id = '${portalStateId}') IS ?7)
            ON CONFLICT(case_id) DO NOTHING`,
          )
          .bind(
            after.caseId,
            after.partnerId,
            after.revision,
            payload,
            after.updatedAt,
            statePayload === undefined ? 0 : 1,
            statePayload ?? null,
          )
          .run()
      : await db
          .prepare(
            `UPDATE consulting_flows SET revision = ?1, payload = ?2, updated_at = ?3 WHERE case_id = ?4 AND revision = ?5
            AND (?6 = 0 OR (SELECT payload FROM portal_state WHERE id = '${portalStateId}') IS ?7)`,
          )
          .bind(
            after.revision,
            payload,
            after.updatedAt,
            before.caseId,
            before.revision,
            statePayload === undefined ? 0 : 1,
            statePayload ?? null,
          )
          .run();
  if (result.meta.changes !== 1)
    throw new FlowError(
      '다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 확인해 주세요.',
      409,
    );
}
export async function loadFlowAccess(request: Request, caseId: string) {
  const validatedCaseId = readRouteParam(
    caseId,
    120,
    '진행번호를 확인해 주세요.',
  );
  const initial = await readPortalStateSnapshot();
  await requirePortalUser(request, initial.state);
  const stored = await readFlow(validatedCaseId);
  const { state, payload } = await readPortalStateSnapshot();
  const user = await requirePortalUser(request, state);
  const assignment = resolveFlowAssignment(
    state,
    validatedCaseId,
    user,
    stored,
  );
  return {
    user,
    state,
    statePayload: payload,
    flow:
      stored ??
      newConsultingFlow(
        validatedCaseId,
        assignment.company,
        assignment.partnerId,
        assignment.partnerName,
      ),
  };
}

export function assertFlowLifecycleActive(state: unknown, caseId: string) {
  if (isPipelineDiscontinued(state, caseId))
    throw new FlowError(
      '대표가 진행을 중단한 상태입니다. 진행판에서 다시 연 뒤 이용해 주세요.',
      409,
    );
}
export async function recheckFlowAccess(
  request: Request,
  flow: ConsultingFlow,
  expected: PortalUser,
  uploads = false,
) {
  const access = await loadFlowAccess(request, flow.caseId);
  if (
    access.user.id !== expected.id ||
    access.user.memberId !== expected.memberId ||
    access.user.role !== expected.role ||
    access.flow.partnerId !== flow.partnerId
  )
    throw new FlowError(
      '계정 또는 담당 정보가 변경되었습니다. 다시 확인해 주세요.',
      403,
    );
  if (
    uploads &&
    access.user.role !== 'admin' &&
    !access.user.permissions?.fileUpload
  )
    throw new FlowError('자료 업로드 권한이 필요합니다.', 403);
  return access;
}
export function assertSameOrigin(request: Request) {
  if (isCrossSiteRequest(request))
    throw new FlowError(
      '다른 사이트에서 보낸 변경 요청은 허용하지 않습니다.',
      403,
    );
}
export function flowErrorResponse(error: unknown) {
  if (
    error instanceof FlowError ||
    error instanceof PortalAccessError ||
    error instanceof QueryRequestError ||
    error instanceof RouteParamError
  )
    return privateJsonResponse(
      { error: error.message },
      { status: error.status },
    );
  if (error instanceof SyntaxError)
    return privateJsonResponse(
      { error: '요청 형식을 확인해 주세요.' },
      { status: 400 },
    );
  console.error(
    'Consulting workflow operation failed',
    error instanceof Error ? error.name : 'unknown',
  );
  return privateJsonResponse(
    {
      error:
        '저장 여부를 새로고침으로 확인해 주세요. 해결되지 않으면 관리자에게 문의해 주세요.',
    },
    { status: 500 },
  );
}
export function flowReadiness() {
  const e = flowEnvironment();
  return {
    aiConnected: Boolean(e.ANTHROPIC_API_KEY),
    model: e.ANTHROPIC_MODEL || 'claude-opus-5',
    transcriptionConnected: false,
  };
}
