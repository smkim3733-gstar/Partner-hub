import {
  companyFileBucket,
  companyFileDatabase,
  companyFileMetadataIntegrityGuardSql,
  companyFileObjectMatchesIntegrity,
  ensureCompanyFileTables,
  assertCompanyFileMetadataIntegrity,
  readCompanyFileObjectIntegrity,
  type CompanyFileRow,
} from './company-files';
import { isPostgresDatabase } from './database-dialect';

type IntegrityRecord = Record<string, unknown>;
type ProvenanceRow = CompanyFileRow & {
  upload_status: string | null;
};

export type CompanyDocumentFileProvenanceCheck = {
  requiresCommitGuard: boolean;
  error: string | null;
};

function records(value: unknown): IntegrityRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is IntegrityRecord =>
        Boolean(item && typeof item === 'object' && !Array.isArray(item)),
      )
    : [];
}

function newOriginalDocuments(currentValue: unknown, nextValue: unknown) {
  const currentIds = new Set(
    records(currentValue)
      .map((document) => document.storageFileId)
      .filter((id): id is string => typeof id === 'string'),
  );
  return records(nextValue).filter(
    (document) =>
      typeof document.storageFileId === 'string' &&
      !currentIds.has(document.storageFileId),
  );
}

function optionalString(record: IntegrityRecord, field: string) {
  return typeof record[field] === 'string' ? record[field] : null;
}

function sameLedgerFacts(document: IntegrityRecord, row: ProvenanceRow) {
  const partnerMemberId = optionalString(document, 'partnerMemberId');
  return (
    document.fileName === row.original_name &&
    document.fileSize === row.size_bytes &&
    document.company === row.company &&
    document.category === row.category &&
    partnerMemberId === (row.partner_member_id ?? null) &&
    optionalString(document, 'caseId') === (row.case_id ?? null) &&
    (row.partner_member_id !== null ||
      document.assignedTrainee === row.assigned_trainee)
  );
}

async function provenanceRow(id: string) {
  return companyFileDatabase()
    .prepare(`SELECT f.id, f.storage_key, f.original_name, f.company,
      f.category, f.title, f.assigned_trainee, f.uploaded_by_user_id,
      f.uploaded_by_email, f.content_type, f.size_bytes, f.created_at,
      a.partner_member_id, c.case_id, u.status AS upload_status
      FROM company_file_objects f
      LEFT JOIN company_file_assignments a ON a.file_id = f.id
      LEFT JOIN company_file_case_links c ON c.file_id = f.id
      LEFT JOIN company_file_upload_requests u ON u.file_id = f.id
      WHERE f.id = ?1`)
    .bind(id)
    .first<ProvenanceRow>();
}

export async function checkNewCompanyDocumentFileProvenance(
  currentValue: unknown,
  nextValue: unknown,
): Promise<CompanyDocumentFileProvenanceCheck> {
  const documents = newOriginalDocuments(currentValue, nextValue);
  if (documents.length === 0)
    return { requiresCommitGuard: false, error: null };

  const db = companyFileDatabase();
  await ensureCompanyFileTables(db);
  const bucket = companyFileBucket();

  for (const document of documents) {
    const row = await provenanceRow(document.storageFileId as string);
    if (!row)
      return {
        requiresCommitGuard: true,
        error:
          '기업자료 원본을 보관 원장에서 찾을 수 없습니다. 원본 보관 현황에서 다시 확인해 주세요.',
      };
    await assertCompanyFileMetadataIntegrity(row);
    if (row.upload_status !== null && row.upload_status !== 'ready')
      return {
        requiresCommitGuard: true,
        error:
          '기업자료 원본 저장이 완료되지 않았거나 삭제되었습니다. 원본 보관 현황에서 다시 확인해 주세요.',
      };
    if (!sameLedgerFacts(document, row))
      return {
        requiresCommitGuard: true,
        error:
          '기업자료 원본 정보가 보관 원장과 일치하지 않습니다. 원본 보관 현황에서 다시 확인해 주세요.',
      };
    const integrity = await readCompanyFileObjectIntegrity(row);
    const object = await bucket.head(row.storage_key);
    if (!object || !companyFileObjectMatchesIntegrity(row, object, integrity))
      return {
        requiresCommitGuard: true,
        error:
          '기업자료 원본 파일의 보관 상태 또는 크기를 확인해야 합니다. 원본 보관 현황에서 다시 확인해 주세요.',
      };
  }

  return { requiresCommitGuard: true, error: null };
}

/**
 * Runs inside the portal-state CAS write. ?1 is the proposed payload and ?4 is
 * the exact current payload. This closes deletion and reassignment races after
 * the R2/D1 preflight without retroactively requiring old cards to have a
 * current ledger row.
 */
