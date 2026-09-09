import {
  FLOW_FIELD_LIMITS,
  FLOW_OBJECT_KEYS,
  FLOW_TEXT_LIMITS,
} from './consulting-flow-shape';
import {
  flowUploadReceiptRules,
  flowUploadReceiptTargetRules,
} from './consulting-flow-upload-policy';

// Native PostgreSQL, not a SQLite text-rewriting layer. All interpolated values
// below are source-owned field names/rules. User input remains bound parameters.
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const text = (value: string) =>
  `(CASE WHEN jsonb_typeof(${value}) = 'string' THEN ${value} #>> '{}' END)`;
const array = (value: string) =>
  `(CASE WHEN jsonb_typeof(${value}) = 'array' THEN ${value} ELSE '[]'::jsonb END)`;
const object = (value: string) =>
  `(CASE WHEN jsonb_typeof(${value}) = 'object' THEN ${value} ELSE '{}'::jsonb END)`;
const absentOrRequired = (mode: 'absent' | 'required') =>
  [
    'intake_file_id',
    'intake_source_hash',
    'source_reviewed_at',
    'source_reviewed_by',
  ]
    .map((key) => `upload.${key} IS ${mode === 'required' ? 'NOT ' : ''}NULL`)
    .join(' AND ');
const receiptAction = text("receipt.value->'action'");
const receiptTarget = text("receipt.value->'targetId'");
const uploadRule = `(${Object.entries(flowUploadReceiptRules)
  .map(
    ([action, rule]) =>
      `(${receiptAction} = ${literal(action)} AND upload.purpose = ${literal(rule.purpose)}
    AND upload.slot IN (${rule.slots.map(literal).join(',')}) AND ${absentOrRequired(rule.intakeProvenance)})`,
  )
  .join(' OR ')})`;
const explicitTargetActions = Object.entries(flowUploadReceiptTargetRules)
  .filter(([, rule]) => rule.target.kind === 'receipt')
  .map(([action]) => literal(action))
  .join(',');
const targetRules = Object.entries(flowUploadReceiptTargetRules);
const targetBinding = `(${receiptAction} NOT IN (${targetRules.map(([action]) => literal(action)).join(',')})
  OR ${targetRules
    .map(([action, rule]) => {
      const targetId =
        rule.target.kind === 'command_suffix'
          ? `upload.command_id || ${literal(`-${rule.target.suffix}`)}`
          : receiptTarget;
      const path = `flow.data->${literal(rule.source.path)}`;
      const target = rule.source.kind === 'collection' ? 'target.value' : path;
      const slots = Object.entries(rule.slots)
        .map(
          ([slot, field]) =>
            `(upload.slot = ${literal(slot)} AND ${text(`${target}->${literal(field)}`)} = upload.file_id)`,
        )
        .join(' OR ');
      const match =
        rule.source.kind === 'collection'
          ? `(SELECT count(*) FROM jsonb_array_elements(${array(path)}) target(value)
          WHERE jsonb_typeof(target.value) = 'object' AND ${text("target.value->'id'")} = ${targetId} AND (${slots})) = 1`
          : `(jsonb_typeof(${path}) = 'object' AND ${text(`${path}->${literal(rule.source.idField)}`)} = ${targetId} AND (${slots}))`;
      return `(${receiptAction} = ${literal(action)} AND ${match})`;
    })
    .join(' OR ')})`;
const receiptAuditBinding = `(
  receipt.value - ARRAY[${FLOW_OBJECT_KEYS.receipt.map(literal).join(',')}]::text[] = '{}'::jsonb
  AND (
    (NOT jsonb_exists(receipt.value, 'actor') AND NOT jsonb_exists(receipt.value, 'action')
      AND NOT jsonb_exists(receipt.value, 'targetId'))
    OR (
      partner_hub.flow_shape_field_valid((receipt.value->'actor')::json, 'n:${FLOW_FIELD_LIMITS.actor}')
      AND jsonb_typeof(receipt.value->'action') = 'string'
      AND (SELECT count(*) FROM jsonb_array_elements(${array("flow.data->'audit'")}) audit(value)
        WHERE jsonb_typeof(audit.value) = 'object'
          AND audit.value - ARRAY[${FLOW_OBJECT_KEYS.audit.map(literal).join(',')}]::text[] = '{}'::jsonb
          AND partner_hub.flow_shape_field_valid((audit.value->'detail')::json, 'n:${FLOW_TEXT_LIMITS.auditDetail}')
          AND ${text("audit.value->'id'")} = upload.command_id
          AND ${text("audit.value->'actor'")} = ${text("receipt.value->'actor'")}
          AND ${text("audit.value->'action'")} = ${receiptAction}
          AND ${text("audit.value->'at'")} = upload.created_at) = 1
      AND ${uploadRule}
      AND ((${receiptAction} IN (${explicitTargetActions}) AND jsonb_typeof(receipt.value->'targetId') = 'string')
        OR (${receiptAction} NOT IN (${explicitTargetActions}) AND NOT jsonb_exists(receipt.value, 'targetId')))
      AND ${targetBinding}
    )
  )
)`;
const optionalMetadataMatch = [
  'intake_file_id',
  'intake_source_hash',
  'source_reviewed_at',
  'source_reviewed_by',
]
  .map((field) => `upload.${field} IS NOT DISTINCT FROM metadata.${field}`)
  .join(' AND ');
