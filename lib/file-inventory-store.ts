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
import {
  flowDatabase,
  flowFileObjectMatchesIntegrity,
  readFlow,
  readFlowFileObjectIntegrity,
} from './consulting-flow-store';
import {
  FLOW_FIELD_LIMITS,
  FLOW_OBJECT_KEYS,
  FLOW_TEXT_LIMITS,
} from './consulting-flow-shape';
import { FlowError, type FlowFile } from './consulting-flow';
import {
  flowUploadReceiptRules,
  flowUploadReceiptTargetRules,
} from './consulting-flow-upload-policy';
import {
  FLOW_ADMIN_COMMAND_ACTOR_KEY,
  FLOW_ADMIN_COMMAND_ACTOR_NAME,
} from './flow-command-receipt';
import { PortalAccessError, requirePortalUser } from './portal-auth';
import { readPortalState } from './portal-state';
import {
  inventorySources,
  inventoryStates,
  type InventoryFilter,
  type InventoryItem,
  type InventoryPage,
  type InventoryPresence,
} from './file-inventory';
import { QueryRequestError, readSingleQueryParam } from './request-query';
import { readRouteParam, RouteParamError } from './request-path';
import { privateJsonResponse } from './private-response';
import { isPostgresDatabase } from './database-dialect';
import {
  postgresInventoryListSql,
  postgresInventoryPresenceSql,
} from './file-inventory-postgres';

const pageSize = 25;
const sqlTextLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;
// Mirrors ECMAScript trim whitespace in one literal; repeated char() chains exceed D1's expression-depth limit.
const sqliteTrimCharacters = `'\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'`;
const nonBlankSqlText = (expression: string) =>
  `trim(${expression}, ${sqliteTrimCharacters}) <> ''`;
// JSON1 exposes an unpaired UTF-16 surrogate as its invalid UTF-8 byte form ED A0..BF 80..BF.
const wellFormedUnicodeSql = (expression: string) =>
  `hex(${expression}) NOT GLOB '*ED[AB][0-9A-F][89AB][0-9A-F]*'`;
const flowReceiptAllowedFieldsSql = FLOW_OBJECT_KEYS.receipt
  .map(sqlTextLiteral)
  .join(', ');
const flowReceiptFieldEnvelopeSql = `NOT EXISTS (
  SELECT 1 FROM json_each(receipt.value) field
  WHERE field.key NOT IN (${flowReceiptAllowedFieldsSql})
)`;
const flowAuditAllowedFieldsSql = FLOW_OBJECT_KEYS.audit
  .map((field) => sqlTextLiteral(`$.${field}`))
  .join(', ');
const flowAuditFieldEnvelopeSql = `json_remove(audit.value, ${flowAuditAllowedFieldsSql}) = '{}'`;
const flowAuditDetailSql = "json_extract(audit.value, '$.detail')";
// One CASE keeps the large inventory predicate below D1's depth-100 ceiling.
const flowAuditDetailEnvelopeSql = `CASE
  WHEN json_type(audit.value, '$.detail') = 'text'
  THEN length(${flowAuditDetailSql})
      BETWEEN 1 AND ${FLOW_TEXT_LIMITS.auditDetail}
    AND ${nonBlankSqlText(flowAuditDetailSql)}
    AND ${wellFormedUnicodeSql(flowAuditDetailSql)}
  ELSE 0 END = 1`;
const flowReceiptActorSql = "json_extract(receipt.value, '$.actor')";
const flowReceiptActorEnvelopeSql = `CASE
  WHEN json_type(receipt.value, '$.actor') = 'text'
  THEN length(${flowReceiptActorSql})
      BETWEEN 1 AND ${FLOW_FIELD_LIMITS.actor}
    AND ${nonBlankSqlText(flowReceiptActorSql)}
    AND ${wellFormedUnicodeSql(flowReceiptActorSql)}
  ELSE 0 END = 1`;
const flowUploadIntakeColumns = [
  'upload.intake_file_id',
  'upload.intake_source_hash',
  'upload.source_reviewed_at',
  'upload.source_reviewed_by',
] as const;
const flowUploadIntakeBindingSql = (mode: 'absent' | 'required') =>
  flowUploadIntakeColumns
    .map((column) => `${column} IS ${mode === 'required' ? 'NOT ' : ''}NULL`)
    .join(' AND ');
const flowReceiptUploadBindingSql = `(${Object.entries(flowUploadReceiptRules)
  .map(
    ([action, rule]) =>
      `(json_extract(receipt.value, '$.action') = ${sqlTextLiteral(action)}
        AND upload.purpose = ${sqlTextLiteral(rule.purpose)}
        AND upload.slot IN (${rule.slots.map(sqlTextLiteral).join(', ')})
        AND ${flowUploadIntakeBindingSql(rule.intakeProvenance)})`,
  )
  .join(' OR ')})`;
const flowReceiptTargetActionsSql = Object.keys(flowUploadReceiptTargetRules)
  .map(sqlTextLiteral)
  .join(', ');
const flowReceiptExplicitTargetActionsSql = Object.entries(
  flowUploadReceiptTargetRules,
)
  .filter(([, rule]) => rule.target.kind === 'receipt')
  .map(([action]) => sqlTextLiteral(action))
  .join(', ');
