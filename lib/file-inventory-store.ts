import { Buffer } from 'node:buffer';
import {
  assertCompanyFileStorageKeyIntegrity,
  companyFileBucket,
  companyFileDatabase,
  companyFileMetadataIntegrityGuardSql,
  companyFileObjectMatchesIntegrity,
  ensureCompanyFileTables,
  findCompanyFile,
  readCompanyFileObjectIntegrity,
  CompanyFileError,
  type CompanyFileRow,
} from './company-files';
import { flowDatabase } from './consulting-flow-store';
import {
  FLOW_ADMIN_COMMAND_ACTOR_KEY,
  FLOW_ADMIN_COMMAND_ACTOR_NAME,
} from './flow-command-receipt';
import { PortalAccessError, requirePortalUser } from './portal-auth';
import { readPortalState } from './portal-state';
import {
  inventoryStates,
  type InventoryFilter,
  type InventoryItem,
  type InventoryPage,
  type InventoryPresence,
} from './file-inventory';
import { QueryRequestError, readSingleQueryParam } from './request-query';
import { readRouteParam, RouteParamError } from './request-path';
import { privateJsonResponse } from './private-response';

const pageSize = 25;
type Row = {
  source_type: InventoryItem['source'];
  id: string;
  original_name: string | null;
  company: string | null;
  title: string | null;
  category: string | null;
  size_bytes: number | null;
  created_at: string;
  assigned_trainee: string | null;
  partner_member_id: string | null;
  uploaded_by_email: string | null;
  owner_key: string | null;
  case_id: string | null;
  document_linked: number;
  flow_linked: number;
  status: InventoryItem['status'];
};
type Cursor = { createdAt: string; id: string; filter: InventoryFilter };

export async function requireInventoryAdmin(request: Request) {
  const state = await readPortalState();
  const user = await requirePortalUser(request, state);
  if (user.role !== 'admin')
    throw new PortalAccessError(
      '원본 보관 현황은 대표 관리자만 확인할 수 있습니다.',
      403,
    );
  return state;
}
async function inventoryDatabase() {
  const db = companyFileDatabase();
  await ensureCompanyFileTables(db);
  await flowDatabase();
  return db;
}
function parseQuery(url: URL) {
  const filter = readSingleQueryParam(url, 'status', 20) ?? 'unlinked';
  if (filter !== 'all' && !Object.hasOwn(inventoryStates, filter))
    throw new CompanyFileError('보관 상태 필터를 확인해 주세요.', 400);
  let cursor: Cursor | null = null;
  const encoded = readSingleQueryParam(url, 'cursor', 600);
  if (encoded) {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error();
      const value = JSON.parse(
        Buffer.from(encoded, 'base64url').toString('utf8'),
      );
      if (
        !value ||
        value.filter !== filter ||
        typeof value.createdAt !== 'string' ||
        value.createdAt.length > 80 ||
        typeof value.id !== 'string' ||
        !/^[A-Za-z0-9_-]{1,120}$/.test(value.id)
      )
        throw new Error();
      cursor = value;
    } catch {
      throw new CompanyFileError('목록을 처음부터 다시 조회해 주세요.', 400);
    }
  }
  return { filter: filter as InventoryFilter, cursor };
}
function documentIds(state: unknown) {
  const documents = (
    state as { companyDocuments?: Array<{ storageFileId?: unknown }> } | null
  )?.companyDocuments;
  return Array.isArray(documents)
    ? [
        ...new Set(
          documents
            .map((d) => d.storageFileId)
            .filter((id): id is string => typeof id === 'string'),
        ),
      ]
    : [];
}

