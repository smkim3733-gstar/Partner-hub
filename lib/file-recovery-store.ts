import {
  companyFileBucket,
  companyFileDatabase,
  findCompanyFile,
  CompanyFileError,
  companyFileCategories,
} from './company-files';
import { readPortalState, PortalStateConflict } from './portal-state';
import {
  requirePortalUser,
  PortalAccessError,
  type PortalUser,
} from './portal-auth';
import { portalRevision } from './portal-revision';
import { flowDatabase } from './consulting-flow-store';
import { readFlowJsonObject } from './consulting-flow-http';
import { FlowError } from './consulting-flow';
import { portalStateId } from '@/db/schema';
import type { RecoveryPreview } from './file-recovery';
import { PORTAL_STATE_LIMIT_BYTES } from './pilot-readiness';

type RecordValue = Record<string, unknown>;
type RecoveryState = {
  cases: RecordValue[];
  members: RecordValue[];
  companyDocuments: RecordValue[];
  timeline: RecordValue[];
  [key: string]: unknown;
};
type FlowSummary = { revision: number; partner_id: string; company: string };
type RecoveryBody = {
  caseId: string;
  requestId: string;
  reason: string;
  confirmed: true;
  expectedUserId: string;
  stateRevision: string;
  fileRevision: string;
};
const idPattern = /^[A-Za-z0-9_-]{1,120}$/;
const reject = (message: string): never => {
  throw new CompanyFileError(message, 409);
};

