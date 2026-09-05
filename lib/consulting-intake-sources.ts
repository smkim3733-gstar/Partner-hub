import {
  companyFileBucket,
  companyFileIntakeFilterSql,
  companyFileDatabase,
  ensureCompanyFileTables,
  findCompanyFile,
  isCompanyFileIntakeVisible,
  safeFileName,
  type CompanyFileRow,
} from './company-files';
import {
  FlowError,
  hasSensitiveIdentifier,
  type ConsultingFlow,
  type FlowCommand,
  type FlowFile,
} from './consulting-flow';
import { flowFileStorageKey } from './consulting-flow-file-policy';
import {
  intakeSourceKind,
  intakeSourceProblem,
  type IntakeSourceOption,
} from './intake-source-policy';
import type { PortalUser } from './portal-auth';
import { readTranscriptFile } from './transcript-reader';
import { transcriptProblem } from './transcript-policy';

export function requireIntakeReviewer(user: PortalUser) {
  if (user.role !== 'admin')
    throw new FlowError(
      '신청자료의 AI 입력 검토·반영은 대표만 할 수 있습니다.',
      403,
    );
}

type SourceMetadata = Pick<
  CompanyFileRow,
  'id' | 'original_name' | 'category' | 'size_bytes' | 'created_at'
>;
function option(row: SourceMetadata): IntakeSourceOption {
  return {
    id: row.id,
    name: row.original_name,
    category: row.category,
    size: row.size_bytes,
    createdAt: row.created_at,
    kind: intakeSourceKind(row.original_name),
    blockedReason: intakeSourceProblem({
      name: row.original_name,
      size: row.size_bytes,
    }),
  };
}

export async function listIntakeSources(flow: ConsultingFlow) {
  const db = companyFileDatabase();
  await ensureCompanyFileTables(db);
  const rows = await db
    .prepare(`
    SELECT f.id, original_name, category, size_bytes, created_at
    FROM company_file_objects f
    LEFT JOIN company_file_assignments a ON a.file_id = f.id
    LEFT JOIN company_file_case_links c ON c.file_id = f.id
    WHERE company = ?1 AND ((a.partner_member_id <> '' AND a.partner_member_id = ?3)
      OR (a.file_id IS NULL AND assigned_trainee = ?2))
      AND (c.file_id IS NULL OR c.case_id = ?4)
      AND ${companyFileIntakeFilterSql}
    ORDER BY created_at DESC, f.id DESC LIMIT 101
  `)
    .bind(flow.company, flow.partnerName, flow.partnerId, flow.caseId)
    .all<SourceMetadata>();
  return {
    files: rows.results.slice(0, 100).map(option),
    hasMore: rows.results.length > 100,
  };
}

/** Resolve both company and assigned partner on the server; never accept R2 keys from the client. */
async function loadSource(flow: ConsultingFlow, fileId: unknown) {
  if (typeof fileId !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(fileId))
    throw new FlowError('신청자료를 선택해 주세요.');
  const row = await findCompanyFile(fileId);
  if (
    !row ||
    !(await isCompanyFileIntakeVisible(fileId)) ||
    row.company !== flow.company ||
    (row.case_id != null && row.case_id !== flow.caseId) ||
    (row.partner_member_id != null
      ? !row.partner_member_id || row.partner_member_id !== flow.partnerId
      : row.assigned_trainee !== flow.partnerName)
  )
    throw new FlowError(
      '이 기업·담당 파트너에게 연결된 신청자료를 찾지 못했습니다.',
      404,
    );
  const file = option(row);
  if (file.blockedReason) throw new FlowError(file.blockedReason);
  const object = await companyFileBucket().get(row.storage_key);
  if (!object)
    throw new FlowError(
      '원본이 없거나 삭제되었습니다. 자료함을 확인해 주세요.',
      404,
    );
  if (object.size !== row.size_bytes)
    throw new FlowError(
      '원본 크기가 변경되었습니다. 자료를 다시 확인해 주세요.',
      409,
    );
  const bytes = await object.arrayBuffer();
  if (bytes.byteLength !== row.size_bytes)
    throw new FlowError(
      '원본 전체를 읽지 못했습니다. 다시 확인해 주세요.',
      409,
    );
  if (file.kind === 'binary') {
    const header = new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength));
    const valid = /\.pdf$/i.test(file.name)
      ? new TextDecoder().decode(header).startsWith('%PDF-')
      : /\.png$/i.test(file.name)
        ? [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => header[i] === b)
        : header[0] === 255 && header[1] === 216 && header[2] === 255;
    if (!valid)
      throw new FlowError(
        '확장자와 파일 내용이 다릅니다. 정상 PDF·이미지로 다시 저장해 주세요.',
      );
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sourceHash = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  return { file, bytes, sourceHash };
}