const objectIntegrityValid = `(
  (integrity.validation_mode = 'metadata' AND integrity.r2_etag IS NULL AND checksum.file_id IS NULL)
  OR (integrity.validation_mode = 'etag' AND length(trim(integrity.r2_etag)) BETWEEN 1 AND 256
    AND (checksum.file_id IS NULL OR checksum.sha256 ~ '^[0-9a-f]{64}$'))
)`;

// Shared by list/coverage and presence. Missing owners remain visible exactly
// once, in payload > child ledger > ready/completion receipt priority order.
const flowInventoryCtes = `
flow_payloads AS (
  SELECT case_id, updated_at, partner_hub.inventory_json(payload) AS data,
    partner_hub.inventory_unique_json(payload) AS unique_keys
  FROM consulting_flows
), flow_file_bindings AS (
  SELECT flow.case_id, flow.updated_at AS flow_updated_at, flow.unique_keys,
    file.value, ${text("file.value->'id'")} AS id,
    ${text("file.value->'key'")} AS storage_key,
    ${text("file.value->'createdAt'")} AS created_at,
    ${text("file.value->'name'")} AS original_name,
    ${text("file.value->'contentType'")} AS content_type,
    CASE WHEN partner_hub.flow_integer_valid((file.value->'size')::json, 0, 9007199254740991)
      THEN (file.value->>'size')::bigint END AS size_bytes,
    ${text("file.value->'purpose'")} AS purpose,
    ${text("file.value->'intakeFileId'")} AS intake_file_id,
    ${text("file.value->'intakeSourceHash'")} AS intake_source_hash,
    ${text("file.value->'sourceReviewedAt'")} AS source_reviewed_at,
    ${text("file.value->'sourceReviewedBy'")} AS source_reviewed_by
  FROM flow_payloads flow, jsonb_array_elements(${array("flow.data->'files'")}) file(value)
  WHERE jsonb_typeof(file.value) = 'object' AND jsonb_typeof(file.value->'id') = 'string'
), flow_refs AS (
  SELECT DISTINCT ${text("file.value->'intakeFileId'")} AS id
  FROM flow_payloads flow, jsonb_array_elements(${array("flow.data->'files'")}) file(value)
  WHERE jsonb_typeof(file.value) = 'object' AND jsonb_typeof(file.value->'intakeFileId') = 'string'
), flow_file_refs AS (SELECT DISTINCT id FROM flow_file_bindings), flow_orphan_payloads AS (
  SELECT binding.id,
    CASE WHEN count(*) = 1 THEN max(CASE WHEN length(original_name) <= 500 THEN original_name END) END AS original_name,
    CASE WHEN count(*) = 1 THEN max(CASE WHEN length(purpose) <= 200 THEN purpose END) END AS purpose,
    CASE WHEN count(*) = 1 THEN max(size_bytes) END AS size_bytes,
    min(CASE WHEN partner_hub.flow_shape_time(to_json(created_at)) IS NOT NULL THEN created_at
      WHEN partner_hub.flow_shape_time(to_json(flow_updated_at)) IS NOT NULL THEN flow_updated_at
      ELSE '1970-01-01T00:00:00.000Z' END) AS created_at,
    CASE WHEN count(*) = 1 THEN max(CASE WHEN length(case_id) BETWEEN 1 AND 200 THEN case_id END) END AS case_id
  FROM flow_file_bindings binding
  WHERE binding.id ~ '^[A-Za-z0-9_-]{1,200}$' AND storage_key IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM consulting_flow_file_owners owner WHERE owner.file_id = binding.id)
  GROUP BY binding.id
), flow_child_ledger_ids AS (
  SELECT file_id FROM consulting_flow_file_metadata UNION SELECT file_id FROM consulting_flow_file_object_integrity
  UNION SELECT file_id FROM consulting_flow_file_object_checksums
), flow_receipt_ids AS (
  SELECT file_id FROM consulting_flow_upload_requests WHERE status = 'ready'
  UNION SELECT file_id FROM consulting_flow_upload_completions
), flow_orphan_child_ledgers AS (
  SELECT ledger.file_id AS id,
    CASE WHEN length(metadata.original_name) <= 500 THEN metadata.original_name END AS original_name,
    CASE WHEN length(metadata.purpose) <= 200 THEN metadata.purpose END AS purpose,
    CASE WHEN metadata.size_bytes BETWEEN 0 AND 9007199254740991 THEN metadata.size_bytes END AS size_bytes,
    CASE WHEN partner_hub.flow_shape_time(to_json(upload.created_at)) IS NOT NULL THEN upload.created_at
      ELSE '1970-01-01T00:00:00.000Z' END AS created_at
  FROM flow_child_ledger_ids ledger
  LEFT JOIN consulting_flow_file_metadata metadata ON metadata.file_id = ledger.file_id
  LEFT JOIN consulting_flow_upload_requests upload ON upload.file_id = ledger.file_id
  WHERE ledger.file_id ~ '^[A-Za-z0-9_-]{1,200}$'
    AND NOT EXISTS (SELECT 1 FROM consulting_flow_file_owners owner WHERE owner.file_id = ledger.file_id)
    AND NOT EXISTS (SELECT 1 FROM flow_orphan_payloads orphan WHERE orphan.id = ledger.file_id)
), flow_orphan_receipts AS (
  SELECT receipt.file_id AS id,
    CASE WHEN length(upload.original_name) <= 500 THEN upload.original_name END AS original_name,
    CASE WHEN length(upload.purpose) <= 200 THEN upload.purpose END AS purpose,
    CASE WHEN upload.size_bytes BETWEEN 0 AND 9007199254740991 THEN upload.size_bytes END AS size_bytes,
    CASE WHEN partner_hub.flow_shape_time(to_json(upload.created_at)) IS NOT NULL THEN upload.created_at
      ELSE '1970-01-01T00:00:00.000Z' END AS created_at,
    CASE WHEN length(upload.case_id) BETWEEN 1 AND 200 THEN upload.case_id END AS case_id,
    CASE WHEN upload.status = 'ready' THEN '상담 FLOW 완료 예약 원장 누락 첨부'
      ELSE '상담 FLOW 완료 영수증 고아 기록' END AS title
  FROM flow_receipt_ids receipt
  LEFT JOIN consulting_flow_upload_requests upload ON upload.file_id = receipt.file_id
  WHERE receipt.file_id ~ '^[A-Za-z0-9_-]{1,200}$'
    AND NOT EXISTS (SELECT 1 FROM consulting_flow_file_owners owner WHERE owner.file_id = receipt.file_id)
    AND NOT EXISTS (SELECT 1 FROM flow_orphan_payloads orphan WHERE orphan.id = receipt.file_id)
    AND NOT EXISTS (SELECT 1 FROM flow_child_ledger_ids ledger WHERE ledger.file_id = receipt.file_id)
), flow_orphan_inventory AS (
  SELECT id, original_name, purpose, size_bytes, created_at, case_id, '상담 FLOW 소유 원장 누락 첨부' AS title FROM flow_orphan_payloads
  UNION ALL SELECT id, original_name, purpose, size_bytes, created_at, NULL, '상담 FLOW 소유·payload 누락 원장' FROM flow_orphan_child_ledgers
  UNION ALL SELECT id, original_name, purpose, size_bytes, created_at, case_id, title FROM flow_orphan_receipts
), flow_owner_payload_bindings AS (
  SELECT owner.file_id, count(binding.id) AS payload_count,
    count(*) FILTER (WHERE binding.unique_keys AND binding.case_id = owner.case_id
      AND binding.storage_key = owner.storage_key AND binding.created_at = owner.created_at
      AND binding.original_name = metadata.original_name AND binding.content_type = metadata.content_type
      AND binding.size_bytes = metadata.size_bytes AND binding.purpose = metadata.purpose
      AND (jsonb_typeof(binding.value->'intakeFileId') IS NULL OR jsonb_typeof(binding.value->'intakeFileId') IN ('string','null'))
      AND (jsonb_typeof(binding.value->'intakeSourceHash') IS NULL OR jsonb_typeof(binding.value->'intakeSourceHash') IN ('string','null'))
      AND (jsonb_typeof(binding.value->'sourceReviewedAt') IS NULL OR jsonb_typeof(binding.value->'sourceReviewedAt') IN ('string','null'))
      AND (jsonb_typeof(binding.value->'sourceReviewedBy') IS NULL OR jsonb_typeof(binding.value->'sourceReviewedBy') IN ('string','null'))
      AND binding.intake_file_id IS NOT DISTINCT FROM metadata.intake_file_id
      AND binding.intake_source_hash IS NOT DISTINCT FROM metadata.intake_source_hash
      AND binding.source_reviewed_at IS NOT DISTINCT FROM metadata.source_reviewed_at
      AND binding.source_reviewed_by IS NOT DISTINCT FROM metadata.source_reviewed_by) AS exact_count
  FROM consulting_flow_file_owners owner
  LEFT JOIN consulting_flow_file_metadata metadata ON metadata.file_id = owner.file_id
  LEFT JOIN flow_file_bindings binding ON binding.id = owner.file_id
  GROUP BY owner.file_id
), flow_owner_receipt_bindings AS (
  SELECT owner.file_id, CASE WHEN upload.file_id IS NULL AND completion.file_id IS NULL THEN 1
    WHEN upload.file_id IS NOT NULL AND upload.status = 'ready'
      AND completion.file_id = upload.file_id AND completion.command_id = upload.command_id
      AND upload.case_id = owner.case_id AND upload.storage_key = owner.storage_key
      AND upload.original_name = metadata.original_name AND upload.content_type = metadata.content_type
      AND upload.size_bytes = metadata.size_bytes AND upload.purpose = metadata.purpose
      AND ${optionalMetadataMatch} AND upload.created_at = owner.created_at
      AND EXISTS (SELECT 1 FROM flow_payloads flow WHERE flow.case_id = owner.case_id AND flow.unique_keys
        AND jsonb_typeof(flow.data->'commandIds') = 'array' AND jsonb_typeof(flow.data->'commandReceipts') = 'object'
        AND (SELECT count(*) FROM jsonb_array_elements(${array("flow.data->'commandIds'")}) command(value)
          WHERE ${text('command.value')} = upload.command_id) = 1
        AND (SELECT count(*) FROM jsonb_each(${object("flow.data->'commandReceipts'")}) receipt(key, value)
          WHERE receipt.key = upload.command_id AND jsonb_typeof(receipt.value) = 'object'
            AND ${text("receipt.value->'actorKey'")} = upload.actor_key
            AND ${text("receipt.value->'fingerprint'")} = upload.fingerprint AND ${receiptAuditBinding}) = 1)
      THEN 1 ELSE 0 END AS receipt_valid
  FROM consulting_flow_file_owners owner
  LEFT JOIN consulting_flow_file_metadata metadata ON metadata.file_id = owner.file_id
  LEFT JOIN consulting_flow_upload_requests upload ON upload.file_id = owner.file_id
  LEFT JOIN consulting_flow_upload_completions completion ON completion.file_id = owner.file_id
)`;