export async function listFileInventory(
  url: URL,
  state: unknown,
): Promise<InventoryPage> {
  const { filter, cursor } = parseQuery(url);
  const db = await inventoryDatabase();
  // Only IDs and selected metadata leave SQL. Do not load transcripts, reports,
  // request fingerprints, private object keys or an entire R2 bucket into the UI.
  const rows = await db
    .prepare(`
    WITH document_refs AS (SELECT value AS id FROM json_each(?1)),
    flow_refs AS (SELECT DISTINCT json_extract(f.value, '$.intakeFileId') AS id
      FROM consulting_flows c, json_each(c.payload, '$.files') f
      WHERE json_extract(f.value, '$.intakeFileId') IS NOT NULL),
    candidates AS (
      SELECT 'company' AS source_type, f.id, f.original_name, f.company, f.title, f.category, f.size_bytes,
        f.created_at, f.assigned_trainee, a.partner_member_id, f.uploaded_by_email,
        u.owner_key, c.case_id, u.status AS upload_status, 1 AS has_metadata,
        CASE WHEN integrity.file_id IS NOT NULL
          AND object_key.file_id IS NOT NULL
          AND object_key.storage_key = f.storage_key
          AND ${companyFileMetadataIntegrityGuardSql}
          AND typeof(integrity.r2_content_type) = 'text'
          AND integrity.r2_content_type = f.content_type
          AND ((integrity.validation_mode = 'metadata' AND integrity.r2_etag IS NULL)
            OR (integrity.validation_mode = 'etag'
              AND typeof(integrity.r2_etag) = 'text'
              AND length(trim(integrity.r2_etag)) BETWEEN 1 AND 256))
          THEN 1 ELSE 0 END AS has_object_integrity
      FROM company_file_objects f
      LEFT JOIN company_file_assignments a ON a.file_id = f.id
      LEFT JOIN company_file_case_links c ON c.file_id = f.id
      LEFT JOIN company_file_upload_requests u ON u.file_id = f.id
      LEFT JOIN company_file_object_integrity integrity ON integrity.file_id = f.id
      LEFT JOIN company_file_storage_keys object_key ON object_key.file_id = f.id
      UNION ALL
      SELECT 'company', u.file_id, NULL, NULL, NULL, NULL, NULL, u.created_at, NULL, NULL, NULL,
        u.owner_key, NULL, u.status, 0, 0
      FROM company_file_upload_requests u
      WHERE NOT EXISTS (SELECT 1 FROM company_file_objects f WHERE f.id = u.file_id)
        AND (u.status <> 'deleted' OR u.file_id IN (SELECT id FROM document_refs) OR u.file_id IN (SELECT id FROM flow_refs))
      UNION ALL
      SELECT 'flow', u.file_id, u.original_name, NULL, '상담 FLOW 미완료 첨부',
        u.purpose, u.size_bytes, u.created_at, NULL, NULL, NULL, u.actor_key,
        u.case_id, u.status, 0, 0
      FROM consulting_flow_upload_requests u
      WHERE u.status = 'pending'
    ), classified AS (
      SELECT *, id IN (SELECT id FROM document_refs) AS document_linked,
        id IN (SELECT id FROM flow_refs) AS flow_linked,
        CASE WHEN upload_status = 'deleted' THEN 'deleted'
          WHEN upload_status = 'pending' THEN 'pending'
          WHEN has_metadata = 0 THEN 'inconsistent'
          WHEN has_object_integrity = 0 THEN 'inconsistent'
          WHEN id IN (SELECT id FROM document_refs) OR id IN (SELECT id FROM flow_refs) THEN 'linked'
          ELSE 'unlinked' END AS status
      FROM candidates
    ) SELECT * FROM classified
    WHERE (?2 = 'all' OR status = ?2)
      AND (?3 IS NULL OR created_at < ?3 OR (created_at = ?3 AND id < ?4))
    ORDER BY created_at DESC, id DESC LIMIT 26
  `)
    .bind(
      JSON.stringify(documentIds(state)),
      filter,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
    )
    .all<Row>();
  const members =
    (
      state as {
        members?: Array<{ id: string; name: string; email: string }>;
      } | null
    )?.members ?? [];
  const cases =
    (
      state as {
        cases?: Array<{
          id: string;
          company: string;
          trainee: string;
          partnerMemberId?: string;
        }>;
      } | null
    )?.cases ?? [];
  const page = rows.results.slice(0, pageSize);
  const items = page.map((row): InventoryItem => {
    const member = row.owner_key?.startsWith('member:')
      ? members.find((m) => `member:${m.id}` === row.owner_key)
      : undefined;
    const uploader = member
      ? `${member.name} · ${member.email}`
      : row.owner_key === FLOW_ADMIN_COMMAND_ACTOR_KEY
        ? FLOW_ADMIN_COMMAND_ACTOR_NAME
        : row.uploaded_by_email ||
          (row.owner_key?.startsWith('admin:')
            ? row.owner_key.slice(6)
            : '이전 계정 · 확인 필요');
    const linkedCase = row.case_id
      ? cases.find((item) => item.id === row.case_id)
      : undefined;
    return {
      id: row.id,
      source: row.source_type,
      fileName: row.original_name,
      company: row.company ?? linkedCase?.company ?? null,
      title: row.title,
      category: row.category,
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
      assignedTrainee: row.assigned_trainee ?? linkedCase?.trainee ?? null,
      partnerMemberId:
        row.partner_member_id ?? linkedCase?.partnerMemberId ?? null,
      uploader,
      caseId: row.case_id,
      documentLinked: Boolean(row.document_linked),
      flowLinked: Boolean(row.flow_linked),
      status: row.status,
    };
  });
  const last = page.at(-1);
  return {
    items,
    nextCursor:
      rows.results.length > pageSize && last
        ? Buffer.from(
            JSON.stringify({ createdAt: last.created_at, id: last.id, filter }),
          ).toString('base64url')
        : null,
    checkedAt: new Date().toISOString(),
  };
}

