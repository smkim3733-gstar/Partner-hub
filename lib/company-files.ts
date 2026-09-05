import { env } from 'cloudflare:workers';

import {
  companyFileAssignmentsTableSql,
  companyFileCaseLinksTableSql,
  companyFileObjectIntegrityTableSql,
  companyFileObjectsCompanyIndexSql,
  companyFileObjectsOwnerIndexSql,
  companyFileObjectsTableSql,
  companyFileUploadRequestsTableSql,
  portalStateId,
} from '@/db/schema';
import {
  normalizedMemberName,
  uniqueMemberIdForName,
  type PortalUser,
} from '@/lib/portal-auth';

export {
  companyFileCategories,
  safeFileName,
  type CompanyFileCategory,
} from './company-file-policy';

type FileRuntimeEnvironment = {
  DB?: D1Database;
  AI_SOURCE_FILES?: R2Bucket;
};

export type CompanyFileRow = {
  id: string;
  storage_key: string;
  original_name: string;
  company: string;
  category: string;
  title: string;
  assigned_trainee: string;
  partner_member_id?: string | null;
  case_id?: string | null;
  uploaded_by_user_id: string;
  uploaded_by_email: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
};

type StoredCompanyFileObjectIntegrityRow = {
  validation_mode: string;
  r2_etag: string | null;
  r2_content_type: string;
};
export type CompanyFileObjectBinding = {
  etag: string;
  contentType: string;
};
export type CompanyFileObjectIntegrity = {
  validationMode: 'metadata' | 'etag';
  etag: string | null;
  contentType: string;
};
type CompanyFileObjectFacts = Pick<
  CompanyFileRow,
  'id' | 'storage_key' | 'content_type' | 'size_bytes'
>;

export class CompanyFileError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 | 409 | 413 | 503,
  ) {
    super(message);
  }
}

export function companyFileDatabase() {
  const binding = (env as unknown as FileRuntimeEnvironment).DB;
  if (!binding)
    throw new CompanyFileError(
      '기업자료 메타데이터 저장소가 연결되지 않았습니다.',
      503,
    );
  return binding;
}

export function companyFileBucket() {
  const binding = (env as unknown as FileRuntimeEnvironment).AI_SOURCE_FILES;
  if (!binding)
    throw new CompanyFileError(
      '기업 원본파일 보안 저장소가 연결되지 않았습니다.',
      503,
    );
  return binding;
}

export async function ensureCompanyFileTables(db: D1Database) {
  await db.batch([
    db.prepare(companyFileObjectsTableSql),
    db.prepare(companyFileObjectsOwnerIndexSql),
    db.prepare(companyFileObjectsCompanyIndexSql),
    db.prepare(companyFileObjectIntegrityTableSql),
    db.prepare(companyFileAssignmentsTableSql),
    db.prepare(companyFileCaseLinksTableSql),
    db.prepare(companyFileUploadRequestsTableSql),
  ]);
}

const storedCompanyFileIntegrityError = () =>
  new CompanyFileError(
    '저장된 기업자료 원본 무결성을 확인할 수 없습니다. 관리자 복구가 필요합니다.',
    503,
  );

export function companyFileObjectBinding(
  file: CompanyFileObjectFacts,
  object: R2Object,
): CompanyFileObjectBinding {
  if (
    object.key !== file.storage_key ||
    object.size !== file.size_bytes ||
    object.httpMetadata?.contentType !== file.content_type ||
    typeof object.etag !== 'string' ||
    !object.etag.trim() ||
    object.etag.length > 256
  )
    throw new CompanyFileError(
      '기업자료 원본을 보안 저장소에 안전하게 기록하지 못했습니다.',
      503,
    );
  return { etag: object.etag, contentType: file.content_type };
}

export function companyFileObjectMatchesIntegrity(
  file: CompanyFileObjectFacts,
  object: R2Object,
  integrity: CompanyFileObjectIntegrity,
) {
  return (
    object.key === file.storage_key &&
    object.size === file.size_bytes &&
    object.httpMetadata?.contentType === integrity.contentType &&
    integrity.contentType === file.content_type &&
    (integrity.validationMode === 'metadata' || object.etag === integrity.etag)
  );
}