async function actor(request: Request, state: unknown): Promise<PortalUser> {
  const user = await requirePortalUser(request, state);
  if (user.role !== 'admin')
    throw new PortalAccessError(
      '원본 회수는 대표 관리자만 할 수 있습니다.',
      403,
    );
  return user;
}
function checkedState(state: unknown): RecoveryState {
  const value = state as RecoveryState | null;
  if (
    !value ||
    !['cases', 'members', 'companyDocuments', 'timeline'].every((key) =>
      Array.isArray(value[key]),
    )
  )
    return reject('운영 데이터를 먼저 불러온 뒤 확인해 주세요.');
  return value;
}
async function inspect(id: string, state: RecoveryState) {
  if (!idPattern.test(id))
    throw new CompanyFileError('파일 식별값을 확인해 주세요.', 400);
  const file = await findCompanyFile(id);
  if (!file)
    throw new CompanyFileError(
      '회수할 원본 메타데이터를 찾지 못했습니다.',
      404,
    );
  if (!file.case_id || !file.partner_member_id)
    return reject(
      '기존 진행번호와 담당 계정 ID가 확정된 원본만 회수할 수 있습니다. 다른 신청으로 자동 배정하지 않습니다.',
    );
  if (
    !companyFileCategories.includes(
      file.category as (typeof companyFileCategories)[number],
    )
  )
    return reject('자료종류를 확인해야 합니다.');
  const db = companyFileDatabase();
  const ledger = await db
    .prepare(
      'SELECT status FROM company_file_upload_requests WHERE file_id = ?1',
    )
    .bind(id)
    .first<{ status: string }>();
  const uploadStatus = ledger?.status ?? 'legacy';
  if (!['ready', 'legacy'].includes(uploadStatus))
    return reject('업로드 미완료 또는 삭제 상태의 원본은 회수할 수 없습니다.');
  const cases = state.cases.filter((item) => item.id === file.case_id);
  const members = state.members.filter(
    (item) => item.id === file.partner_member_id,
  );
  if (
    cases.length !== 1 ||
    members.length !== 1 ||
    members[0].status !== '활성'
  )
    return reject('실제 접수와 활성 담당 계정을 먼저 확인해 주세요.');
  const item = cases[0],
    member = members[0];
  if (
    item.company !== file.company ||
    item.partnerMemberId !== file.partner_member_id
  )
    return reject(
      '원본과 신청의 기업명·담당 계정이 다릅니다. 다른 신청으로 옮기지 않습니다.',
    );
  const flow = await (
    await flowDatabase()
  )
    .prepare(
      "SELECT revision, partner_id, json_extract(payload, '$.company') AS company FROM consulting_flows WHERE case_id = ?1",
    )
    .bind(file.case_id)
    .first<FlowSummary>();
  if (
    flow &&
    (flow.partner_id !== file.partner_member_id ||
      flow.company !== file.company)
  )
    return reject('상담 기록의 기업·담당 계정이 원본과 다릅니다.');
  const object = await companyFileBucket().head(file.storage_key);
  if (!object || object.size !== file.size_bytes)
    return reject(
      '원본이 없거나 기록과 크기가 다릅니다. 원본을 먼저 확인해 주세요.',
    );
  const fileRevision = await portalRevision({
    file,
    uploadStatus,
    flow,
    etag: object.etag ?? null,
  });
  const preview: RecoveryPreview = {
    fileId: id,
    fileName: file.original_name,
    company: file.company,
    title: file.title,
    category: file.category,
    caseId: file.case_id,
    service: typeof item.service === 'string' ? item.service : '기존 접수',
    partnerMemberId: file.partner_member_id,
    partnerName: String(member.name),
    partnerEmail: String(member.email),
    sizeBytes: file.size_bytes,
    stateRevision: await portalRevision(state),
    fileRevision,
  };
  return { file, uploadStatus, flow, preview };
}
async function hasFlowReference(id: string) {
  return Boolean(
    await (
      await flowDatabase()
    )
      .prepare(
        "SELECT c.case_id FROM consulting_flows c, json_each(c.payload, '$.files') f WHERE json_extract(f.value, '$.intakeFileId') = ?1 LIMIT 1",
      )
      .bind(id)
      .first(),
  );
}
export async function previewFileRecovery(request: Request, id: string) {
  const raw = await readPortalState();
  await actor(request, raw);
  const state = checkedState(raw);
  const result = await inspect(id, state);
  if (
    state.companyDocuments.some((item) => item.storageFileId === id) ||
    (await hasFlowReference(id))
  )
    return reject(
      '이미 자료 목록 또는 상담에서 참조하는 원본입니다. 기존 연결을 확인해 주세요.',
    );
  return result.preview;
}
function parseBody(value: unknown): RecoveryBody {
  const v = value as RecoveryBody | null;
  if (
    !v ||
    v.confirmed !== true ||
    typeof v.caseId !== 'string' ||
    !idPattern.test(v.caseId) ||
    typeof v.requestId !== 'string' ||
    !/^[A-Za-z0-9_-]{16,100}$/.test(v.requestId) ||
    typeof v.reason !== 'string' ||
    v.reason.trim().length < 5 ||
    v.reason.length > 500 ||
    typeof v.expectedUserId !== 'string' ||
    typeof v.stateRevision !== 'string' ||
    typeof v.fileRevision !== 'string' ||
    !/^[a-f0-9]{64}$/.test(v.stateRevision ?? '') ||
    !/^[a-f0-9]{64}$/.test(v.fileRevision ?? '')
  )
    throw new CompanyFileError(
      '회수 대상·확인 사유·명시적 확인을 모두 입력해 주세요.',
      400,
    );
  return { ...v, reason: v.reason.trim() };
}
export async function recoverFile(request: Request, id: string) {
  const raw = await readPortalState();
  const user = await actor(request, raw);
  const body = parseBody(await readFlowJsonObject(request, 5000));
  if (body.expectedUserId !== user.id)
    throw new PortalAccessError(
      '확인하던 대표 계정으로 다시 로그인해 주세요.',
      403,
    );
  const state = checkedState(raw);
  const { file, uploadStatus, flow, preview } = await inspect(id, state);
  if (body.caseId !== preview.caseId)
    return reject('원본에 기록된 신청에만 회수할 수 있습니다.');
  const prior = state.companyDocuments.filter(
    (item) => item.storageFileId === id,
  );
  if (prior.length) {
    const recovery = prior[0].recovery as RecordValue | undefined;
    if (
      prior.length === 1 &&
      prior[0].caseId === body.caseId &&
      recovery?.requestId === body.requestId &&
      recovery.reason === body.reason &&
      recovery.by === user.id
    )
      return { ok: true, alreadyLinked: true, fileId: id, caseId: body.caseId };
    return reject(
      '이미 연결된 원본입니다. 기존 자료를 중복 등록하지 않습니다.',
    );
  }
  if (await hasFlowReference(id))
    return reject(
      '상담에서 이미 사용하는 원본입니다. 기존 연결을 확인해 주세요.',
    );
  if (
    state.companyDocuments.some((item) => item.id === `file-recovery-${id}`) ||
    state.timeline.some(
      (item) =>
        item.id === `timeline-recovery-${id}` || item.recoveryFileId === id,
    )
  )
    return reject(
      '이 원본의 이전 회수 기록이 있습니다. 기존 자료 연결을 먼저 확인해 주세요.',
    );
  if (
    body.stateRevision !== preview.stateRevision ||
    body.fileRevision !== preview.fileRevision
  )
    return reject(
      '확인 후 운영 내용이나 원본 상태가 바뀌었습니다. 다시 대조한 뒤 회수해 주세요.',
    );
  const now = new Date().toISOString();
  const document = {
    id: `file-recovery-${id}`,
    storageFileId: id,
    fileName: file.original_name,
    fileSize: file.size_bytes,
    company: file.company,
    title: file.title,
    category: file.category,
    status: '제출완료',
    assignedTrainee: preview.partnerName,
    partnerMemberId: file.partner_member_id,
    caseId: file.case_id,
    submittedBy: '대표 원본 회수',
    updatedAt: now,
    version: 'V1',
    sensitive: true,
    recovery: {
      requestId: body.requestId,
      reason: body.reason,
      by: user.id,
      at: now,
    },
  };
  const timeline = {
    id: `timeline-recovery-${id}`,
    caseId: file.case_id,
    date: now,
    title: '보관 원본 연결 회수',
    detail: `${file.title} · ${body.reason}`,
    type: '서류',
    tone: 'blue',
    recoveryFileId: id,
  };
  const next = {
    ...state,
    companyDocuments: [document, ...state.companyDocuments],
    timeline: [...state.timeline, timeline],
  };
  const payload = JSON.stringify(next);
  if (new TextEncoder().encode(payload).length > PORTAL_STATE_LIMIT_BYTES)
    throw new PortalStateConflict(
      '운영 데이터 저장 한도에 도달했습니다.',
      'capacity',
    );
  const current = await companyFileDatabase()
    .prepare('SELECT payload FROM portal_state WHERE id = ?1')
    .bind(portalStateId)
    .first<{ payload: string }>();
  if (
    !current ||
    (await portalRevision(JSON.parse(current.payload))) !==
      preview.stateRevision
  )
    return reject(
      '확인 중 운영 데이터가 변경되었습니다. 최신 내용을 다시 확인해 주세요.',
    );
  // One conditional D1 write: no new R2 object or reassignment, and no partial
  // document/timeline save if deletion, case ownership or flow changes race us.
  const result = await companyFileDatabase()
    .prepare(`UPDATE portal_state SET payload = ?1, updated_at = ?2
    WHERE id = ?3 AND payload = ?4
      AND EXISTS (SELECT 1 FROM company_file_objects f
        JOIN company_file_assignments a ON a.file_id = f.id JOIN company_file_case_links c ON c.file_id = f.id
        WHERE f.id = ?5 AND f.storage_key = ?6 AND f.original_name = ?7 AND f.company = ?8
          AND f.title = ?9 AND f.category = ?10 AND f.size_bytes = ?11 AND a.partner_member_id = ?12 AND c.case_id = ?13)
      AND COALESCE((SELECT status FROM company_file_upload_requests WHERE file_id = ?5), 'legacy') = ?14
      AND ((?15 IS NULL AND NOT EXISTS (SELECT 1 FROM consulting_flows WHERE case_id = ?13))
        OR EXISTS (SELECT 1 FROM consulting_flows WHERE case_id = ?13 AND revision = ?15 AND partner_id = ?12 AND json_extract(payload, '$.company') = ?8))
      AND NOT EXISTS (SELECT 1 FROM consulting_flows c, json_each(c.payload, '$.files') f WHERE json_extract(f.value, '$.intakeFileId') = ?5)`)
    .bind(
      payload,
      now,
      portalStateId,
      current.payload,
      id,
      file.storage_key,
      file.original_name,
      file.company,
      file.title,
      file.category,
      file.size_bytes,
      file.partner_member_id,
      file.case_id,
      uploadStatus,
      flow?.revision ?? null,
    )
    .run();
  if (result.meta.changes !== 1)
    return reject(
      '저장 직전에 기록이 변경되었습니다. 회수 결과와 최신 상태를 다시 확인해 주세요.',
    );
  return { ok: true, alreadyLinked: false, fileId: id, caseId: body.caseId };
}
export function recoveryError(error: unknown) {
  const status =
    error instanceof PortalAccessError ||
    error instanceof CompanyFileError ||
    error instanceof FlowError
      ? error.status
      : error instanceof PortalStateConflict
        ? 409
        : error instanceof SyntaxError
          ? 400
          : 503;
  const message =
    status === 503
      ? '회수 저장 여부를 확인하지 못했습니다. 현재 창에서 같은 요청을 다시 확인해 주세요.'
      : error instanceof Error
        ? error.message
        : '회수 요청을 확인해 주세요.';
  return Response.json(
    { error: message },
    { status, headers: { 'cache-control': 'private, no-store' } },
  );
}
