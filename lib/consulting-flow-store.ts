import { env } from 'cloudflare:workers';
import { consultingFlowsTableSql } from '@/db/schema';
import {
  FlowError,
  newConsultingFlow,
  type ConsultingFlow,
} from '@/lib/consulting-flow';
import { resolveFlowAssignment } from '@/lib/consulting-flow-access';
import { requirePortalUser, PortalAccessError } from '@/lib/portal-auth';
import { readPortalState } from '@/lib/portal-state';
import { projectFlowState } from '@/lib/consulting-flow-projection';

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
export async function readFlow(caseId: string): Promise<ConsultingFlow | null> {
  const row = await (
    await flowDatabase()
  )
    .prepare('SELECT payload FROM consulting_flows WHERE case_id = ?1')
    .bind(caseId)
    .first<{ payload: string }>();
  return row ? JSON.parse(row.payload) : null;
}
export async function stateWithConsultingFlows(raw: unknown) {
  const rows = await (
    await flowDatabase()
  )
    // Project inside SQLite: a dashboard refresh must not load every firm's report or transcript.
    .prepare(`SELECT json_set(
      json_remove(payload, '$.files', '$.ai.sourceText', '$.audit', '$.commandIds', '$.jobs'),
      '$.reports', json((SELECT json_group_array(json_object(
        'id', json_extract(r.value, '$.id'), 'stage', json_extract(r.value, '$.stage'),
        'sourceReportId', json_extract(r.value, '$.sourceReportId'), 'sourceRecordingId', json_extract(r.value, '$.sourceRecordingId'),
        'decisionId', json_extract(r.value, '$.decisionId'), 'documentsKey', json_extract(r.value, '$.documentsKey')
      )) FROM json_each(payload, '$.reports') r)),
      '$.recordings', json((SELECT json_group_array(json_object('id', json_extract(v.value, '$.id'))) FROM json_each(payload, '$.recordings') v))
    ) AS payload FROM consulting_flows`)
    .all<{ payload: string }>();
  return projectFlowState(
    raw,
    rows.results.map((row) => JSON.parse(row.payload) as ConsultingFlow),
  );
}
export async function commitFlow(
  before: ConsultingFlow,
  after: ConsultingFlow,
) {
  if (after === before) return;
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
            'INSERT INTO consulting_flows (case_id, partner_id, revision, payload, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(case_id) DO NOTHING',
          )
          .bind(
            after.caseId,
            after.partnerId,
            after.revision,
            payload,
            after.updatedAt,
          )
          .run()
      : await db
          .prepare(
            'UPDATE consulting_flows SET revision = ?1, payload = ?2, updated_at = ?3 WHERE case_id = ?4 AND revision = ?5',
          )
          .bind(
            after.revision,
            payload,
            after.updatedAt,
            before.caseId,
            before.revision,
          )
          .run();
  if (result.meta.changes !== 1)
    throw new FlowError(
      '다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 확인해 주세요.',
      409,
    );
}
export async function loadFlowAccess(request: Request, caseId: string) {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(caseId))
    throw new FlowError('진행번호를 확인해 주세요.');
  const state = await readPortalState();
  const user = await requirePortalUser(request, state);
  const stored = await readFlow(caseId);
  const assignment = resolveFlowAssignment(state, caseId, user, stored);
  return {
    user,
    flow:
      stored ??
      newConsultingFlow(
        caseId,
        assignment.company,
        assignment.partnerId,
        assignment.partnerName,
      ),
  };
}
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (
    (origin && origin !== new URL(request.url).origin) ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  )
    throw new FlowError(
      '다른 사이트에서 보낸 변경 요청은 허용하지 않습니다.',
      403,
    );
}
export function flowErrorResponse(error: unknown) {
  if (error instanceof FlowError || error instanceof PortalAccessError)
    return Response.json(
      { error: error.message },
      { status: error.status, headers: { 'cache-control': 'no-store' } },
    );
  if (error instanceof SyntaxError)
    return Response.json(
      { error: '요청 형식을 확인해 주세요.' },
      { status: 400 },
    );
  console.error(
    'Consulting workflow operation failed',
    error instanceof Error ? error.name : 'unknown',
  );
  return Response.json(
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
