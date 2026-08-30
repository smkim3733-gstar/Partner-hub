import { env } from 'cloudflare:workers';

import {
  companyFileObjectsCompanyIndexSql,
  companyFileObjectsOwnerIndexSql,
  companyFileObjectsTableSql,
} from '@/db/schema';
import type { PortalUser } from '@/lib/portal-auth';

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
  ]);
}

export function mayUploadCompanyFiles(user: PortalUser) {
  return user.role === 'admin' || Boolean(user.permissions?.fileUpload);
}

export function mayReadCompanyFile(user: PortalUser, row: CompanyFileRow) {
  return user.role === 'admin' || row.assigned_trainee === user.memberName;
}

export async function findCompanyFile(id: string) {
  const db = companyFileDatabase();
  await ensureCompanyFileTables(db);
  return db
    .prepare(`
      SELECT id, storage_key, original_name, company, category, title,
        assigned_trainee, uploaded_by_user_id, uploaded_by_email,
        content_type, size_bytes, created_at
      FROM company_file_objects
      WHERE id = ?1
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