export async function checkInventoryPresence(
  id: string,
): Promise<InventoryPresence> {
  id = readRouteParam(id, 120, '파일 식별값을 확인해 주세요.');
  const db = await inventoryDatabase();
  const rows = await db
    .prepare(`SELECT 'company' AS source_type, f.id, f.storage_key, f.content_type, f.size_bytes, u.file_id
    FROM company_file_objects f LEFT JOIN company_file_upload_requests u ON u.file_id = f.id WHERE f.id = ?1
    UNION ALL SELECT 'company', NULL, 'company-source/' || file_id, NULL, NULL, file_id
    FROM company_file_upload_requests
    WHERE file_id = ?1 AND NOT EXISTS (SELECT 1 FROM company_file_objects WHERE id = ?1)
    UNION ALL SELECT 'flow', NULL, storage_key, content_type, size_bytes, file_id
    FROM consulting_flow_upload_requests
    WHERE file_id = ?1 AND status = 'pending' LIMIT 2`)
    .bind(id)
    .all<{
      source_type: 'company' | 'flow';
      id: string | null;
      storage_key: string | null;
      content_type: string | null;
      size_bytes: number | null;
      file_id: string | null;
    }>();
  if (rows.results.length === 0)
    throw new CompanyFileError('확인할 파일 기록을 찾지 못했습니다.', 404);
  if (rows.results.length !== 1)
    throw new CompanyFileError(
      '같은 파일 식별값의 보관 기록이 둘 이상입니다.',
      409,
    );
  const row = rows.results[0];
  let file: CompanyFileRow | null = null;
  if (
    row.source_type === 'company' &&
    row.id !== null &&
    row.storage_key !== null &&
    row.content_type !== null &&
    row.size_bytes !== null
  ) {
    file = await findCompanyFile(row.id);
    if (!file)
      throw new CompanyFileError('확인할 파일 기록을 찾지 못했습니다.', 404);
    await assertCompanyFileStorageKeyIntegrity({
      id: file.id,
      storage_key: file.storage_key,
      content_type: file.content_type,
      size_bytes: file.size_bytes,
    });
  }
  const key = file?.storage_key ?? row.storage_key;
  if (!key)
    throw new CompanyFileError('확인할 파일 저장 위치가 없습니다.', 409);
  const object = await companyFileBucket().head(key);
  let integrityMode: InventoryPresence['integrityMode'] = null;
  let integrityMatches: boolean | null = null;
  if (object && file) {
    try {
      const integrity = await readCompanyFileObjectIntegrity(file);
      integrityMode = integrity.validationMode;
      integrityMatches = companyFileObjectMatchesIntegrity(
        file,
        object,
        integrity,
      );
    } catch (error) {
      if (!(error instanceof CompanyFileError) || error.status !== 503)
        throw error;
      integrityMatches = false;
    }
  }
  return {
    id,
    exists: Boolean(object),
    sizeBytes: object?.size ?? null,
    expectedSizeBytes: file?.size_bytes ?? row.size_bytes,
    sizeMatches:
      object && (file?.size_bytes ?? row.size_bytes) !== null
        ? object.size === (file?.size_bytes ?? row.size_bytes)
        : null,
    integrityMode,
    integrityMatches,
    checkedAt: new Date().toISOString(),
  };
}

export const inventoryJson = (value: unknown, status = 200) =>
  privateJsonResponse(value, { status });
export function inventoryError(error: unknown) {
  if (
    error instanceof PortalAccessError ||
    error instanceof CompanyFileError ||
    error instanceof QueryRequestError ||
    error instanceof RouteParamError
  )
    return inventoryJson({ error: error.message }, error.status);
  return inventoryJson(
    {
      error:
        '원본 보관 상태를 확인하지 못했습니다. 연결을 확인한 후 다시 조회해 주세요.',
    },
    503,
  );
}