export const postgresInventoryListSql = `WITH
document_refs AS (SELECT value AS id FROM jsonb_array_elements_text(?1::jsonb)), ${flowInventoryCtes},
candidates AS (
  SELECT 'company'::text AS source_type, f.id, f.original_name, f.company, f.title, f.category, f.size_bytes,
    f.created_at, f.assigned_trainee, a.partner_member_id, f.uploaded_by_email, upload.owner_key,
    c.case_id, upload.status AS upload_status, 1 AS has_metadata, 1 AS coverage_eligible,
    CASE WHEN f.storage_key = 'company-source/' || f.id AND metadata.file_id IS NOT NULL
      AND object_key.file_id IS NOT NULL AND object_key.storage_key = f.storage_key
      AND (metadata.original_name, metadata.company, metadata.category, metadata.title, metadata.assigned_trainee,
        metadata.uploaded_by_user_id, metadata.uploaded_by_email, metadata.content_type, metadata.size_bytes, metadata.created_at)
        = (f.original_name, f.company, f.category, f.title, f.assigned_trainee, f.uploaded_by_user_id,
          f.uploaded_by_email, f.content_type, f.size_bytes, f.created_at)
      AND integrity.file_id IS NOT NULL AND integrity.r2_content_type = f.content_type AND ${objectIntegrityValid}
      THEN 1 ELSE 0 END AS has_object_integrity,
    integrity.validation_mode, checksum.sha256 AS checksum_sha256
  FROM company_file_objects f
  LEFT JOIN company_file_assignments a ON a.file_id = f.id
  LEFT JOIN company_file_case_links c ON c.file_id = f.id
  LEFT JOIN company_file_upload_requests upload ON upload.file_id = f.id
  LEFT JOIN company_file_metadata metadata ON metadata.file_id = f.id
  LEFT JOIN company_file_storage_keys object_key ON object_key.file_id = f.id
  LEFT JOIN company_file_object_integrity integrity ON integrity.file_id = f.id
  LEFT JOIN company_file_object_checksums checksum ON checksum.file_id = f.id
  UNION ALL
  SELECT 'company', u.file_id, NULL, NULL, NULL, NULL, NULL, u.created_at, NULL, NULL, NULL,
    u.owner_key, NULL, u.status, 0, 0, 0, NULL, NULL
  FROM company_file_upload_requests u
  WHERE NOT EXISTS (SELECT 1 FROM company_file_objects f WHERE f.id = u.file_id)
    AND (u.status <> 'deleted' OR u.file_id IN (SELECT id FROM document_refs) OR u.file_id IN (SELECT id FROM flow_refs))
  UNION ALL
  SELECT 'flow', owner.file_id, metadata.original_name, NULL, '상담 FLOW 보관 첨부', metadata.purpose, metadata.size_bytes,
    owner.created_at, NULL, NULL, NULL, upload.actor_key, owner.case_id, upload.status,
    CASE WHEN metadata.file_id IS NOT NULL THEN 1 ELSE 0 END, 1,
    CASE WHEN owner.storage_key = 'consulting-flow/' || owner.file_id AND metadata.file_id IS NOT NULL
      AND integrity.file_id IS NOT NULL AND integrity.r2_content_type = metadata.content_type
      AND payload_binding.payload_count = 1 AND payload_binding.exact_count = 1
      AND receipt_binding.receipt_valid = 1 AND ${objectIntegrityValid} THEN 1 ELSE 0 END,
    integrity.validation_mode, checksum.sha256
  FROM consulting_flow_file_owners owner
  LEFT JOIN consulting_flow_file_metadata metadata ON metadata.file_id = owner.file_id
  LEFT JOIN consulting_flow_file_object_integrity integrity ON integrity.file_id = owner.file_id
  LEFT JOIN consulting_flow_file_object_checksums checksum ON checksum.file_id = owner.file_id
  LEFT JOIN consulting_flow_upload_requests upload ON upload.file_id = owner.file_id
  LEFT JOIN flow_owner_payload_bindings payload_binding ON payload_binding.file_id = owner.file_id
  LEFT JOIN flow_owner_receipt_bindings receipt_binding ON receipt_binding.file_id = owner.file_id
  UNION ALL
  SELECT 'flow', orphan.id, orphan.original_name, NULL, orphan.title, orphan.purpose, orphan.size_bytes, orphan.created_at,
    NULL, NULL, NULL, NULL, orphan.case_id, NULL, 0, 1, 0, NULL, NULL FROM flow_orphan_inventory orphan
  UNION ALL
  SELECT 'flow', u.file_id, u.original_name, NULL, '상담 FLOW 미완료 첨부', u.purpose, u.size_bytes, u.created_at,
    NULL, NULL, NULL, u.actor_key, u.case_id, u.status, 0, 0, 0, NULL, NULL
  FROM consulting_flow_upload_requests u WHERE u.status = 'pending'
    AND NOT EXISTS (SELECT 1 FROM consulting_flow_file_owners owner WHERE owner.file_id = u.file_id)
    AND NOT EXISTS (SELECT 1 FROM flow_orphan_inventory orphan WHERE orphan.id = u.file_id)
), identified AS (
  SELECT candidates.*, count(*) OVER (PARTITION BY id) AS identity_count FROM candidates
), classified AS (
  SELECT *, (source_type = 'company' AND id IN (SELECT id FROM document_refs))::integer AS document_linked,
    ((source_type = 'company' AND id IN (SELECT id FROM flow_refs)) OR
      (source_type = 'flow' AND id IN (SELECT id FROM flow_file_refs)))::integer AS flow_linked,
    CASE WHEN identity_count > 1 OR has_object_integrity = 0 THEN NULL
      WHEN validation_mode = 'metadata' THEN 'metadata' WHEN checksum_sha256 IS NULL THEN 'etag' ELSE 'sha256' END AS integrity_proof,
    CASE WHEN identity_count > 1 THEN 'inconsistent' WHEN upload_status = 'deleted' THEN 'deleted'
      WHEN upload_status = 'pending' AND source_type = 'flow' AND coverage_eligible = 1 THEN 'inconsistent'
      WHEN upload_status = 'pending' THEN 'pending'
      WHEN has_metadata = 0 OR has_object_integrity = 0 THEN 'inconsistent'
      WHEN (source_type = 'company' AND (id IN (SELECT id FROM document_refs) OR id IN (SELECT id FROM flow_refs)))
        OR (source_type = 'flow' AND id IN (SELECT id FROM flow_file_refs)) THEN 'linked' ELSE 'unlinked' END AS status
  FROM identified
), paged AS (
  SELECT * FROM classified WHERE (?2 = 'all' OR status = ?2)
    AND (?3::text IS NULL OR (created_at, id, source_type) < (?3::text, ?4::text, ?5::text))
  ORDER BY created_at DESC, id DESC, source_type DESC LIMIT 26
), coverage AS (
  SELECT count(*) FILTER (WHERE integrity_proof = 'sha256') AS sha256,
    count(*) FILTER (WHERE integrity_proof = 'etag') AS etag,
    count(*) FILTER (WHERE integrity_proof = 'metadata') AS metadata,
    count(*) FILTER (WHERE integrity_proof IS NULL) AS unavailable
  FROM classified WHERE coverage_eligible = 1
)
SELECT 'item' AS row_kind, source_type, id, original_name, company, title, category, size_bytes, created_at,
  assigned_trainee, partner_member_id, uploaded_by_email, owner_key, case_id, document_linked, flow_linked,
  (identity_count > 1)::integer AS id_collision, integrity_proof, status,
  NULL::bigint AS coverage_sha256, NULL::bigint AS coverage_etag, NULL::bigint AS coverage_metadata, NULL::bigint AS coverage_unavailable
FROM paged UNION ALL
SELECT 'coverage', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  sha256, etag, metadata, unavailable FROM coverage
ORDER BY row_kind DESC, created_at DESC, id DESC, source_type DESC`;