export const companyDocumentFileProvenanceCommitConditionSql = `
NOT EXISTS (
  SELECT 1 FROM json_each(?1, '$.companyDocuments') proposed
  WHERE json_type(proposed.value, '$.storageFileId') = 'text'
    AND NOT EXISTS (
      SELECT 1 FROM json_each(COALESCE(?4, '{}'), '$.companyDocuments') current
      WHERE json_extract(current.value, '$.storageFileId') =
        json_extract(proposed.value, '$.storageFileId')
    )
    AND NOT EXISTS (
      SELECT 1 FROM company_file_objects f
      LEFT JOIN company_file_assignments a ON a.file_id = f.id
      LEFT JOIN company_file_case_links c ON c.file_id = f.id
      LEFT JOIN company_file_upload_requests u ON u.file_id = f.id
      JOIN company_file_object_integrity integrity ON integrity.file_id = f.id
      WHERE f.id = json_extract(proposed.value, '$.storageFileId')
        AND ${companyFileMetadataIntegrityGuardSql}
        AND f.original_name = json_extract(proposed.value, '$.fileName')
        AND f.size_bytes = json_extract(proposed.value, '$.fileSize')
        AND f.company = json_extract(proposed.value, '$.company')
        AND f.category = json_extract(proposed.value, '$.category')
        AND a.partner_member_id IS
          json_extract(proposed.value, '$.partnerMemberId')
        AND c.case_id IS json_extract(proposed.value, '$.caseId')
        AND (a.partner_member_id IS NOT NULL OR f.assigned_trainee =
          json_extract(proposed.value, '$.assignedTrainee'))
        AND (u.status IS NULL OR u.status = 'ready')
        AND integrity.r2_content_type = f.content_type
        AND ((integrity.validation_mode = 'metadata' AND integrity.r2_etag IS NULL)
          OR (integrity.validation_mode = 'etag' AND typeof(integrity.r2_etag) = 'text'
            AND length(integrity.r2_etag) BETWEEN 1 AND 256))
    )
)`;

export function companyDocumentFileProvenanceCommitCondition(db: D1Database) {
  if (!isPostgresDatabase(db)) return companyDocumentFileProvenanceCommitConditionSql;
  const documents = (parameter: string) => `(${parameter}::text::jsonb -> 'companyDocuments')`;
  const shape = (parameter: string) =>
    `COALESCE(jsonb_typeof(${documents(parameter)}), 'missing') IN ('missing', 'array')`;
  const array = (parameter: string) =>
    `CASE WHEN jsonb_typeof(${documents(parameter)}) = 'array' THEN ${documents(parameter)} ELSE '[]'::jsonb END`;
  // Missing optional IDs and JSON null represent no ledger row, but numbers or
  // booleans must not be coerced into string identifiers. Compare sizes as JSON
  // numbers without casting untrusted JSON text to bigint.
  return `${shape('?1')} AND ${shape('?4')} AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(${array('?1')}) proposed
    WHERE jsonb_typeof(proposed.value -> 'storageFileId') = 'string'
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(${array('?4')}) current
        WHERE current.value -> 'storageFileId' = proposed.value -> 'storageFileId'
      )
      AND NOT EXISTS (
        SELECT 1 FROM company_file_objects f
        LEFT JOIN company_file_assignments a ON a.file_id = f.id
        LEFT JOIN company_file_case_links c ON c.file_id = f.id
        LEFT JOIN company_file_upload_requests u ON u.file_id = f.id
        JOIN company_file_object_integrity integrity ON integrity.file_id = f.id
        WHERE f.id = proposed.value ->> 'storageFileId'
          AND ${companyFileMetadataIntegrityGuardSql}
          AND to_jsonb(f.original_name) = proposed.value -> 'fileName'
          AND to_jsonb(f.size_bytes) = proposed.value -> 'fileSize'
          AND to_jsonb(f.company) = proposed.value -> 'company'
          AND to_jsonb(f.category) = proposed.value -> 'category'
          AND COALESCE(jsonb_typeof(proposed.value -> 'partnerMemberId'), 'null') IN ('null', 'string')
          AND a.partner_member_id IS NOT DISTINCT FROM (proposed.value ->> 'partnerMemberId')
          AND COALESCE(jsonb_typeof(proposed.value -> 'caseId'), 'null') IN ('null', 'string')
          AND c.case_id IS NOT DISTINCT FROM (proposed.value ->> 'caseId')
          AND (a.partner_member_id IS NOT NULL OR to_jsonb(f.assigned_trainee) = proposed.value -> 'assignedTrainee')
          AND (u.status IS NULL OR u.status = 'ready')
          AND integrity.r2_content_type = f.content_type
          AND ((integrity.validation_mode = 'metadata' AND integrity.r2_etag IS NULL)
            OR (integrity.validation_mode = 'etag' AND integrity.r2_etag IS NOT NULL
              AND length(integrity.r2_etag) BETWEEN 1 AND 256))
      )
  )`;
}