const flowReceiptTargetEnvelopeSql = `(
  (json_extract(receipt.value, '$.action') IN (${flowReceiptExplicitTargetActionsSql})
    AND json_type(receipt.value, '$.targetId') = 'text')
  OR (json_extract(receipt.value, '$.action') NOT IN (${flowReceiptExplicitTargetActionsSql})
    AND json_type(receipt.value, '$.targetId') IS NULL)
)`;
const flowReceiptTargetBindingSql = `(
  json_extract(receipt.value, '$.action') NOT IN (${flowReceiptTargetActionsSql})
  OR ${Object.entries(flowUploadReceiptTargetRules)
    .map(([action, rule]) => {
      const targetIdSql =
        rule.target.kind === 'command_suffix'
          ? `upload.command_id || '-${rule.target.suffix}'`
          : `json_extract(receipt.value, '$.targetId')`;
      const safePayloadSql = `CASE WHEN json_valid(flow.payload) THEN flow.payload ELSE '{}' END`;
      const targetBindingSql =
        rule.source.kind === 'collection'
          ? `(SELECT COUNT(*) FROM json_each(
              ${safePayloadSql}, '$.${rule.source.path}') target
            WHERE target.type = 'object'
              AND json_extract(target.value, '$.id') = ${targetIdSql}
              AND (${Object.entries(rule.slots)
                .map(
                  ([slot, field]) =>
                    `(upload.slot = ${sqlTextLiteral(slot)}
                      AND json_extract(target.value, '$.${field}') =
                        upload.file_id)`,
                )
                .join(' OR ')})) = 1`
          : `(json_type(${safePayloadSql}, '$.${rule.source.path}') = 'object'
              AND json_extract(${safePayloadSql},
                '$.${rule.source.path}.${rule.source.idField}') = ${targetIdSql}
              AND (${Object.entries(rule.slots)
                .map(
                  ([slot, field]) =>
                    `(upload.slot = ${sqlTextLiteral(slot)}
                      AND json_extract(${safePayloadSql},
                        '$.${rule.source.path}.${field}') = upload.file_id)`,
                )
                .join(' OR ')}))`;
      return `(json_extract(receipt.value, '$.action') = ${sqlTextLiteral(action)}
          AND ${targetBindingSql})`;
    })
    .join(' OR ')}
)`;
const flowReceiptAuditBindingSql = `(
  ${flowReceiptFieldEnvelopeSql}
  AND (
    ((json_type(receipt.value, '$.actor') IS NULL
      AND json_type(receipt.value, '$.action') IS NULL)
      AND json_type(receipt.value, '$.targetId') IS NULL)
    OR (
      ((${flowReceiptActorEnvelopeSql}
        AND json_type(receipt.value, '$.action') = 'text')
        AND (
          (SELECT COUNT(*) FROM json_each(
              CASE WHEN json_valid(flow.payload) THEN flow.payload
                ELSE '{"audit":[]}' END, '$.audit') audit
            WHERE (
                (audit.type = 'object' AND ${flowAuditFieldEnvelopeSql})
                AND (${flowAuditDetailEnvelopeSql}
                  AND json_extract(audit.value, '$.id') = upload.command_id)
              )
              AND (
                (json_extract(audit.value, '$.actor') =
                    json_extract(receipt.value, '$.actor')
                  AND json_extract(audit.value, '$.action') =
                    json_extract(receipt.value, '$.action'))
                AND json_extract(audit.value, '$.at') = upload.created_at
              )) = 1
          AND ${flowReceiptUploadBindingSql}
        )
      )
      AND (${flowReceiptTargetEnvelopeSql}
        AND ${flowReceiptTargetBindingSql})
    )
  )
)`;
type Row = {
  source_type: InventoryItem['source'];
  id: string;
  id_collision: number;
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
  integrity_proof: InventoryItem['integrityProof'];
  status: InventoryItem['status'];
};
type InventoryQueryRow =
  | (Row & {
      row_kind: 'item';
      coverage_sha256: null;
      coverage_etag: null;
      coverage_metadata: null;
      coverage_unavailable: null;
    })
  | {
      row_kind: 'coverage';
      coverage_sha256: number;
      coverage_etag: number;
      coverage_metadata: number;
      coverage_unavailable: number;
    };
