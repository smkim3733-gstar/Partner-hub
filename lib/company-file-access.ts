import { portalStateId } from '@/db/schema';
import { CompanyFileError } from './company-files';
import { requirePortalUser, type PortalUser } from './portal-auth';
import { readPortalStateSnapshot } from './portal-state';
import { isPostgresDatabase } from './database-dialect';

export async function currentFileAccess(
  request: Request,
  expected: PortalUser,
) {
  const snapshot = await readPortalStateSnapshot();
  const user = await requirePortalUser(request, snapshot.state);
  if (
    user.id !== expected.id ||
    user.memberId !== expected.memberId ||
    user.role !== expected.role
  )
    throw new CompanyFileError(
      '계정이 변경되었습니다. 다시 로그인해 주세요.',
      403,
    );
  return { ...snapshot, user };
}

// Compare exact text, including NULL for administrator bootstrap. JSONB equality
// would incorrectly treat differently serialized snapshots as the same revision.
export function fileStateGuard(payloadParameter: string, db: D1Database) {
  const comparison = isPostgresDatabase(db) ? 'IS NOT DISTINCT FROM' : 'IS';
  return `(SELECT payload FROM portal_state WHERE id = '${portalStateId}') ${comparison} ${payloadParameter}`;
}

export function fileUnlinkedGuard(payloadParameter: string, db: D1Database) {
  if (!isPostgresDatabase(db))
    return `NOT EXISTS (SELECT 1 FROM json_each(${payloadParameter}, '$.companyDocuments') document
      WHERE json_extract(document.value, '$.storageFileId') = f.id)`;
  const documents = `(${payloadParameter}::jsonb -> 'companyDocuments')`;
  // A missing field contains no links. A malformed field must deny deletion,
  // not silently become an empty array inside NOT EXISTS. NULL is bootstrap.
  return `(${payloadParameter}::text IS NULL OR (
    COALESCE(jsonb_typeof(${documents}), 'missing') IN ('missing', 'array')
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(${documents}) = 'array' THEN ${documents} ELSE '[]'::jsonb END
    ) document WHERE document.value ->> 'storageFileId' = f.id)
  ))`;
}

export function fileStateConflict() {
  return new CompanyFileError(
    '처리 중 계정 또는 운영 정보가 변경되었습니다. 최신 상태에서 다시 시도해 주세요.',
    409,
  );
}