export async function readCompanyFileObjectIntegrity(
  file: CompanyFileObjectFacts,
): Promise<CompanyFileObjectIntegrity> {
  const row = await companyFileDatabase()
    .prepare(`SELECT integrity.validation_mode, integrity.r2_etag,
      integrity.r2_content_type
    FROM company_file_objects file
    JOIN company_file_object_integrity integrity ON integrity.file_id = file.id
    WHERE file.id = ?1 AND file.storage_key = ?2 AND file.content_type = ?3
      AND file.size_bytes = ?4`)
    .bind(file.id, file.storage_key, file.content_type, file.size_bytes)
    .first<StoredCompanyFileObjectIntegrityRow>();
  if (
    !row ||
    row.r2_content_type !== file.content_type ||
    (row.validation_mode !== 'metadata' && row.validation_mode !== 'etag') ||
    (row.validation_mode === 'metadata'
      ? row.r2_etag !== null
      : typeof row.r2_etag !== 'string' ||
        !row.r2_etag.trim() ||
        row.r2_etag.length > 256)
  )
    throw storedCompanyFileIntegrityError();
  return {
    validationMode: row.validation_mode,
    etag: row.r2_etag,
    contentType: row.r2_content_type,
  };
}

export function mayUploadCompanyFiles(user: PortalUser) {
  return user.role === 'admin' || Boolean(user.permissions?.fileUpload);
}

export function resolveCompanyFileAssignment(
  user: PortalUser,
  state: unknown,
  requestedId: string | undefined,
  requestedName: string,
) {
  if (user.role !== 'admin') {
    if (!user.memberId)
      throw new CompanyFileError('담당 계정을 확인할 수 없습니다.', 403);
    return {
      partnerMemberId: user.memberId,
      assignedTrainee: user.memberName ?? user.displayName,
    };
  }
  const members =
    (
      state as {
        members?: Array<{ id: string; name: string; status: string }>;
      } | null
    )?.members ?? [];
  const name = normalizedMemberName(requestedName);
  const nameMatches = members.filter(
    (member) => normalizedMemberName(member.name) === name,
  );
  if (requestedId === undefined && nameMatches.length > 1)
    throw new CompanyFileError(
      '동명이인이 있습니다. 자료 등록 화면에서 이메일을 확인하고 담당 계정을 선택해 주세요.',
      400,
    );
  const memberId =
    requestedId ?? (nameMatches.length === 1 ? nameMatches[0].id : '');
  if (!memberId)
    return {
      partnerMemberId: '',
      assignedTrainee: requestedName || '김성민 대표',
    };
  const matches = members.filter((member) => member.id === memberId);
  if (matches.length !== 1 || matches[0].status !== '활성')
    throw new CompanyFileError('승인된 담당 계정을 다시 선택해 주세요.', 400);
  return {
    partnerMemberId: memberId,
    assignedTrainee: normalizedMemberName(matches[0].name),
  };
}

export function mayReadCompanyFile(
  user: PortalUser,
  row: CompanyFileRow,
  state: unknown,
) {
  return (
    user.role === 'admin' ||
    (Boolean(user.memberId) &&
      (row.partner_member_id != null
        ? row.partner_member_id === user.memberId
        : uniqueMemberIdForName(state, row.assigned_trainee) === user.memberId))
  );
}

export async function findCompanyFile(id: string) {
  const db = companyFileDatabase();
  await ensureCompanyFileTables(db);
  return db
    .prepare(`
      SELECT f.id, storage_key, original_name, company, category, title,
        assigned_trainee, uploaded_by_user_id, uploaded_by_email,
        content_type, size_bytes, created_at, a.partner_member_id, c.case_id
      FROM company_file_objects f
      LEFT JOIN company_file_assignments a ON a.file_id = f.id
      LEFT JOIN company_file_case_links c ON c.file_id = f.id
      WHERE f.id = ?1
    `)
    .bind(id)
    .first<CompanyFileRow>();
}

/** New draft uploads are staged originals until explicitly linked by the saved
 * application. An abandoned attachment must not silently become AI input. */
export const companyFileIntakeFilterSql = `
  NOT EXISTS (SELECT 1 FROM company_file_upload_requests u WHERE u.file_id = f.id AND u.status = 'deleted')
  AND (c.case_id IS NULL OR c.case_id NOT LIKE 'case-draft-%'
    OR NOT EXISTS (SELECT 1 FROM company_file_upload_requests u WHERE u.file_id = f.id)
    OR EXISTS (SELECT 1 FROM portal_state p, json_each(p.payload, '$.companyDocuments') d
      WHERE p.id = '${portalStateId}' AND json_extract(d.value, '$.storageFileId') = f.id
      AND json_extract(d.value, '$.caseId') = c.case_id))
`;

export async function isCompanyFileIntakeVisible(id: string) {
  const db = companyFileDatabase();
  await ensureCompanyFileTables(db);
  return Boolean(
    await db
      .prepare(`SELECT f.id FROM company_file_objects f
    LEFT JOIN company_file_case_links c ON c.file_id = f.id
    WHERE f.id = ?1 AND ${companyFileIntakeFilterSql}`)
      .bind(id)
      .first(),
  );
}