type Cursor = {
  createdAt: string;
  id: string;
  source: InventoryItem['source'];
  filter: InventoryFilter;
};

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
        !/^[A-Za-z0-9_-]{1,200}$/.test(value.id) ||
        typeof value.source !== 'string' ||
        !Object.hasOwn(inventorySources, value.source)
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
  const queryRows = await db
    .prepare(
      isPostgresDatabase(db)
        ? postgresInventoryListSql
        : `
    WITH document_refs AS (SELECT value AS id FROM json_each(?1)),
    flow_refs AS (SELECT DISTINCT json_extract(f.value, '$.intakeFileId') AS id
      FROM consulting_flows c,
        json_each(CASE WHEN json_valid(c.payload) THEN c.payload
          ELSE '{"files":[]}' END, '$.files') f
      WHERE json_type(f.value) = 'object'
        AND json_type(f.value, '$.intakeFileId') = 'text'),
    flow_file_bindings AS (
      SELECT flow.case_id, flow.updated_at AS flow_updated_at,
        json_extract(file.value, '$.id') AS id,
        json_extract(file.value, '$.key') AS storage_key,
        json_extract(file.value, '$.createdAt') AS created_at,
        json_extract(file.value, '$.name') AS original_name,
        json_extract(file.value, '$.contentType') AS content_type,
        json_extract(file.value, '$.size') AS size_bytes,
        json_extract(file.value, '$.purpose') AS purpose,
        json_extract(file.value, '$.intakeFileId') AS intake_file_id,
        json_extract(file.value, '$.intakeSourceHash') AS intake_source_hash,
        json_extract(file.value, '$.sourceReviewedAt') AS source_reviewed_at,
        json_extract(file.value, '$.sourceReviewedBy') AS source_reviewed_by
      FROM consulting_flows flow,
        json_each(CASE WHEN json_valid(flow.payload) THEN flow.payload
          ELSE '{"files":[]}' END, '$.files') file
      WHERE json_type(file.value) = 'object'
        AND json_type(file.value, '$.id') = 'text'
    ), flow_file_refs AS (
      SELECT DISTINCT id FROM flow_file_bindings
    ), flow_orphan_payloads AS (
      SELECT binding.id,
        CASE WHEN COUNT(*) = 1 THEN MAX(CASE
          WHEN typeof(binding.original_name) = 'text'
            AND length(binding.original_name) <= 500
          THEN binding.original_name END) END AS original_name,
        CASE WHEN COUNT(*) = 1 THEN MAX(CASE
          WHEN typeof(binding.purpose) = 'text'
            AND length(binding.purpose) <= 200
          THEN binding.purpose END) END AS purpose,
        CASE WHEN COUNT(*) = 1 THEN MAX(CASE
          WHEN typeof(binding.size_bytes) = 'integer'
            AND binding.size_bytes BETWEEN 0 AND 9007199254740991
          THEN binding.size_bytes END) END AS size_bytes,
        MIN(CASE
          WHEN typeof(binding.created_at) = 'text'
            AND length(binding.created_at) <= 80
            AND julianday(binding.created_at) IS NOT NULL
          THEN binding.created_at
          WHEN typeof(binding.flow_updated_at) = 'text'
            AND length(binding.flow_updated_at) <= 80
            AND julianday(binding.flow_updated_at) IS NOT NULL
          THEN binding.flow_updated_at
          ELSE '1970-01-01T00:00:00.000Z' END) AS created_at,
        CASE WHEN COUNT(*) = 1 THEN MAX(CASE
          WHEN typeof(binding.case_id) = 'text'
            AND length(binding.case_id) BETWEEN 1 AND 200
          THEN binding.case_id END) END AS case_id
      FROM flow_file_bindings binding
      WHERE length(binding.id) BETWEEN 1 AND 200
        AND binding.id NOT GLOB '*[^A-Za-z0-9_-]*'
        AND typeof(binding.storage_key) = 'text'
        AND NOT EXISTS (SELECT 1 FROM consulting_flow_file_owners owner
          WHERE owner.file_id = binding.id)
      GROUP BY binding.id
    ), flow_child_ledger_ids AS (
      SELECT file_id FROM consulting_flow_file_metadata
      UNION
      SELECT file_id FROM consulting_flow_file_object_integrity
      UNION
      SELECT file_id FROM consulting_flow_file_object_checksums
    ), flow_receipt_ids AS (
      SELECT file_id FROM consulting_flow_upload_requests WHERE status = 'ready'
      UNION
      SELECT file_id FROM consulting_flow_upload_completions
    ), flow_orphan_child_ledgers AS (
      SELECT ledger.file_id AS id,
        CASE WHEN typeof(metadata.original_name) = 'text'
          AND length(metadata.original_name) <= 500
          THEN metadata.original_name ELSE NULL END AS original_name,
        CASE WHEN typeof(metadata.purpose) = 'text'
          AND length(metadata.purpose) <= 200
          THEN metadata.purpose ELSE NULL END AS purpose,
        CASE WHEN typeof(metadata.size_bytes) = 'integer'
          AND metadata.size_bytes BETWEEN 0 AND 9007199254740991
          THEN metadata.size_bytes ELSE NULL END AS size_bytes,
        CASE WHEN typeof(upload.created_at) = 'text'
          AND length(upload.created_at) <= 80
          AND julianday(upload.created_at) IS NOT NULL
          THEN upload.created_at
          ELSE '1970-01-01T00:00:00.000Z' END AS created_at
      FROM flow_child_ledger_ids ledger
      LEFT JOIN consulting_flow_file_metadata metadata
        ON metadata.file_id = ledger.file_id
      LEFT JOIN consulting_flow_upload_requests upload
        ON upload.file_id = ledger.file_id
      WHERE length(ledger.file_id) BETWEEN 1 AND 200
        AND ledger.file_id NOT GLOB '*[^A-Za-z0-9_-]*'
        AND NOT EXISTS (SELECT 1 FROM consulting_flow_file_owners owner
          WHERE owner.file_id = ledger.file_id)
        AND NOT EXISTS (SELECT 1 FROM flow_orphan_payloads orphan
          WHERE orphan.id = ledger.file_id)
    ), flow_orphan_receipts AS (
      SELECT receipt.file_id AS id,
        CASE WHEN typeof(upload.original_name) = 'text'
          AND length(upload.original_name) <= 500
          THEN upload.original_name ELSE NULL END AS original_name,
        CASE WHEN typeof(upload.purpose) = 'text'
          AND length(upload.purpose) <= 200
          THEN upload.purpose ELSE NULL END AS purpose,
        CASE WHEN typeof(upload.size_bytes) = 'integer'
          AND upload.size_bytes BETWEEN 0 AND 9007199254740991
          THEN upload.size_bytes ELSE NULL END AS size_bytes,
        CASE WHEN typeof(upload.created_at) = 'text'
          AND length(upload.created_at) <= 80
          AND julianday(upload.created_at) IS NOT NULL
          THEN upload.created_at
          ELSE '1970-01-01T00:00:00.000Z' END AS created_at,
        CASE WHEN typeof(upload.case_id) = 'text'
          AND length(upload.case_id) BETWEEN 1 AND 200
          THEN upload.case_id ELSE NULL END AS case_id,
        CASE WHEN upload.status = 'ready'
          THEN '상담 FLOW 완료 예약 원장 누락 첨부'
          ELSE '상담 FLOW 완료 영수증 고아 기록' END AS title
      FROM flow_receipt_ids receipt
      LEFT JOIN consulting_flow_upload_requests upload
        ON upload.file_id = receipt.file_id
      WHERE length(receipt.file_id) BETWEEN 1 AND 200
        AND receipt.file_id NOT GLOB '*[^A-Za-z0-9_-]*'
        AND NOT EXISTS (SELECT 1 FROM consulting_flow_file_owners owner
          WHERE owner.file_id = receipt.file_id)
        AND NOT EXISTS (SELECT 1 FROM flow_orphan_payloads orphan
          WHERE orphan.id = receipt.file_id)
        AND NOT EXISTS (SELECT 1 FROM flow_child_ledger_ids ledger
          WHERE ledger.file_id = receipt.file_id)
    ), flow_orphan_inventory AS (
      SELECT id, original_name, purpose, size_bytes, created_at, case_id,
        '상담 FLOW 소유 원장 누락 첨부' AS title
      FROM flow_orphan_payloads
      UNION ALL
      SELECT id, original_name, purpose, size_bytes, created_at, NULL,
        '상담 FLOW 소유·payload 누락 원장'
      FROM flow_orphan_child_ledgers
      UNION ALL
      SELECT id, original_name, purpose, size_bytes, created_at, case_id, title
      FROM flow_orphan_receipts
    ), flow_owner_payload_bindings AS (
      SELECT owner.file_id, COUNT(binding.id) AS payload_count,
        COALESCE(SUM(CASE WHEN
          binding.case_id = owner.case_id
          AND binding.storage_key = owner.storage_key
          AND binding.created_at = owner.created_at
          AND binding.original_name = metadata.original_name
          AND binding.content_type = metadata.content_type
          AND binding.size_bytes = metadata.size_bytes
          AND binding.purpose = metadata.purpose
          AND binding.intake_file_id IS metadata.intake_file_id
          AND binding.intake_source_hash IS metadata.intake_source_hash
          AND binding.source_reviewed_at IS metadata.source_reviewed_at
          AND binding.source_reviewed_by IS metadata.source_reviewed_by
          THEN 1 ELSE 0 END), 0) AS exact_count
      FROM consulting_flow_file_owners owner
      LEFT JOIN consulting_flow_file_metadata metadata
        ON metadata.file_id = owner.file_id
      LEFT JOIN flow_file_bindings binding ON binding.id = owner.file_id
      GROUP BY owner.file_id
    ), flow_owner_receipt_bindings AS (
      SELECT owner.file_id, CASE
        WHEN upload.file_id IS NULL AND completion.file_id IS NULL THEN 1
        WHEN upload.file_id IS NOT NULL
          AND upload.status = 'ready'
          AND completion.file_id = upload.file_id
          AND completion.command_id = upload.command_id
          AND upload.case_id = owner.case_id
          AND upload.storage_key = owner.storage_key
          AND upload.original_name = metadata.original_name
          AND upload.content_type = metadata.content_type
          AND upload.size_bytes = metadata.size_bytes
          AND upload.purpose = metadata.purpose
          AND upload.intake_file_id IS metadata.intake_file_id
          AND upload.intake_source_hash IS metadata.intake_source_hash
          AND upload.source_reviewed_at IS metadata.source_reviewed_at
          AND upload.source_reviewed_by IS metadata.source_reviewed_by
          AND upload.created_at = owner.created_at
          AND EXISTS (
            SELECT 1 FROM consulting_flows flow
            WHERE flow.case_id = owner.case_id
              AND json_type(CASE WHEN json_valid(flow.payload)
                THEN flow.payload ELSE '{}' END, '$.commandIds') = 'array'
              AND json_type(CASE WHEN json_valid(flow.payload)
                THEN flow.payload ELSE '{}' END, '$.commandReceipts') = 'object'
              AND (SELECT COUNT(*) FROM json_each(
                  CASE WHEN json_valid(flow.payload) THEN flow.payload
                    ELSE '{"commandIds":[]}' END, '$.commandIds') command
                WHERE command.type = 'text'
                  AND command.value = upload.command_id) = 1
              AND (SELECT COUNT(*) FROM json_each(
                  CASE WHEN json_valid(flow.payload) THEN flow.payload
                    ELSE '{"commandReceipts":{}}' END,
                  '$.commandReceipts') receipt
                WHERE receipt.key = upload.command_id
                  AND receipt.type = 'object'
                  AND json_extract(receipt.value, '$.actorKey') = upload.actor_key
                  AND json_extract(receipt.value, '$.fingerprint') = upload.fingerprint
                  AND ${flowReceiptAuditBindingSql}
                ) = 1)
        THEN 1 ELSE 0 END AS receipt_valid
      FROM consulting_flow_file_owners owner
      LEFT JOIN consulting_flow_file_metadata metadata
        ON metadata.file_id = owner.file_id
      LEFT JOIN consulting_flow_upload_requests upload
        ON upload.file_id = owner.file_id
      LEFT JOIN consulting_flow_upload_completions completion
        ON completion.file_id = owner.file_id
    ),
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
          AND ((integrity.validation_mode = 'metadata' AND integrity.r2_etag IS NULL
              AND checksum.file_id IS NULL)
            OR (integrity.validation_mode = 'etag'
              AND typeof(integrity.r2_etag) = 'text'
              AND length(trim(integrity.r2_etag)) BETWEEN 1 AND 256
              AND (checksum.file_id IS NULL OR
                (typeof(checksum.sha256) = 'text' AND length(checksum.sha256) = 64
                  AND checksum.sha256 NOT GLOB '*[^0-9a-f]*'))))
          THEN 1 ELSE 0 END AS has_object_integrity,
        integrity.validation_mode, checksum.sha256 AS checksum_sha256
      FROM company_file_objects f
      LEFT JOIN company_file_assignments a ON a.file_id = f.id
      LEFT JOIN company_file_case_links c ON c.file_id = f.id
      LEFT JOIN company_file_upload_requests u ON u.file_id = f.id
      LEFT JOIN company_file_object_integrity integrity ON integrity.file_id = f.id
      LEFT JOIN company_file_object_checksums checksum ON checksum.file_id = f.id
      LEFT JOIN company_file_storage_keys object_key ON object_key.file_id = f.id
      UNION ALL
      SELECT 'company', u.file_id, NULL, NULL, NULL, NULL, NULL, u.created_at, NULL, NULL, NULL,
        u.owner_key, NULL, u.status, 0, 0, NULL, NULL
      FROM company_file_upload_requests u
      WHERE NOT EXISTS (SELECT 1 FROM company_file_objects f WHERE f.id = u.file_id)
        AND (u.status <> 'deleted' OR u.file_id IN (SELECT id FROM document_refs) OR u.file_id IN (SELECT id FROM flow_refs))
      UNION ALL
      SELECT 'flow', owner.file_id, metadata.original_name, NULL,
        '상담 FLOW 보관 첨부', metadata.purpose, metadata.size_bytes,
        owner.created_at, NULL, NULL, NULL, upload.actor_key, owner.case_id,
        upload.status, CASE WHEN metadata.file_id IS NOT NULL THEN 1 ELSE 0 END,
        CASE WHEN owner.storage_key = 'consulting-flow/' || owner.file_id
          AND metadata.file_id IS NOT NULL
          AND integrity.file_id IS NOT NULL
          AND integrity.r2_content_type = metadata.content_type
          AND payload_binding.payload_count = 1
          AND payload_binding.exact_count = 1
          AND receipt_binding.receipt_valid = 1
          AND ((integrity.validation_mode = 'metadata'
              AND integrity.r2_etag IS NULL AND checksum.file_id IS NULL)
            OR (integrity.validation_mode = 'etag'
              AND typeof(integrity.r2_etag) = 'text'
              AND length(trim(integrity.r2_etag)) BETWEEN 1 AND 256
              AND (checksum.file_id IS NULL OR
                (typeof(checksum.sha256) = 'text' AND length(checksum.sha256) = 64
                  AND checksum.sha256 NOT GLOB '*[^0-9a-f]*'))))
          THEN 1 ELSE 0 END,
        integrity.validation_mode, checksum.sha256
      FROM consulting_flow_file_owners owner
      LEFT JOIN consulting_flow_file_metadata metadata
        ON metadata.file_id = owner.file_id
      LEFT JOIN consulting_flow_file_object_integrity integrity
        ON integrity.file_id = owner.file_id
      LEFT JOIN consulting_flow_file_object_checksums checksum
        ON checksum.file_id = owner.file_id
      LEFT JOIN consulting_flow_upload_requests upload
        ON upload.file_id = owner.file_id
      LEFT JOIN flow_owner_payload_bindings payload_binding
        ON payload_binding.file_id = owner.file_id
      LEFT JOIN flow_owner_receipt_bindings receipt_binding
        ON receipt_binding.file_id = owner.file_id
      UNION ALL
      SELECT 'flow', orphan.id, orphan.original_name, NULL, orphan.title,
        orphan.purpose,
        orphan.size_bytes, orphan.created_at, NULL, NULL, NULL, NULL,
        orphan.case_id, NULL, 0, 0, NULL, NULL
      FROM flow_orphan_inventory orphan
      UNION ALL
      SELECT 'flow', u.file_id, u.original_name, NULL, '상담 FLOW 미완료 첨부',
        u.purpose, u.size_bytes, u.created_at, NULL, NULL, NULL, u.actor_key,
        u.case_id, u.status, 0, 0, NULL, NULL
      FROM consulting_flow_upload_requests u
      WHERE u.status = 'pending'
        AND NOT EXISTS (SELECT 1 FROM consulting_flow_file_owners owner
          WHERE owner.file_id = u.file_id)
        AND NOT EXISTS (SELECT 1 FROM flow_orphan_inventory orphan
          WHERE orphan.id = u.file_id)
    ), identity_counts AS (
      SELECT id, COUNT(*) AS identity_count FROM candidates GROUP BY id
    ), identified AS (
      SELECT candidate.*, identity.identity_count
      FROM candidates candidate
      JOIN identity_counts identity ON identity.id = candidate.id
    ), classified AS (
      SELECT *,
        source_type = 'company' AND id IN (SELECT id FROM document_refs)
          AS document_linked,
        ((source_type = 'company' AND id IN (SELECT id FROM flow_refs))
          OR (source_type = 'flow' AND id IN (SELECT id FROM flow_file_refs)))
          AS flow_linked,
        CASE WHEN identity_count > 1 OR has_object_integrity = 0 THEN NULL
          WHEN validation_mode = 'metadata' THEN 'metadata'
          WHEN checksum_sha256 IS NULL THEN 'etag'
          ELSE 'sha256' END AS integrity_proof,
        CASE WHEN identity_count > 1 THEN 'inconsistent'
          WHEN upload_status = 'deleted' THEN 'deleted'
          WHEN upload_status = 'pending' AND source_type = 'flow'
            AND EXISTS (SELECT 1 FROM consulting_flow_file_owners pending_owner
              WHERE pending_owner.file_id = identified.id) THEN 'inconsistent'
          WHEN upload_status = 'pending' THEN 'pending'
          WHEN has_metadata = 0 THEN 'inconsistent'
          WHEN has_object_integrity = 0 THEN 'inconsistent'
          WHEN (source_type = 'company'
              AND (id IN (SELECT id FROM document_refs)
                OR id IN (SELECT id FROM flow_refs)))
            OR (source_type = 'flow' AND id IN (SELECT id FROM flow_file_refs))
            THEN 'linked'
          ELSE 'unlinked' END AS status
      FROM identified
    ), paged AS (
      SELECT source_type, id, original_name, company, title, category,
        size_bytes, created_at, assigned_trainee, partner_member_id,
        uploaded_by_email, owner_key, case_id, document_linked, flow_linked,
        identity_count > 1 AS id_collision, integrity_proof, status
      FROM classified
      WHERE (?2 = 'all' OR status = ?2)
        AND (?3 IS NULL OR created_at < ?3 OR
          (created_at = ?3 AND (id < ?4 OR
            (id = ?4 AND source_type < ?5))))
      ORDER BY created_at DESC, id DESC, source_type DESC LIMIT 26
    ), ledger_proofs AS (
      SELECT integrity.validation_mode, integrity.r2_etag,
        integrity.r2_content_type, checksum.sha256,
        CASE WHEN (SELECT identity_count FROM identity_counts
            WHERE id = file.id) = 1
          AND file.storage_key = 'company-source/' || file.id
          AND metadata.file_id IS NOT NULL
          AND object_key.file_id IS NOT NULL
          AND object_key.storage_key = file.storage_key
          AND (metadata.original_name, metadata.company, metadata.category,
            metadata.title, metadata.assigned_trainee,
            metadata.uploaded_by_user_id, metadata.uploaded_by_email,
            metadata.content_type, metadata.size_bytes, metadata.created_at) =
            (file.original_name, file.company, file.category, file.title,
              file.assigned_trainee, file.uploaded_by_user_id,
              file.uploaded_by_email, file.content_type, file.size_bytes,
              file.created_at)
          AND integrity.file_id IS NOT NULL
          AND integrity.r2_content_type = file.content_type
          THEN 1 ELSE 0 END AS ledger_valid
      FROM company_file_objects file
      LEFT JOIN company_file_metadata metadata ON metadata.file_id = file.id
      LEFT JOIN company_file_storage_keys object_key ON object_key.file_id = file.id
      LEFT JOIN company_file_object_integrity integrity ON integrity.file_id = file.id
      LEFT JOIN company_file_object_checksums checksum ON checksum.file_id = file.id
      UNION ALL
      SELECT integrity.validation_mode, integrity.r2_etag,
        integrity.r2_content_type, checksum.sha256,
        CASE WHEN (SELECT identity_count FROM identity_counts
            WHERE id = owner.file_id) = 1
          AND owner.storage_key = 'consulting-flow/' || owner.file_id
          AND metadata.file_id IS NOT NULL
          AND integrity.file_id IS NOT NULL
          AND integrity.r2_content_type = metadata.content_type
          AND payload_binding.payload_count = 1
          AND payload_binding.exact_count = 1
          AND receipt_binding.receipt_valid = 1
          THEN 1 ELSE 0 END AS ledger_valid
      FROM consulting_flow_file_owners owner
      LEFT JOIN consulting_flow_file_metadata metadata ON metadata.file_id = owner.file_id
      LEFT JOIN consulting_flow_file_object_integrity integrity ON integrity.file_id = owner.file_id
      LEFT JOIN consulting_flow_file_object_checksums checksum ON checksum.file_id = owner.file_id
      LEFT JOIN flow_owner_payload_bindings payload_binding
        ON payload_binding.file_id = owner.file_id
      LEFT JOIN flow_owner_receipt_bindings receipt_binding
        ON receipt_binding.file_id = owner.file_id
      UNION ALL
      SELECT NULL, NULL, NULL, NULL, 0
      FROM flow_orphan_inventory
    ), proof_classified AS (
      SELECT CASE
        WHEN ledger_valid = 1 AND validation_mode = 'metadata' AND r2_etag IS NULL
          AND typeof(r2_content_type) = 'text' AND sha256 IS NULL THEN 'metadata'
        WHEN ledger_valid = 1 AND validation_mode = 'etag' AND typeof(r2_etag) = 'text'
          AND length(trim(r2_etag)) BETWEEN 1 AND 256 AND sha256 IS NULL THEN 'etag'
        WHEN ledger_valid = 1 AND validation_mode = 'etag' AND typeof(r2_etag) = 'text'
          AND length(trim(r2_etag)) BETWEEN 1 AND 256
          AND typeof(sha256) = 'text' AND length(sha256) = 64
          AND sha256 NOT GLOB '*[^0-9a-f]*' THEN 'sha256'
        ELSE 'unavailable' END AS proof
      FROM ledger_proofs
    ), coverage AS (
      SELECT
        COALESCE(SUM(proof = 'sha256'), 0) AS sha256,
        COALESCE(SUM(proof = 'etag'), 0) AS etag,
        COALESCE(SUM(proof = 'metadata'), 0) AS metadata,
        COALESCE(SUM(proof = 'unavailable'), 0) AS unavailable
      FROM proof_classified
    )
    SELECT 'item' AS row_kind, source_type, id, original_name, company, title,
      category, size_bytes, created_at, assigned_trainee, partner_member_id,
      uploaded_by_email, owner_key, case_id, document_linked, flow_linked,
      id_collision, integrity_proof, status,
      NULL AS coverage_sha256, NULL AS coverage_etag,
      NULL AS coverage_metadata, NULL AS coverage_unavailable
    FROM paged
    UNION ALL
    SELECT 'coverage', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      sha256, etag, metadata, unavailable
    FROM coverage
    ORDER BY row_kind DESC, created_at DESC, id DESC, source_type DESC
  `,
    )
    .bind(
      JSON.stringify(documentIds(state)),
      filter,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      cursor?.source ?? null,
    )
    .all<InventoryQueryRow>();
  const coverageRows = queryRows.results.filter(
    (row): row is Extract<InventoryQueryRow, { row_kind: 'coverage' }> =>
      row.row_kind === 'coverage',
  );
  if (
    coverageRows.length !== 1 ||
    queryRows.results.some(
      (row) => row.row_kind !== 'item' && row.row_kind !== 'coverage',
    ) ||
    [
      coverageRows[0].coverage_sha256,
      coverageRows[0].coverage_etag,
      coverageRows[0].coverage_metadata,
      coverageRows[0].coverage_unavailable,
    ].some((value) => !Number.isSafeInteger(value) || value < 0)
  )
    throw new CompanyFileError(
      '무결성 증명 적용 현황을 확인하지 못했습니다.',
      503,
    );
  const coverage = coverageRows[0];
  const integrityCoverage = {
    sha256: coverage.coverage_sha256,
    etag: coverage.coverage_etag,
    metadata: coverage.coverage_metadata,
    unavailable: coverage.coverage_unavailable,
  };
  const rows = queryRows.results.filter(
    (row): row is Extract<InventoryQueryRow, { row_kind: 'item' }> =>
      row.row_kind === 'item',
  );
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
  const page = rows.slice(0, pageSize);
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
      idCollision: Boolean(row.id_collision),
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
      integrityProof: row.integrity_proof,
      status: row.status,
    };
  });
  const last = page.at(-1);
  return {
    items,
    nextCursor:
      rows.length > pageSize && last
        ? Buffer.from(
            JSON.stringify({
              createdAt: last.created_at,
              id: last.id,
              source: last.source_type,
              filter,
            }),
          ).toString('base64url')
        : null,
    checkedAt: new Date().toISOString(),
    integrityCoverage,
  };
}

