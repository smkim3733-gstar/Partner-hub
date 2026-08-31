import { env } from 'cloudflare:workers';

import {
  companyFileAssignmentsTableSql,
  companyFileObjectsCompanyIndexSql,
  companyFileObjectsOwnerIndexSql,
  companyFileObjectsTableSql,
} from '@/db/schema';
import {
  normalizedMemberName,
  uniqueMemberIdForName,
  type PortalUser,
} from '@/lib/portal-auth';

export {
  companyFileCategories,
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
  uploaded_by_user_id: string;
  uploaded_by_email: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
};

export class CompanyFileError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 | 413 | 503,
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
    db.prepare(companyFileAssignmentsTableSql),
  ]);
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
        content_type, size_bytes, created_at, a.partner_member_id
      FROM company_file_objects f
      LEFT JOIN company_file_assignments a ON a.file_id = f.id
      WHERE f.id = ?1
    `)
    .bind(id)
    .first<CompanyFileRow>();
}

export function safeFileName(value: string) {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return character === '\\' || character === '/' || code < 32 || code === 127
      ? '_'
      : character;
  })
    .join('')
    .trim()
    .slice(0, 180);
}