export async function previewIntakeSource(
  flow: ConsultingFlow,
  fileId: unknown,
) {
  const source = await loadSource(flow, fileId);
  let text: string | undefined;
  if (source.file.kind === 'text') {
    try {
      text = await readTranscriptFile(
        new File([source.bytes], source.file.name),
      );
    } catch (error) {
      throw new FlowError(
        error instanceof Error ? error.message : '문서를 읽지 못했습니다.',
      );
    }
  }
  return { file: source.file, sourceHash: source.sourceHash, text };
}

export async function prepareIntakeImport(
  flow: ConsultingFlow,
  user: PortalUser,
  command: FlowCommand,
  now: string,
) {
  requireIntakeReviewer(user);
  if (
    command.contentReviewed !== true ||
    command.fileConsent !== true ||
    command.privacyMasked !== true
  )
    throw new FlowError(
      '자료 내용·저장 및 공유 권한·개인정보 마스킹을 모두 확인해 주세요.',
    );
  const source = await loadSource(flow, command.intakeFileId);
  if (command.sourceHash !== source.sourceHash)
    throw new FlowError(
      '검토한 원본과 일치하지 않습니다. 자료를 다시 불러와 확인해 주세요.',
      409,
    );
  if (source.file.category === '상담녹취' && command.recordingConsent !== true)
    throw new FlowError(
      '전화 녹취자료를 진단 근거로 이용할 권한을 확인해 주세요.',
    );
  let bytes = source.bytes;
  let name = source.file.name;
  let contentType = /\.pdf$/i.test(name)
    ? 'application/pdf'
    : /\.png$/i.test(name)
      ? 'image/png'
      : 'image/jpeg';
  if (source.file.kind === 'text') {
    // Parsing again rejects corrupt/unsupported originals even when POST bypasses the preview UI.
    try {
      await readTranscriptFile(new File([bytes], name));
    } catch (error) {
      throw new FlowError(
        error instanceof Error ? error.message : '원본 문서를 읽지 못했습니다.',
      );
    }
    const text =
      typeof command.reviewedText === 'string'
        ? command.reviewedText.trim()
        : '';
    const problem = transcriptProblem(text);
    if (problem) throw new FlowError(problem);
    if (hasSensitiveIdentifier(text))
      throw new FlowError(
        '검토 본문에 식별번호·전화번호·이메일이 있습니다. 마스킹해 주세요.',
      );
    bytes = new TextEncoder().encode(text).buffer;
    name =
      safeFileName(name.replace(/\.(docx|txt)$/i, '')).slice(0, 140) +
      '_검토본.txt';
    contentType = 'text/plain';
  }
  const id = crypto.randomUUID();
  const file: FlowFile = {
    id,
    name,
    contentType,
    size: bytes.byteLength,
    createdAt: now,
    key: flowFileStorageKey(id),
    purpose: 'source',
    intakeFileId: source.file.id,
    intakeSourceHash: source.sourceHash,
    sourceReviewedAt: now,
    sourceReviewedBy: user.memberId || user.id,
  };
  return { file, bytes, category: source.file.category };
}