export async function checkInventoryPresence(
  id: string,
): Promise<InventoryPresence> {
  id = readRouteParam(id, 200, '파일 식별값을 확인해 주세요.');
  const db = await inventoryDatabase();
  const rows = await db
    .prepare(
      isPostgresDatabase(db)
        ? postgresInventoryPresenceSql
        : `WITH flow_owner_receipt_binding AS (
      SELECT owner.file_id, CASE
        WHEN upload.file_id IS NULL AND completion.file_id IS NULL THEN 1
        WHEN upload.file_id IS NOT NULL
          AND upload.status = 'ready'
          AND completion.file_id = upload.file_id
          AND completion.command_id = upload.command_id
          AND upload.case_id = owner.case_id
          AND upload.storage_key = owner.storage_key
          AND upload.original_name = metadata.original_name
          AND upload.content_type = metadata.content_type
          AND upload.size_bytes = metadata.size_bytes
          AND upload.purpose = metadata.purpose
          AND upload.intake_file_id IS metadata.intake_file_id
          AND upload.intake_source_hash IS metadata.intake_source_hash
          AND upload.source_reviewed_at IS metadata.source_reviewed_at
          AND upload.source_reviewed_by IS metadata.source_reviewed_by
          AND upload.created_at = owner.created_at
          AND EXISTS (
            SELECT 1 FROM consulting_flows flow
            WHERE flow.case_id = owner.case_id
              AND json_type(CASE WHEN json_valid(flow.payload)
                THEN flow.payload ELSE '{}' END, '$.commandIds') = 'array'
              AND json_type(CASE WHEN json_valid(flow.payload)
                THEN flow.payload ELSE '{}' END, '$.commandReceipts') = 'object'
              AND (SELECT COUNT(*) FROM json_each(
                  CASE WHEN json_valid(flow.payload) THEN flow.payload
                    ELSE '{"commandIds":[]}' END, '$.commandIds') command
                WHERE command.type = 'text'
                  AND command.value = upload.command_id) = 1
              AND (SELECT COUNT(*) FROM json_each(
                  CASE WHEN json_valid(flow.payload) THEN flow.payload
                    ELSE '{"commandReceipts":{}}' END,
                  '$.commandReceipts') receipt
                WHERE receipt.key = upload.command_id
                  AND receipt.type = 'object'
                  AND json_extract(receipt.value, '$.actorKey') = upload.actor_key
                  AND json_extract(receipt.value, '$.fingerprint') = upload.fingerprint
                  AND ${flowReceiptAuditBindingSql}
                ) = 1)
        THEN 1 ELSE 0 END AS receipt_valid
      FROM consulting_flow_file_owners owner
      LEFT JOIN consulting_flow_file_metadata metadata
        ON metadata.file_id = owner.file_id
      LEFT JOIN consulting_flow_upload_requests upload
        ON upload.file_id = owner.file_id
      LEFT JOIN consulting_flow_upload_completions completion
        ON completion.file_id = owner.file_id
      WHERE owner.file_id = ?1
    )
    SELECT 'company' AS source_type, f.id, f.storage_key, f.content_type,
      f.size_bytes, u.file_id, NULL AS case_id, NULL AS payload_file_count,
      NULL AS receipt_valid
    FROM company_file_objects f LEFT JOIN company_file_upload_requests u ON u.file_id = f.id WHERE f.id = ?1
    UNION ALL SELECT 'company', NULL, 'company-source/' || file_id, NULL, NULL,
      file_id, NULL, NULL, NULL
    FROM company_file_upload_requests
    WHERE file_id = ?1 AND NOT EXISTS (SELECT 1 FROM company_file_objects WHERE id = ?1)
    UNION ALL SELECT 'flow', owner.file_id, owner.storage_key,
      metadata.content_type, metadata.size_bytes, owner.file_id, owner.case_id,
      (SELECT COUNT(*)
        FROM consulting_flows flow,
          json_each(CASE WHEN json_valid(flow.payload) THEN flow.payload
            ELSE '{"files":[]}' END, '$.files') stored_file
        WHERE json_type(stored_file.value) = 'object'
          AND json_type(stored_file.value, '$.id') = 'text'
          AND json_extract(stored_file.value, '$.id') = owner.file_id),
      receipt_binding.receipt_valid
    FROM consulting_flow_file_owners owner
    LEFT JOIN consulting_flow_file_metadata metadata
      ON metadata.file_id = owner.file_id
    LEFT JOIN flow_owner_receipt_binding receipt_binding
      ON receipt_binding.file_id = owner.file_id
    WHERE owner.file_id = ?1
    UNION ALL SELECT 'flow', ?1, NULL, NULL, NULL, ?1, NULL, NULL, NULL
    WHERE NOT EXISTS (SELECT 1 FROM consulting_flow_file_owners owner
        WHERE owner.file_id = ?1)
      AND (EXISTS (
          SELECT 1 FROM consulting_flows flow,
            json_each(CASE WHEN json_valid(flow.payload) THEN flow.payload
              ELSE '{"files":[]}' END, '$.files') stored_file
          WHERE json_type(stored_file.value) = 'object'
            AND json_type(stored_file.value, '$.id') = 'text'
            AND json_type(stored_file.value, '$.key') = 'text'
            AND json_extract(stored_file.value, '$.id') = ?1)
        OR EXISTS (SELECT 1 FROM consulting_flow_file_metadata
          WHERE file_id = ?1)
        OR EXISTS (SELECT 1 FROM consulting_flow_file_object_integrity
          WHERE file_id = ?1)
        OR EXISTS (SELECT 1 FROM consulting_flow_file_object_checksums
          WHERE file_id = ?1)
        OR EXISTS (SELECT 1 FROM consulting_flow_upload_requests
          WHERE file_id = ?1 AND status = 'ready')
        OR EXISTS (SELECT 1 FROM consulting_flow_upload_completions
          WHERE file_id = ?1))
    UNION ALL SELECT 'flow', NULL, upload.storage_key, upload.content_type,
      upload.size_bytes, upload.file_id, upload.case_id, NULL, NULL
    FROM consulting_flow_upload_requests upload
    WHERE upload.file_id = ?1 AND upload.status = 'pending'
      AND NOT EXISTS (SELECT 1 FROM consulting_flow_file_owners owner
        WHERE owner.file_id = upload.file_id)
      AND NOT EXISTS (
        SELECT 1 FROM consulting_flows flow,
          json_each(CASE WHEN json_valid(flow.payload) THEN flow.payload
            ELSE '{"files":[]}' END, '$.files') stored_file
        WHERE json_type(stored_file.value) = 'object'
          AND json_type(stored_file.value, '$.id') = 'text'
          AND json_type(stored_file.value, '$.key') = 'text'
          AND json_extract(stored_file.value, '$.id') = upload.file_id)
      AND NOT EXISTS (SELECT 1 FROM consulting_flow_file_metadata
        WHERE file_id = upload.file_id)
      AND NOT EXISTS (SELECT 1 FROM consulting_flow_file_object_integrity
        WHERE file_id = upload.file_id)
      AND NOT EXISTS (SELECT 1 FROM consulting_flow_file_object_checksums
        WHERE file_id = upload.file_id)
      AND NOT EXISTS (SELECT 1 FROM consulting_flow_upload_completions
        WHERE file_id = upload.file_id)
    LIMIT 2`,
    )
    .bind(id)
    .all<{
      source_type: 'company' | 'flow';
      id: string | null;
      storage_key: string | null;
      content_type: string | null;
      size_bytes: number | null;
      file_id: string | null;
      case_id: string | null;
      payload_file_count: number | null;
      receipt_valid: number | null;
    }>();
  if (rows.results.length === 0)
    throw new CompanyFileError('확인할 파일 기록을 찾지 못했습니다.', 404);
  if (rows.results.length !== 1)
    throw new CompanyFileError(
      '같은 파일 식별값의 보관 기록이 둘 이상입니다.',
      409,
    );
  const row = rows.results[0];
  if (
    isPostgresDatabase(db) &&
    row.source_type === 'company' &&
    row.id !== null &&
    row.storage_key !== `company-source/${row.id}`
  )
    throw new CompanyFileError(
      '저장된 기업자료 원본 위치를 확인할 수 없습니다.',
      503,
    );
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
  let flowFile: FlowFile | null = null;
  let flowCaseId: string | null = null;
  if (row.source_type === 'flow' && row.id !== null) {
    if (
      row.case_id === null ||
      row.storage_key !== `consulting-flow/${row.id}` ||
      row.payload_file_count !== 1 ||
      row.receipt_valid !== 1
    )
      throw new CompanyFileError(
        '저장된 상담 FLOW 첨부 원장의 무결성을 확인할 수 없습니다.',
        503,
      );
    let flow;
    try {
      flow = await readFlow(row.case_id);
    } catch (error) {
      if (error instanceof FlowError)
        throw new CompanyFileError(
          '저장된 상담 FLOW 첨부 원장의 무결성을 확인할 수 없습니다.',
          503,
        );
      throw error;
    }
    const matches =
      flow?.files.filter((candidate) => candidate.id === row.id) ?? [];
    if (matches.length !== 1 || matches[0].key !== row.storage_key)
      throw new CompanyFileError(
        '저장된 상담 FLOW 첨부 원장의 무결성을 확인할 수 없습니다.',
        503,
      );
    flowFile = matches[0];
    flowCaseId = row.case_id;
  }
  const key = file?.storage_key ?? flowFile?.key ?? row.storage_key;
  if (!key)
    throw new CompanyFileError('확인할 파일 저장 위치가 없습니다.', 409);
  const object = await companyFileBucket().head(key);
  let integrityMode: InventoryPresence['integrityMode'] = null;
  let integrityProof: InventoryPresence['integrityProof'] = null;
  let integrityMatches: boolean | null = null;
  if (object && file) {
    try {
      const integrity = await readCompanyFileObjectIntegrity(file);
      integrityMode = integrity.validationMode;
      integrityProof = integrity.sha256 ? 'sha256' : integrity.validationMode;
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
  } else if (object && flowFile && flowCaseId) {
    try {
      const integrity = await readFlowFileObjectIntegrity(flowCaseId, flowFile);
      integrityMode = integrity.validationMode;
      integrityProof = integrity.sha256 ? 'sha256' : integrity.validationMode;
      integrityMatches = flowFileObjectMatchesIntegrity(
        flowFile,
        object,
        integrity,
      );
    } catch (error) {
      if (!(error instanceof FlowError) || error.status !== 503) throw error;
      integrityMatches = false;
    }
  }
  const expectedSizeBytes =
    file?.size_bytes ?? flowFile?.size ?? row.size_bytes;
  return {
    id,
    exists: Boolean(object),
    sizeBytes: object?.size ?? null,
    expectedSizeBytes,
    sizeMatches:
      object && expectedSizeBytes !== null
        ? object.size === expectedSizeBytes
        : null,
    integrityMode,
    integrityProof,
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