export const postgresInventoryPresenceSql = `WITH ${flowInventoryCtes}
SELECT 'company' AS source_type, f.id, f.storage_key, f.content_type, f.size_bytes, u.file_id,
  NULL::text AS case_id, NULL::bigint AS payload_file_count, NULL::integer AS receipt_valid
FROM company_file_objects f LEFT JOIN company_file_upload_requests u ON u.file_id = f.id WHERE f.id = ?1
UNION ALL SELECT 'company', NULL, 'company-source/' || file_id, NULL, NULL, file_id, NULL, NULL, NULL
FROM company_file_upload_requests WHERE file_id = ?1 AND NOT EXISTS (SELECT 1 FROM company_file_objects WHERE id = ?1)
UNION ALL SELECT 'flow', owner.file_id, owner.storage_key, metadata.content_type, metadata.size_bytes, owner.file_id, owner.case_id,
  payload_binding.payload_count, receipt_binding.receipt_valid
FROM consulting_flow_file_owners owner
LEFT JOIN consulting_flow_file_metadata metadata ON metadata.file_id = owner.file_id
LEFT JOIN flow_owner_payload_bindings payload_binding ON payload_binding.file_id = owner.file_id
LEFT JOIN flow_owner_receipt_bindings receipt_binding ON receipt_binding.file_id = owner.file_id
WHERE owner.file_id = ?1
UNION ALL SELECT 'flow', orphan.id, NULL, NULL, NULL, orphan.id, NULL, NULL, NULL
FROM flow_orphan_inventory orphan WHERE orphan.id = ?1
UNION ALL SELECT 'flow', NULL, upload.storage_key, upload.content_type, upload.size_bytes, upload.file_id, upload.case_id, NULL, NULL
FROM consulting_flow_upload_requests upload WHERE upload.file_id = ?1 AND upload.status = 'pending'
  AND NOT EXISTS (SELECT 1 FROM consulting_flow_file_owners owner WHERE owner.file_id = upload.file_id)
  AND NOT EXISTS (SELECT 1 FROM flow_orphan_inventory orphan WHERE orphan.id = upload.file_id)
LIMIT 2`;
