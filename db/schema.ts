import {
  AI_DIAGNOSIS_RUN_FIELD_LIMITS,
  AI_PROVIDER_MESSAGE_ID_LIMIT,
  AI_PROVIDER_REQUEST_ID_LIMIT,
  PORTAL_STATE_LIMIT_BYTES,
  STEP_ZERO_MAX_OUTPUT_TOKENS,
  STEP_ZERO_PENDING_LIMIT_BYTES,
  STEP_ZERO_RESULT_LIMIT_BYTES,
} from '@/lib/storage-limits';
import { MAX_FLOW_UPLOAD_BYTES } from '@/lib/consulting-flow-upload-policy';

export const portalStateTableSql = `
CREATE TABLE IF NOT EXISTS portal_state (
  id TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
`;

export const portalLoginStatsTableSql = `
CREATE TABLE IF NOT EXISTS portal_login_stats (
  member_id TEXT PRIMARY KEY NOT NULL,
  last_login_at TEXT NOT NULL,
  login_count INTEGER NOT NULL DEFAULT 1
)
`;

const invalidUtcMillisecondTimestampSql = (column: string) =>
  `typeof(${column}) <> 'text' OR length(${column}) <> 24 OR substr(${column}, 5, 1) <> '-' OR substr(${column}, 8, 1) <> '-' OR substr(${column}, 11, 1) <> 'T' OR substr(${column}, 14, 1) <> ':' OR substr(${column}, 17, 1) <> ':' OR substr(${column}, 20, 1) <> '.' OR substr(${column}, 24, 1) <> 'Z' OR julianday(${column}) IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', ${column}) IS NOT ${column}`;

export const portalLoginStatsInsertEnvelopeTriggerSql = `CREATE TRIGGER IF NOT EXISTS portal_login_stats_insert_envelope_guard BEFORE INSERT ON portal_login_stats WHEN typeof(NEW.member_id) <> 'text' OR NEW.member_id = '' OR trim(NEW.member_id) <> NEW.member_id OR ${invalidUtcMillisecondTimestampSql('NEW.last_login_at')} OR typeof(NEW.login_count) <> 'integer' OR NEW.login_count <> 1 BEGIN SELECT RAISE(ABORT, 'portal login stat insert envelope is invalid'); END`;

export const portalLoginStatsIdentityTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS portal_login_stats_identity_immutable BEFORE UPDATE ON portal_login_stats WHEN NEW.member_id IS NOT OLD.member_id BEGIN SELECT RAISE(ABORT, 'portal login stat identity is immutable'); END";

export const portalLoginStatsUpdateEnvelopeTriggerSql = `CREATE TRIGGER IF NOT EXISTS portal_login_stats_update_envelope_guard BEFORE UPDATE ON portal_login_stats WHEN NEW.member_id IS OLD.member_id AND (${invalidUtcMillisecondTimestampSql('NEW.last_login_at')} OR typeof(NEW.login_count) <> 'integer' OR NEW.login_count < 1 OR NEW.login_count > 9007199254740991 OR NEW.last_login_at < OLD.last_login_at OR NOT (NEW.login_count = OLD.login_count OR (NEW.login_count = OLD.login_count + 1 AND NEW.last_login_at >= strftime('%Y-%m-%dT%H:%M:%fZ', OLD.last_login_at, '+30 minutes')))) BEGIN SELECT RAISE(ABORT, 'portal login stat update envelope is invalid'); END`;

export const portalSaveConflictStatsTableSql = `
CREATE TABLE IF NOT EXISTS portal_save_conflict_stats (
  bucket_date TEXT NOT NULL,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  conflict_count INTEGER NOT NULL DEFAULT 1,
  last_conflict_at TEXT NOT NULL,
  PRIMARY KEY (bucket_date, source, kind, actor_role)
)
`;

// Anonymous, short-lived bearer receipts. Never add an identity, request body,
// revision, company, case, or plaintext token to this table.
export const portalConflictReceiptsTableSql = `
CREATE TABLE IF NOT EXISTS portal_conflict_receipts (
  token_hash TEXT PRIMARY KEY NOT NULL,
  bucket_date TEXT NOT NULL,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  started_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  claimed_at TEXT
)
`;

export const portalConflictReceiptsExpiryIndexSql = `
CREATE INDEX IF NOT EXISTS portal_conflict_receipts_expiry_idx
ON portal_conflict_receipts (expires_at)
`;

export const portalConflictRecoveryStatsTableSql = `
CREATE TABLE IF NOT EXISTS portal_conflict_recovery_stats (
  bucket_date TEXT NOT NULL,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  issued_count INTEGER NOT NULL DEFAULT 0,
  recovered_count INTEGER NOT NULL DEFAULT 0,
  under_1m_count INTEGER NOT NULL DEFAULT 0,
  under_5m_count INTEGER NOT NULL DEFAULT 0,
  under_30m_count INTEGER NOT NULL DEFAULT 0,
  under_2h_count INTEGER NOT NULL DEFAULT 0,
  under_24h_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_date, source, kind, actor_role)
)
`;

// Privacy-minimized operational totals. Keep identity, actor, token, IP,
// request and exact event timestamps out of this aggregate.
export const portalPasswordLinkStatsTableSql = `
CREATE TABLE IF NOT EXISTS portal_password_link_stats (
  bucket_date TEXT PRIMARY KEY NOT NULL,
  issued_count INTEGER NOT NULL DEFAULT 0,
  active_replacement_count INTEGER NOT NULL DEFAULT 0,
  expired_at_reissue_count INTEGER NOT NULL DEFAULT 0,
  redeemed_count INTEGER NOT NULL DEFAULT 0,
  observed_expired_attempt_count INTEGER NOT NULL DEFAULT 0
)
`;

// Count-only duplicate-request observations. Never add identity, company,
// case, file, request-key, fingerprint, body, IP, or exact timestamps here.
export const portalDuplicateRequestStatsTableSql = `
CREATE TABLE IF NOT EXISTS portal_duplicate_request_stats (
  bucket_date TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('flow_command', 'file_upload', 'admin_partner_registration')),
  outcome TEXT NOT NULL CHECK (outcome IN ('safe_retry', 'request_key_conflict', 'existing_record_blocked', 'unkeyed_request')),
  event_count INTEGER NOT NULL DEFAULT 1 CHECK (event_count >= 0),
  PRIMARY KEY (bucket_date, source, outcome)
)
`;

export const companyFileObjectsTableSql = `
CREATE TABLE IF NOT EXISTS company_file_objects (
  id TEXT PRIMARY KEY NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  company TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  assigned_trainee TEXT NOT NULL,
  uploaded_by_user_id TEXT NOT NULL,
  uploaded_by_email TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
)
`;

export const companyFileObjectsNoUpdateTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS company_file_objects_no_update BEFORE UPDATE ON company_file_objects BEGIN SELECT RAISE(ABORT, 'company file object is immutable'); END";

export const companyFileObjectsOwnerIndexSql = `
CREATE INDEX IF NOT EXISTS company_file_objects_owner_idx
ON company_file_objects (assigned_trainee, created_at)
`;

export const companyFileObjectsCompanyIndexSql = `
CREATE INDEX IF NOT EXISTS company_file_objects_company_idx
ON company_file_objects (company, created_at)
`;

export const companyFileObjectIntegrityTableSql = `
CREATE TABLE IF NOT EXISTS company_file_object_integrity (
  file_id TEXT PRIMARY KEY NOT NULL REFERENCES company_file_objects(id) ON DELETE CASCADE,
  validation_mode TEXT NOT NULL CHECK (validation_mode IN ('metadata', 'etag')),
  r2_etag TEXT,
  r2_content_type TEXT NOT NULL,
  CHECK ((validation_mode = 'metadata' AND r2_etag IS NULL) OR
    (validation_mode = 'etag' AND length(r2_etag) BETWEEN 1 AND 256))
)
`;

export const companyFileObjectIntegrityBackfillSql = `
INSERT OR IGNORE INTO company_file_object_integrity
  (file_id, validation_mode, r2_etag, r2_content_type)
SELECT id, 'metadata', NULL, content_type
FROM company_file_objects
ORDER BY created_at, id
`;

export const companyFileObjectIntegrityNoUpdateTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS company_file_object_integrity_no_update BEFORE UPDATE ON company_file_object_integrity BEGIN SELECT RAISE(ABORT, 'company file object integrity is immutable'); END";

export const companyFileObjectIntegrityNoDirectDeleteTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS company_file_object_integrity_no_direct_delete BEFORE DELETE ON company_file_object_integrity WHEN EXISTS (SELECT 1 FROM company_file_objects WHERE id = OLD.file_id) BEGIN SELECT RAISE(ABORT, 'company file object integrity requires parent deletion'); END";

export const companyFileStorageKeysTableSql = `
CREATE TABLE IF NOT EXISTS company_file_storage_keys (
  file_id TEXT PRIMARY KEY NOT NULL REFERENCES company_file_objects(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE
)
`;

export const companyFileStorageKeysBackfillSql = `
INSERT OR IGNORE INTO company_file_storage_keys (file_id, storage_key)
SELECT id, storage_key
FROM company_file_objects
ORDER BY created_at, id
`;

export const companyFileStorageKeysNoUpdateTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS company_file_storage_keys_no_update BEFORE UPDATE ON company_file_storage_keys BEGIN SELECT RAISE(ABORT, 'company file storage key is immutable'); END";

export const companyFileStorageKeysNoDirectDeleteTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS company_file_storage_keys_no_direct_delete BEFORE DELETE ON company_file_storage_keys WHEN EXISTS (SELECT 1 FROM company_file_objects WHERE id = OLD.file_id) BEGIN SELECT RAISE(ABORT, 'company file storage key requires parent deletion'); END";

export const companyFileMetadataTableSql = `
CREATE TABLE IF NOT EXISTS company_file_metadata (
  file_id TEXT PRIMARY KEY NOT NULL REFERENCES company_file_objects(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  company TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  assigned_trainee TEXT NOT NULL,
  uploaded_by_user_id TEXT NOT NULL,
  uploaded_by_email TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
)
`;

export const companyFileMetadataBackfillSql = `
INSERT OR IGNORE INTO company_file_metadata
  (file_id, original_name, company, category, title, assigned_trainee,
   uploaded_by_user_id, uploaded_by_email, content_type, size_bytes, created_at)
SELECT id, original_name, company, category, title, assigned_trainee,
  uploaded_by_user_id, uploaded_by_email, content_type, size_bytes, created_at
FROM company_file_objects
ORDER BY created_at, id
`;

// D1 exec treats newlines as statement separators. Keep each trigger in one line
// so the same definition is safe in runtime setup and one-shot migrations.
export const companyFileMetadataNoUpdateTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS company_file_metadata_no_update BEFORE UPDATE ON company_file_metadata BEGIN SELECT RAISE(ABORT, 'company file metadata is immutable'); END";

export const companyFileMetadataNoDirectDeleteTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS company_file_metadata_no_direct_delete BEFORE DELETE ON company_file_metadata WHEN EXISTS (SELECT 1 FROM company_file_objects WHERE id = OLD.file_id) BEGIN SELECT RAISE(ABORT, 'company file metadata requires parent deletion'); END";

// A missing row denotes a legacy name assignment. An empty member ID explicitly
// means administrator-only and must never fall back to a name match.
export const companyFileAssignmentsTableSql = `
CREATE TABLE IF NOT EXISTS company_file_assignments (
  file_id TEXT PRIMARY KEY NOT NULL REFERENCES company_file_objects(id) ON DELETE CASCADE,
  partner_member_id TEXT NOT NULL
)
`;

export const companyFileAssignmentsNoUpdateTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS company_file_assignments_no_update BEFORE UPDATE ON company_file_assignments BEGIN SELECT RAISE(ABORT, 'company file assignment is immutable'); END";

export const companyFileAssignmentsNoDirectDeleteTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS company_file_assignments_no_direct_delete BEFORE DELETE ON company_file_assignments WHEN EXISTS (SELECT 1 FROM company_file_objects WHERE id = OLD.file_id) BEGIN SELECT RAISE(ABORT, 'company file assignment requires parent deletion'); END";

export const companyFileCaseLinksTableSql = `
CREATE TABLE IF NOT EXISTS company_file_case_links (
  file_id TEXT PRIMARY KEY NOT NULL REFERENCES company_file_objects(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL
)
`;

export const companyFileCaseLinksNoUpdateTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS company_file_case_links_no_update BEFORE UPDATE ON company_file_case_links BEGIN SELECT RAISE(ABORT, 'company file case link is immutable'); END";

export const companyFileCaseLinksNoDirectDeleteTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS company_file_case_links_no_direct_delete BEFORE DELETE ON company_file_case_links WHEN EXISTS (SELECT 1 FROM company_file_objects WHERE id = OLD.file_id) BEGIN SELECT RAISE(ABORT, 'company file case link requires parent deletion'); END";

// Retain request records after deletion so a delayed retry cannot recreate a file.
export const companyFileUploadRequestsTableSql = `
CREATE TABLE IF NOT EXISTS company_file_upload_requests (
  owner_key TEXT NOT NULL,
  request_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  file_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'deleted')),
  PRIMARY KEY (owner_key, request_key)
)
`;

// Upload requests are durable idempotency receipts. Identity never changes,
// lifecycle only advances, and a deleted tombstone is fully immutable.
export const companyFileUploadRequestsLifecycleTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS company_file_upload_requests_lifecycle_guard BEFORE UPDATE ON company_file_upload_requests WHEN NEW.owner_key <> OLD.owner_key OR NEW.file_id <> OLD.file_id OR NEW.created_at <> OLD.created_at OR (NEW.fingerprint <> OLD.fingerprint AND NEW.request_key = OLD.request_key) OR ((NEW.request_key <> OLD.request_key OR NEW.fingerprint <> OLD.fingerprint) AND NEW.status <> OLD.status) OR (OLD.status = 'deleted' AND (NEW.request_key <> OLD.request_key OR NEW.fingerprint <> OLD.fingerprint)) OR NOT (NEW.status = OLD.status OR (OLD.status = 'pending' AND NEW.status IN ('ready', 'deleted')) OR (OLD.status = 'ready' AND NEW.status = 'deleted')) BEGIN SELECT RAISE(ABORT, 'company file upload request transition is invalid'); END";

export const companyFileUploadRequestsNoDeleteTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS company_file_upload_requests_no_delete BEFORE DELETE ON company_file_upload_requests BEGIN SELECT RAISE(ABORT, 'company file upload request is durable'); END";

export const aiDiagnosisRunsTableSql = `
CREATE TABLE IF NOT EXISTS ai_diagnosis_runs (
  id TEXT PRIMARY KEY NOT NULL,
  case_id TEXT NOT NULL,
  company TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  instruction_version TEXT NOT NULL,
  model TEXT NOT NULL,
  result_json TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
)
`;

export const aiDiagnosisRunsCaseIndexSql = `
CREATE INDEX IF NOT EXISTS ai_diagnosis_runs_case_idx
ON ai_diagnosis_runs (case_id, created_at)
`;

export const aiDiagnosisRunsPendingCaseIndexSql = `
CREATE UNIQUE INDEX IF NOT EXISTS ai_diagnosis_runs_pending_case_idx
ON ai_diagnosis_runs (case_id) WHERE status = '생성중'
`;

const aiDiagnosisFingerprintSql = (column: string) =>
  `COALESCE((json_type(${column}, '$._requestFingerprint') = 'text' AND length(json_extract(${column}, '$._requestFingerprint')) = 64 AND json_extract(${column}, '$._requestFingerprint') NOT GLOB '*[^0-9a-f]*'), 0)`;

const aiDiagnosisCompletedResultSql = (column: string) =>
  `COALESCE((${aiDiagnosisFingerprintSql(column)} AND json_type(${column}, '$._providerRequestId') = 'text' AND trim(json_extract(${column}, '$._providerRequestId')) <> '' AND json_extract(${column}, '$._providerRequestId') = trim(json_extract(${column}, '$._providerRequestId')) AND length(json_extract(${column}, '$._providerRequestId')) <= ${AI_PROVIDER_REQUEST_ID_LIMIT} AND json_type(${column}, '$._providerModel') = 'text' AND trim(json_extract(${column}, '$._providerModel')) <> '' AND json_extract(${column}, '$._providerModel') = trim(json_extract(${column}, '$._providerModel')) AND length(json_extract(${column}, '$._providerModel')) <= ${AI_DIAGNOSIS_RUN_FIELD_LIMITS.model} AND json_type(${column}, '$._providerMessageId') = 'text' AND trim(json_extract(${column}, '$._providerMessageId')) <> '' AND json_extract(${column}, '$._providerMessageId') = trim(json_extract(${column}, '$._providerMessageId')) AND length(json_extract(${column}, '$._providerMessageId')) <= ${AI_PROVIDER_MESSAGE_ID_LIMIT} AND json_type(${column}, '$.companyOverview') = 'text' AND trim(json_extract(${column}, '$.companyOverview')) <> '' AND json_type(${column}, '$.confirmedStrengths') = 'array' AND json_type(${column}, '$.mainRisks') = 'array' AND json_type(${column}, '$.solutionCandidates') = 'array' AND json_type(${column}, '$.verificationQuestions') = 'array' AND json_type(${column}, '$.missingDocuments') = 'array' AND json_type(${column}, '$.complianceNotes') = 'array' AND json_type(${column}, '$.nextAction') = 'text' AND trim(json_extract(${column}, '$.nextAction')) <> ''), 0)`;

export const aiDiagnosisRunsInsertEnvelopeTriggerSql = `CREATE TRIGGER IF NOT EXISTS ai_diagnosis_runs_insert_envelope_guard BEFORE INSERT ON ai_diagnosis_runs WHEN typeof(NEW.id) <> 'text' OR NEW.id = '' OR trim(NEW.id) <> NEW.id OR typeof(NEW.case_id) <> 'text' OR NEW.case_id = '' OR trim(NEW.case_id) <> NEW.case_id OR typeof(NEW.company) <> 'text' OR NEW.company = '' OR trim(NEW.company) <> NEW.company OR NEW.stage <> 'Step 0' OR NEW.status <> '생성중' OR typeof(NEW.instruction_version) <> 'text' OR NEW.instruction_version = '' OR trim(NEW.instruction_version) <> NEW.instruction_version OR typeof(NEW.model) <> 'text' OR NEW.model = '' OR trim(NEW.model) <> NEW.model OR json_valid(NEW.result_json) <> 1 OR COALESCE(json_type(NEW.result_json), '') <> 'object' OR NOT (${aiDiagnosisFingerprintSql('NEW.result_json')}) OR typeof(NEW.input_tokens) <> 'integer' OR NEW.input_tokens <> 0 OR typeof(NEW.output_tokens) <> 'integer' OR NEW.output_tokens <> 0 OR typeof(NEW.created_by_user_id) <> 'text' OR NEW.created_by_user_id = '' OR trim(NEW.created_by_user_id) <> NEW.created_by_user_id OR ${invalidUtcMillisecondTimestampSql('NEW.created_at')} BEGIN SELECT RAISE(ABORT, 'AI diagnosis run insert envelope is invalid'); END`;

export const aiDiagnosisRunsPendingEnvelopeTriggerSql = `CREATE TRIGGER IF NOT EXISTS ai_diagnosis_runs_pending_envelope_guard BEFORE INSERT ON ai_diagnosis_runs WHEN NEW.status = '생성중' AND NOT COALESCE((json_valid(NEW.result_json) = 1 AND json_type(NEW.result_json) = 'object' AND length(CAST(NEW.result_json AS BLOB)) <= ${STEP_ZERO_PENDING_LIMIT_BYTES} AND (SELECT COUNT(*) FROM json_each(NEW.result_json)) = 1 AND NOT EXISTS (SELECT 1 FROM json_each(NEW.result_json) AS root WHERE root.key <> '_requestFingerprint') AND ${aiDiagnosisFingerprintSql('NEW.result_json')}), 0) BEGIN SELECT RAISE(ABORT, 'AI diagnosis run pending envelope is invalid'); END`;

export const aiDiagnosisRunsFieldEnvelopeTriggerSql = `CREATE TRIGGER IF NOT EXISTS ai_diagnosis_runs_field_envelope_guard BEFORE INSERT ON ai_diagnosis_runs WHEN length(NEW.id) NOT BETWEEN 16 AND ${AI_DIAGNOSIS_RUN_FIELD_LIMITS.requestId} OR NEW.id GLOB '*[^A-Za-z0-9_-]*' OR length(NEW.case_id) NOT BETWEEN 1 AND ${AI_DIAGNOSIS_RUN_FIELD_LIMITS.caseId} OR length(NEW.company) NOT BETWEEN 1 AND ${AI_DIAGNOSIS_RUN_FIELD_LIMITS.company} OR length(NEW.instruction_version) NOT BETWEEN 1 AND ${AI_DIAGNOSIS_RUN_FIELD_LIMITS.instructionVersion} OR length(NEW.model) NOT BETWEEN 1 AND ${AI_DIAGNOSIS_RUN_FIELD_LIMITS.model} OR length(NEW.created_by_user_id) NOT BETWEEN 1 AND ${AI_DIAGNOSIS_RUN_FIELD_LIMITS.actorId} BEGIN SELECT RAISE(ABORT, 'AI diagnosis run field envelope is invalid'); END`;

export const aiDiagnosisRunsCreatedAtInsertTriggerSql = `CREATE TRIGGER IF NOT EXISTS ai_diagnosis_runs_created_at_insert_guard BEFORE INSERT ON ai_diagnosis_runs WHEN ${invalidUtcMillisecondTimestampSql('NEW.created_at')} BEGIN SELECT RAISE(ABORT, 'AI diagnosis run timestamp envelope is invalid'); END`;

export const aiDiagnosisRunsCreatedAtUpdateTriggerSql = `CREATE TRIGGER IF NOT EXISTS ai_diagnosis_runs_created_at_update_guard BEFORE UPDATE ON ai_diagnosis_runs WHEN NEW.created_at IS NOT OLD.created_at AND (${invalidUtcMillisecondTimestampSql('NEW.created_at')}) BEGIN SELECT RAISE(ABORT, 'AI diagnosis run timestamp envelope is invalid'); END`;

export const aiDiagnosisRunsUsageEnvelopeTriggerSql = `CREATE TRIGGER IF NOT EXISTS ai_diagnosis_runs_usage_envelope_guard BEFORE UPDATE ON ai_diagnosis_runs WHEN NEW.status = '대표 검토 대기' AND (typeof(NEW.input_tokens) <> 'integer' OR NEW.input_tokens NOT BETWEEN 1 AND 9007199254740991 OR typeof(NEW.output_tokens) <> 'integer' OR NEW.output_tokens NOT BETWEEN 1 AND ${STEP_ZERO_MAX_OUTPUT_TOKENS}) BEGIN SELECT RAISE(ABORT, 'AI diagnosis run usage envelope is invalid'); END`;

const invalidStoredTextSql = (column: string) =>
  `EXISTS (WITH RECURSIVE character_positions(position) AS (VALUES(1) UNION ALL SELECT position + 1 FROM character_positions WHERE position < length(${column})) SELECT 1 FROM character_positions WHERE unicode(substr(${column}, position, 1)) BETWEEN 0 AND 8 OR unicode(substr(${column}, position, 1)) BETWEEN 11 AND 12 OR unicode(substr(${column}, position, 1)) BETWEEN 14 AND 31 OR unicode(substr(${column}, position, 1)) BETWEEN 127 AND 159 OR unicode(substr(${column}, position, 1)) = 65533)`;

export const aiDiagnosisRunsFieldTextTriggerSql = `CREATE TRIGGER IF NOT EXISTS ai_diagnosis_runs_field_text_guard BEFORE INSERT ON ai_diagnosis_runs WHEN EXISTS (SELECT 1 FROM json_each(json_array(NEW.id, NEW.case_id, NEW.company, NEW.instruction_version, NEW.model, NEW.created_by_user_id)) AS field WHERE ${invalidStoredTextSql('field.value')}) BEGIN SELECT RAISE(ABORT, 'AI diagnosis run text envelope is invalid'); END`;

export const aiDiagnosisRunsResultTextTriggerSql = `CREATE TRIGGER IF NOT EXISTS ai_diagnosis_runs_result_text_guard BEFORE UPDATE ON ai_diagnosis_runs WHEN NEW.status = '대표 검토 대기' AND EXISTS (SELECT 1 FROM json_tree(NEW.result_json) AS field WHERE field.type = 'text' AND ${invalidStoredTextSql('field.value')}) BEGIN SELECT RAISE(ABORT, 'AI diagnosis run text envelope is invalid'); END`;

export const aiDiagnosisRunsIdentityTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS ai_diagnosis_runs_identity_immutable BEFORE UPDATE ON ai_diagnosis_runs WHEN NEW.id IS NOT OLD.id OR NEW.case_id IS NOT OLD.case_id OR NEW.company IS NOT OLD.company OR NEW.stage IS NOT OLD.stage OR NEW.instruction_version IS NOT OLD.instruction_version OR NEW.model IS NOT OLD.model OR NEW.created_by_user_id IS NOT OLD.created_by_user_id BEGIN SELECT RAISE(ABORT, 'AI diagnosis run identity is immutable'); END";

export const aiDiagnosisRunsTransitionTriggerSql = `CREATE TRIGGER IF NOT EXISTS ai_diagnosis_runs_transition_guard BEFORE UPDATE ON ai_diagnosis_runs WHEN NEW.id IS OLD.id AND NEW.case_id IS OLD.case_id AND NEW.company IS OLD.company AND NEW.stage IS OLD.stage AND NEW.instruction_version IS OLD.instruction_version AND NEW.model IS OLD.model AND NEW.created_by_user_id IS OLD.created_by_user_id AND NOT ((OLD.status = '생성중' AND NEW.status = '생성실패' AND NEW.result_json IS OLD.result_json AND NEW.input_tokens IS OLD.input_tokens AND NEW.output_tokens IS OLD.output_tokens AND NEW.created_at IS OLD.created_at) OR COALESCE((OLD.status = '생성중' AND NEW.status = '대표 검토 대기' AND json_valid(NEW.result_json) = 1 AND COALESCE(json_type(NEW.result_json), '') = 'object' AND ${aiDiagnosisCompletedResultSql('NEW.result_json')} AND json_extract(NEW.result_json, '$._requestFingerprint') = json_extract(OLD.result_json, '$._requestFingerprint') AND typeof(NEW.input_tokens) = 'integer' AND NEW.input_tokens BETWEEN 1 AND 9007199254740991 AND typeof(NEW.output_tokens) = 'integer' AND NEW.output_tokens BETWEEN 1 AND ${STEP_ZERO_MAX_OUTPUT_TOKENS} AND NOT (${invalidUtcMillisecondTimestampSql('NEW.created_at')}) AND NEW.created_at >= OLD.created_at), 0)) BEGIN SELECT RAISE(ABORT, 'AI diagnosis run transition is invalid'); END`;

const aiDiagnosisTextArraySql = (path: string) =>
  `COALESCE((json_type(NEW.result_json, '${path}') = 'array' AND json_array_length(NEW.result_json, '${path}') <= 20 AND NOT EXISTS (SELECT 1 FROM json_each(NEW.result_json, '${path}') AS item WHERE item.type <> 'text' OR trim(item.value) = '' OR item.value <> trim(item.value) OR length(item.value) > 4000)), 0)`;

export const aiDiagnosisRunsResultEnvelopeTriggerSql = `CREATE TRIGGER IF NOT EXISTS ai_diagnosis_runs_result_envelope_guard BEFORE UPDATE ON ai_diagnosis_runs WHEN NEW.status = '대표 검토 대기' AND NOT COALESCE((json_valid(NEW.result_json) = 1 AND json_type(NEW.result_json) = 'object' AND length(CAST(NEW.result_json AS BLOB)) <= ${STEP_ZERO_RESULT_LIMIT_BYTES} AND (SELECT COUNT(*) FROM json_each(NEW.result_json)) = 12 AND NOT EXISTS (SELECT 1 FROM json_each(NEW.result_json) AS root WHERE root.key NOT IN ('_requestFingerprint', '_providerRequestId', '_providerModel', '_providerMessageId', 'companyOverview', 'confirmedStrengths', 'mainRisks', 'solutionCandidates', 'verificationQuestions', 'missingDocuments', 'complianceNotes', 'nextAction')) AND ${aiDiagnosisFingerprintSql('NEW.result_json')} AND json_type(NEW.result_json, '$._providerRequestId') = 'text' AND trim(json_extract(NEW.result_json, '$._providerRequestId')) <> '' AND json_extract(NEW.result_json, '$._providerRequestId') = trim(json_extract(NEW.result_json, '$._providerRequestId')) AND length(json_extract(NEW.result_json, '$._providerRequestId')) <= ${AI_PROVIDER_REQUEST_ID_LIMIT} AND json_type(NEW.result_json, '$._providerModel') = 'text' AND trim(json_extract(NEW.result_json, '$._providerModel')) <> '' AND json_extract(NEW.result_json, '$._providerModel') = trim(json_extract(NEW.result_json, '$._providerModel')) AND length(json_extract(NEW.result_json, '$._providerModel')) <= ${AI_DIAGNOSIS_RUN_FIELD_LIMITS.model} AND json_type(NEW.result_json, '$._providerMessageId') = 'text' AND trim(json_extract(NEW.result_json, '$._providerMessageId')) <> '' AND json_extract(NEW.result_json, '$._providerMessageId') = trim(json_extract(NEW.result_json, '$._providerMessageId')) AND length(json_extract(NEW.result_json, '$._providerMessageId')) <= ${AI_PROVIDER_MESSAGE_ID_LIMIT} AND json_type(NEW.result_json, '$.companyOverview') = 'text' AND trim(json_extract(NEW.result_json, '$.companyOverview')) <> '' AND json_extract(NEW.result_json, '$.companyOverview') = trim(json_extract(NEW.result_json, '$.companyOverview')) AND length(json_extract(NEW.result_json, '$.companyOverview')) <= 12000 AND ${aiDiagnosisTextArraySql('$.confirmedStrengths')} AND ${aiDiagnosisTextArraySql('$.mainRisks')} AND ${aiDiagnosisTextArraySql('$.verificationQuestions')} AND ${aiDiagnosisTextArraySql('$.missingDocuments')} AND ${aiDiagnosisTextArraySql('$.complianceNotes')} AND json_type(NEW.result_json, '$.solutionCandidates') = 'array' AND json_array_length(NEW.result_json, '$.solutionCandidates') <= 10 AND NOT EXISTS (SELECT 1 FROM json_each(NEW.result_json, '$.solutionCandidates') AS candidate WHERE candidate.type <> 'object' OR (SELECT COUNT(*) FROM json_each(candidate.value)) <> 3 OR EXISTS (SELECT 1 FROM json_each(candidate.value) AS field WHERE field.key NOT IN ('solution', 'basis', 'condition')) OR NOT COALESCE((json_type(candidate.value, '$.solution') = 'text' AND trim(json_extract(candidate.value, '$.solution')) <> '' AND json_extract(candidate.value, '$.solution') = trim(json_extract(candidate.value, '$.solution')) AND length(json_extract(candidate.value, '$.solution')) <= 4000 AND json_type(candidate.value, '$.basis') = 'text' AND trim(json_extract(candidate.value, '$.basis')) <> '' AND json_extract(candidate.value, '$.basis') = trim(json_extract(candidate.value, '$.basis')) AND length(json_extract(candidate.value, '$.basis')) <= 4000 AND json_type(candidate.value, '$.condition') = 'text' AND json_extract(candidate.value, '$.condition') = trim(json_extract(candidate.value, '$.condition')) AND length(json_extract(candidate.value, '$.condition')) <= 4000), 0)) AND json_type(NEW.result_json, '$.nextAction') = 'text' AND trim(json_extract(NEW.result_json, '$.nextAction')) <> '' AND json_extract(NEW.result_json, '$.nextAction') = trim(json_extract(NEW.result_json, '$.nextAction')) AND length(json_extract(NEW.result_json, '$.nextAction')) <= 12000), 0) BEGIN SELECT RAISE(ABORT, 'AI diagnosis run result envelope is invalid'); END`;

export const aiDiagnosisRunsNoDeleteTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS ai_diagnosis_runs_no_delete BEFORE DELETE ON ai_diagnosis_runs BEGIN SELECT RAISE(ABORT, 'AI diagnosis run is durable'); END";

export const portalStateId = 'keve-partner-hub';

export const portalStateInsertTriggerSql = `CREATE TRIGGER IF NOT EXISTS portal_state_fixed_identity_insert BEFORE INSERT ON portal_state WHEN NEW.id IS NOT '${portalStateId}' BEGIN SELECT RAISE(ABORT, 'portal state identity is fixed'); END`;

export const portalStateInsertEnvelopeTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS portal_state_insert_envelope_guard BEFORE INSERT ON portal_state WHEN json_valid(NEW.payload) <> 1 OR COALESCE(json_type(NEW.payload), '') <> 'object' OR typeof(NEW.updated_at) <> 'text' OR length(NEW.updated_at) <> 24 OR substr(NEW.updated_at, 5, 1) <> '-' OR substr(NEW.updated_at, 8, 1) <> '-' OR substr(NEW.updated_at, 11, 1) <> 'T' OR substr(NEW.updated_at, 14, 1) <> ':' OR substr(NEW.updated_at, 17, 1) <> ':' OR substr(NEW.updated_at, 20, 1) <> '.' OR substr(NEW.updated_at, 24, 1) <> 'Z' OR julianday(NEW.updated_at) IS NULL BEGIN SELECT RAISE(ABORT, 'portal state insert envelope is invalid'); END";

export const portalStateInsertCapacityTriggerSql = `CREATE TRIGGER IF NOT EXISTS portal_state_insert_capacity_guard BEFORE INSERT ON portal_state WHEN length(CAST(NEW.payload AS BLOB)) > ${PORTAL_STATE_LIMIT_BYTES} BEGIN SELECT RAISE(ABORT, 'portal state payload exceeds capacity'); END`;

export const portalStateIdentityTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS portal_state_identity_immutable BEFORE UPDATE ON portal_state WHEN NEW.id IS NOT OLD.id BEGIN SELECT RAISE(ABORT, 'portal state identity is immutable'); END";

export const portalStateUpdateEnvelopeTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS portal_state_update_envelope_guard BEFORE UPDATE ON portal_state WHEN NEW.id IS OLD.id AND (json_valid(NEW.payload) <> 1 OR COALESCE(json_type(NEW.payload), '') <> 'object' OR typeof(NEW.updated_at) <> 'text' OR length(NEW.updated_at) <> 24 OR substr(NEW.updated_at, 5, 1) <> '-' OR substr(NEW.updated_at, 8, 1) <> '-' OR substr(NEW.updated_at, 11, 1) <> 'T' OR substr(NEW.updated_at, 14, 1) <> ':' OR substr(NEW.updated_at, 17, 1) <> ':' OR substr(NEW.updated_at, 20, 1) <> '.' OR substr(NEW.updated_at, 24, 1) <> 'Z' OR julianday(NEW.updated_at) IS NULL) BEGIN SELECT RAISE(ABORT, 'portal state update envelope is invalid'); END";

export const portalStateUpdateCapacityTriggerSql = `CREATE TRIGGER IF NOT EXISTS portal_state_update_capacity_guard BEFORE UPDATE ON portal_state WHEN NEW.id IS OLD.id AND length(CAST(NEW.payload AS BLOB)) > ${PORTAL_STATE_LIMIT_BYTES} BEGIN SELECT RAISE(ABORT, 'portal state payload exceeds capacity'); END`;

export const portalStateNoDeleteTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS portal_state_no_delete BEFORE DELETE ON portal_state BEGIN SELECT RAISE(ABORT, 'portal state root is durable'); END";

export const applicationDraftsTableSql = `
CREATE TABLE IF NOT EXISTS application_drafts (
  owner_key TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL,
  draft_id TEXT NOT NULL UNIQUE,
  payload TEXT,
  updated_at TEXT NOT NULL
)
`;

export const applicationDraftsIdentityTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS application_drafts_identity_immutable BEFORE UPDATE ON application_drafts WHEN NEW.owner_key IS NOT OLD.owner_key BEGIN SELECT RAISE(ABORT, 'application draft owner is immutable'); END";

export const applicationDraftsInsertTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS application_drafts_insert_guard BEFORE INSERT ON application_drafts WHEN typeof(NEW.revision) <> 'integer' OR NEW.revision IS NOT 1 OR length(NEW.draft_id) NOT BETWEEN 10 AND 80 OR NEW.draft_id GLOB '*[^A-Za-z0-9-]*' OR json_valid(NEW.payload) <> 1 OR COALESCE(json_type(NEW.payload), '') <> 'object' OR typeof(NEW.updated_at) <> 'text' OR length(NEW.updated_at) <> 24 OR substr(NEW.updated_at, 5, 1) <> '-' OR substr(NEW.updated_at, 8, 1) <> '-' OR substr(NEW.updated_at, 11, 1) <> 'T' OR substr(NEW.updated_at, 14, 1) <> ':' OR substr(NEW.updated_at, 17, 1) <> ':' OR substr(NEW.updated_at, 20, 1) <> '.' OR substr(NEW.updated_at, 24, 1) <> 'Z' OR julianday(NEW.updated_at) IS NULL BEGIN SELECT RAISE(ABORT, 'application draft insert envelope is invalid'); END";

export const applicationDraftsTransitionTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS application_drafts_transition_guard BEFORE UPDATE ON application_drafts WHEN NEW.owner_key IS OLD.owner_key AND (typeof(NEW.revision) <> 'integer' OR NEW.revision IS NOT OLD.revision + 1 OR length(NEW.draft_id) NOT BETWEEN 10 AND 80 OR NEW.draft_id GLOB '*[^A-Za-z0-9-]*' OR (NEW.payload IS NOT NULL AND (json_valid(NEW.payload) <> 1 OR COALESCE(json_type(NEW.payload), '') <> 'object')) OR NEW.payload IS OLD.payload OR typeof(NEW.updated_at) <> 'text' OR length(NEW.updated_at) <> 24 OR substr(NEW.updated_at, 5, 1) <> '-' OR substr(NEW.updated_at, 8, 1) <> '-' OR substr(NEW.updated_at, 11, 1) <> 'T' OR substr(NEW.updated_at, 14, 1) <> ':' OR substr(NEW.updated_at, 17, 1) <> ':' OR substr(NEW.updated_at, 20, 1) <> '.' OR substr(NEW.updated_at, 24, 1) <> 'Z' OR julianday(NEW.updated_at) IS NULL OR NOT ((OLD.payload IS NOT NULL AND NEW.draft_id IS OLD.draft_id) OR (OLD.payload IS NULL AND NEW.payload IS NOT NULL AND NEW.draft_id IS NOT OLD.draft_id))) BEGIN SELECT RAISE(ABORT, 'application draft transition envelope is invalid'); END";

export const applicationDraftsNoDeleteTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS application_drafts_no_delete BEFORE DELETE ON application_drafts BEGIN SELECT RAISE(ABORT, 'application draft tombstone is durable'); END";

export const consultingFlowsTableSql = `
CREATE TABLE IF NOT EXISTS consulting_flows (
  case_id TEXT PRIMARY KEY NOT NULL,
  partner_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
`;

export const consultingFlowsIdentityTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS consulting_flows_identity_immutable BEFORE UPDATE ON consulting_flows WHEN NEW.case_id IS NOT OLD.case_id OR NEW.partner_id IS NOT OLD.partner_id BEGIN SELECT RAISE(ABORT, 'consulting flow identity is immutable'); END";

export const consultingFlowsInsertEnvelopeTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS consulting_flows_insert_envelope_guard BEFORE INSERT ON consulting_flows WHEN typeof(NEW.revision) <> 'integer' OR NEW.revision < 0 OR json_valid(NEW.payload) <> 1 OR COALESCE(json_type(NEW.payload), '') <> 'object' OR COALESCE(json_type(NEW.payload, '$.caseId'), '') <> 'text' OR json_extract(NEW.payload, '$.caseId') IS NOT NEW.case_id OR COALESCE(json_type(NEW.payload, '$.partnerId'), '') <> 'text' OR json_extract(NEW.payload, '$.partnerId') IS NOT NEW.partner_id OR COALESCE(json_type(NEW.payload, '$.revision'), '') <> 'integer' OR json_extract(NEW.payload, '$.revision') IS NOT NEW.revision OR COALESCE(json_type(NEW.payload, '$.updatedAt'), '') <> 'text' OR json_extract(NEW.payload, '$.updatedAt') IS NOT NEW.updated_at BEGIN SELECT RAISE(ABORT, 'consulting flow insert envelope is invalid'); END";

export const consultingFlowsInitialCommandInsertTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_initial_command_insert_guard
BEFORE INSERT ON consulting_flows
WHEN json_valid(NEW.payload) = 1
  AND COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) > 0
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial commands must use a guarded update');
END
`;

export const consultingFlowsJobsInsertTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_jobs_insert_guard
BEFORE INSERT ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.jobs') AS job
  WHERE COALESCE(json_extract(job.value, '$.status'), '') NOT IN ('queued', 'blocked')
    OR json_type(job.value, '$.startedAt') IS NOT NULL
    OR json_type(job.value, '$.completedAt') IS NOT NULL
    OR json_type(job.value, '$.reportId') IS NOT NULL
    OR json_type(job.value, '$.evidence') IS NOT NULL
    OR json_type(job.value, '$.failureEvidence') IS NOT NULL
    OR json_type(job.value, '$.failureEvidenceHistory') IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial job is invalid');
END
`;

export const consultingFlowsTransitionTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS consulting_flows_transition_guard BEFORE UPDATE ON consulting_flows WHEN NEW.case_id IS OLD.case_id AND NEW.partner_id IS OLD.partner_id AND (NEW.revision IS NOT OLD.revision + 1 OR json_valid(NEW.payload) <> 1 OR COALESCE(json_type(NEW.payload), '') <> 'object' OR COALESCE(json_type(NEW.payload, '$.caseId'), '') <> 'text' OR json_extract(NEW.payload, '$.caseId') IS NOT NEW.case_id OR COALESCE(json_type(NEW.payload, '$.partnerId'), '') <> 'text' OR json_extract(NEW.payload, '$.partnerId') IS NOT NEW.partner_id OR COALESCE(json_type(NEW.payload, '$.revision'), '') <> 'integer' OR json_extract(NEW.payload, '$.revision') IS NOT NEW.revision OR COALESCE(json_type(NEW.payload, '$.updatedAt'), '') <> 'text' OR json_extract(NEW.payload, '$.updatedAt') IS NOT NEW.updated_at) BEGIN SELECT RAISE(ABORT, 'consulting flow transition envelope is invalid'); END";

export const consultingFlowsAuditAppendOnlyTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_audit_append_only
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1
  FROM json_each(OLD.payload, '$.audit') AS previous
  LEFT JOIN json_each(NEW.payload, '$.audit') AS next ON next.key = previous.key
  WHERE next.key IS NULL OR json(next.value) IS NOT json(previous.value)
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow audit is append-only');
END
`;

export const consultingFlowsAuditInsertCardinalityTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_audit_insert_cardinality_guard
BEFORE INSERT ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.audit'), -1) <>
  COALESCE(json_array_length(NEW.payload, '$.commandIds'), -1)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial audit cardinality is invalid');
END
`;

export const consultingFlowsAuditCardinalityTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_audit_cardinality_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.audit'), -1) <>
  COALESCE(json_array_length(OLD.payload, '$.audit'), -1) +
  COALESCE(json_array_length(NEW.payload, '$.commandIds'), -1) -
  COALESCE(json_array_length(OLD.payload, '$.commandIds'), -1) +
  (SELECT count(*)
    FROM json_each(OLD.payload, '$.jobs') AS previous
    JOIN json_each(NEW.payload, '$.jobs') AS next
      ON json_extract(next.value, '$.id') IS json_extract(previous.value, '$.id')
    WHERE json_extract(previous.value, '$.status') IS 'processing'
      AND json_extract(next.value, '$.status') IN ('blocked', 'failed', 'complete'))
BEGIN
  SELECT RAISE(ABORT, 'consulting flow audit cardinality is invalid');
END
`;

export const consultingFlowsCommandInsertCardinalityTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_command_insert_cardinality_guard
BEFORE INSERT ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) > 1
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial command cardinality is invalid');
END
`;

export const consultingFlowsCommandCardinalityTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_command_cardinality_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) -
  COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0) > 1
BEGIN
  SELECT RAISE(ABORT, 'consulting flow command cardinality is invalid');
END
`;

export const consultingFlowsCommandAiTransitionTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_command_ai_transition_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    SELECT 1
    FROM json_each(OLD.payload, '$.jobs') AS previous
    JOIN json_each(NEW.payload, '$.jobs') AS next
      ON json_extract(next.value, '$.id') IS json_extract(previous.value, '$.id')
    WHERE (json_extract(previous.value, '$.status') IS 'queued'
        AND json_extract(next.value, '$.status') IS 'processing')
      OR (json_extract(previous.value, '$.status') IS 'processing'
        AND json_extract(next.value, '$.status') IN ('blocked', 'failed', 'complete'))
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow command AI transition is invalid');
END
`;

export const consultingFlowsSetAiPolicyJobsTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_set_ai_policy_jobs_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(action) AS (
      SELECT json_extract(receipt.value, '$.action')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    )
    SELECT 1 FROM command
    WHERE command.action IS 'set_ai_policy'
      AND (
        json_array_length(NEW.payload, '$.jobs') IS NOT
          json_array_length(OLD.payload, '$.jobs')
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
          WHERE json(json_extract(
              NEW.payload,
              '$.jobs[' || previous.key || ']'
            )) IS NOT json(
              CASE
                WHEN json_extract(NEW.payload, '$.ai.enabled') IS 0
                  AND json_extract(previous.value, '$.status') IS 'queued'
                THEN json_set(
                  previous.value,
                  '$.status', 'blocked',
                  '$.reason', '대표가 자동생성을 중지했습니다.'
                )
                ELSE previous.value
              END
            )
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow set AI policy jobs are invalid');
END
`;

export const consultingFlowsQueueReportJobEffectTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_queue_report_job_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(id, action) AS (
      SELECT command.value, json_extract(receipt.value, '$.action')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), new_job(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.jobs[' || json_array_length(OLD.payload, '$.jobs') || ']'
      )
    ), expected(reason) AS (
      SELECT CASE WHEN json_extract(NEW.payload, '$.ai.enabled') IS 0
        THEN '김성민 대표의 외부 AI 자동생성 승인이 필요합니다.'
        ELSE ''
      END
    )
    SELECT 1
    FROM command
    CROSS JOIN new_job
    CROSS JOIN expected
    WHERE command.action IS 'queue_report1'
      AND (
        json_array_length(NEW.payload, '$.jobs') IS NOT
          json_array_length(OLD.payload, '$.jobs') + 1
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
          WHERE json(json_extract(
              NEW.payload,
              '$.jobs[' || previous.key || ']'
            )) IS NOT json(previous.value)
        )
        OR json(new_job.value) IS NOT json(json_object(
          'id', command.id || '-job',
          'stage', 1,
          'status', CASE WHEN expected.reason = '' THEN 'queued' ELSE 'blocked' END,
          'reason', expected.reason,
          'createdAt', NEW.updated_at
        ))
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow queue report job effect is invalid');
END
`;

export const consultingFlowsSaveReportEffectTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_save_report_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(id, actor, action) AS (
      SELECT command.value,
        json_extract(receipt.value, '$.actor'),
        json_extract(receipt.value, '$.action')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), report(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.reports[' || json_array_length(OLD.payload, '$.reports') || ']'
      )
    ), new_file(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.files[' || json_array_length(OLD.payload, '$.files') || ']'
      )
    )
    SELECT 1
    FROM command
    CROSS JOIN report
    CROSS JOIN new_file
    WHERE command.action IS 'save_report'
      AND (
        json_array_length(NEW.payload, '$.reports') IS NOT
          json_array_length(OLD.payload, '$.reports') + 1
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.reports') AS previous
          WHERE json(json_extract(
              NEW.payload,
              '$.reports[' || previous.key || ']'
            )) IS NOT json(previous.value)
        )
        OR json_extract(report.value, '$.id') IS NOT
          (command.id || '-report')
        OR json_type(report.value, '$.stage') IS NOT 'integer'
        OR json_extract(report.value, '$.stage') NOT BETWEEN 1 AND 6
        OR json_extract(report.value, '$.version') IS NOT (
          SELECT count(*) + 1
          FROM json_each(OLD.payload, '$.reports') AS previous
          WHERE json_extract(previous.value, '$.stage') IS
            json_extract(report.value, '$.stage')
        )
        OR json_extract(report.value, '$.title') IS NOT
          CASE json_extract(report.value, '$.stage')
            WHEN 1 THEN '1차 정밀진단보고서'
            WHEN 2 THEN '2차 대표 상담보고서'
            WHEN 3 THEN '3차 초회상담 PPT'
            WHEN 4 THEN '4차 심화보고서'
            WHEN 5 THEN '5차 견적서'
            WHEN 6 THEN '6차 경영자문용역계약서'
          END
        OR json_type(report.value, '$.body') IS NOT 'text'
        OR json_extract(report.value, '$.body') IS NOT
          trim(json_extract(report.value, '$.body'))
        OR (
          length(json_extract(report.value, '$.body')) < 80
          AND json_type(report.value, '$.fileId') IS NOT 'text'
        )
        OR (
          json_type(report.value, '$.fileId') IS NOT NULL
          AND json_type(report.value, '$.fileId') IS NOT 'text'
        )
        OR json_extract(report.value, '$.createdAt') IS NOT NEW.updated_at
        OR json_extract(report.value, '$.createdBy') IS NOT command.actor
        OR json_extract(report.value, '$.origin') IS NOT 'manual'
        OR CASE
          WHEN json_extract(report.value, '$.stage') = 1
          THEN json_type(report.value, '$.sourceReportId') IS NOT NULL
          ELSE json_type(report.value, '$.sourceReportId') IS NOT 'text'
            OR json_extract(report.value, '$.sourceReportId') IS NOT (
              SELECT json_extract(previous.value, '$.id')
              FROM json_each(OLD.payload, '$.reports') AS previous
              WHERE json_extract(previous.value, '$.stage') = 1
              ORDER BY CAST(previous.key AS INTEGER) DESC
              LIMIT 1
            )
        END
        OR CASE
          WHEN json_extract(report.value, '$.stage') = 4
          THEN json_type(report.value, '$.sourceRecordingId') IS NOT 'text'
            OR json_extract(report.value, '$.sourceRecordingId') IS NOT (
              SELECT json_extract(previous.value, '$.id')
              FROM json_each(OLD.payload, '$.recordings') AS previous
              ORDER BY CAST(previous.key AS INTEGER) DESC
              LIMIT 1
            )
          ELSE json_type(report.value, '$.sourceRecordingId') IS NOT NULL
        END
        OR CASE
          WHEN json_extract(report.value, '$.stage') >= 5
          THEN json_type(report.value, '$.decisionId') IS NOT 'text'
            OR json_extract(report.value, '$.decisionId') IS NOT
              json_extract(OLD.payload, '$.decision.id')
            OR json_type(report.value, '$.documentsKey') IS NOT 'text'
            OR json_extract(report.value, '$.documentsKey') IS NOT (
              SELECT json_group_array(json_array(
                json_extract(request.value, '$.id'),
                json_extract(request.value, '$.fileId'),
                json_extract(request.value, '$.verifiedAt')
              ))
              FROM json_each(OLD.payload, '$.requests') AS request
              WHERE json_extract(request.value, '$.required') IS 1
            )
          ELSE json_type(report.value, '$.decisionId') IS NOT NULL
            OR json_type(report.value, '$.documentsKey') IS NOT NULL
        END
        OR json_array_length(NEW.payload, '$.files') NOT IN (
          json_array_length(OLD.payload, '$.files'),
          json_array_length(OLD.payload, '$.files') + 1
        )
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.files') AS previous
          WHERE json(json_extract(
              NEW.payload,
              '$.files[' || previous.key || ']'
            )) IS NOT json(previous.value)
        )
        OR CASE
          WHEN json_array_length(NEW.payload, '$.files') =
              json_array_length(OLD.payload, '$.files') + 1
          THEN json_extract(new_file.value, '$.id') IS NOT
              json_extract(report.value, '$.fileId')
            OR json_extract(new_file.value, '$.purpose') IS NOT 'report'
            OR json_extract(new_file.value, '$.createdAt') IS NOT NEW.updated_at
            OR json_type(new_file.value, '$.intakeFileId') IS NOT NULL
            OR json_type(new_file.value, '$.intakeSourceHash') IS NOT NULL
            OR json_type(new_file.value, '$.sourceReviewedAt') IS NOT NULL
            OR json_type(new_file.value, '$.sourceReviewedBy') IS NOT NULL
          ELSE json_type(report.value, '$.fileId') = 'text'
            AND NOT EXISTS (
              SELECT 1 FROM json_each(OLD.payload, '$.files') AS previous
              WHERE json_extract(previous.value, '$.id') IS
                json_extract(report.value, '$.fileId')
            )
        END
        OR CASE
          WHEN json_extract(report.value, '$.stage') = 1
          THEN json(json_extract(NEW.payload, '$.analysis')) IS NOT
            json(json_object('reportId', command.id || '-report'))
          ELSE json(json_extract(NEW.payload, '$.analysis')) IS NOT
            json(json_extract(OLD.payload, '$.analysis'))
        END
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow save report effect is invalid');
END
`;

export const consultingFlowsConfirmAnalysisEffectTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_confirm_analysis_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(actor_key, action) AS (
      SELECT json_extract(receipt.value, '$.actorKey'),
        json_extract(receipt.value, '$.action')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), latest_report(id) AS (
      SELECT json_extract(report.value, '$.id')
      FROM json_each(OLD.payload, '$.reports') AS report
      WHERE json_extract(report.value, '$.stage') = 1
      ORDER BY CAST(report.key AS INTEGER) DESC
      LIMIT 1
    )
    SELECT 1
    FROM command
    WHERE command.action IS 'confirm_analysis'
      AND (
        NOT EXISTS (SELECT 1 FROM latest_report)
        OR CASE
          WHEN command.actor_key IS 'admin:primary'
          THEN json(json_extract(NEW.payload, '$.analysis')) IS NOT json(
            CASE
              WHEN json_extract(OLD.payload, '$.analysis.reportId') IS
                  (SELECT id FROM latest_report)
              THEN json_set(
                json(json_extract(OLD.payload, '$.analysis')),
                '$.adminAt', NEW.updated_at
              )
              ELSE json_object(
                'reportId', (SELECT id FROM latest_report),
                'adminAt', NEW.updated_at
              )
            END
          )
          WHEN command.actor_key IS
              ('member:' || json_extract(OLD.payload, '$.partnerId'))
          THEN json(json_extract(NEW.payload, '$.analysis')) IS NOT json(
            CASE
              WHEN json_extract(OLD.payload, '$.analysis.reportId') IS
                  (SELECT id FROM latest_report)
              THEN json_set(
                json(json_extract(OLD.payload, '$.analysis')),
                '$.partnerAt', NEW.updated_at
              )
              ELSE json_object(
                'reportId', (SELECT id FROM latest_report),
                'partnerAt', NEW.updated_at
              )
            END
          )
          ELSE 1
        END
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow confirm analysis effect is invalid');
END
`;

export const consultingFlowsBookMeetingEffectTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_book_meeting_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(id, actor_key, action) AS (
      SELECT command.value,
        json_extract(receipt.value, '$.actorKey'),
        json_extract(receipt.value, '$.action')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), meeting(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.meetings[' || json_array_length(OLD.payload, '$.meetings') || ']'
      )
    )
    SELECT 1
    FROM command
    CROSS JOIN meeting
    WHERE command.action IS 'book_meeting'
      AND (
        json_array_length(NEW.payload, '$.meetings') IS NOT
          json_array_length(OLD.payload, '$.meetings') + 1
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.meetings') AS previous
          WHERE json(json_extract(
              NEW.payload,
              '$.meetings[' || previous.key || ']'
            )) IS NOT json(previous.value)
        )
        OR json_type(meeting.value) IS NOT 'object'
        OR (SELECT count(*) FROM json_each(meeting.value)) IS NOT 9
        OR EXISTS (
          SELECT 1 FROM json_each(meeting.value) AS field
          WHERE field.key NOT IN (
            'id', 'kind', 'startsAt', 'endsAt', 'attendance', 'location',
            'status', 'note', 'createdBy'
          )
        )
        OR json_extract(meeting.value, '$.id') IS NOT
          (command.id || '-meeting')
        OR json_type(meeting.value, '$.kind') IS NOT 'text'
        OR json_extract(meeting.value, '$.kind') NOT IN (
          'first', 'followup', 'contract'
        )
        OR json_type(meeting.value, '$.startsAt') IS NOT 'text'
        OR json_extract(meeting.value, '$.startsAt') IS NOT strftime(
          '%Y-%m-%dT%H:%M:%fZ', json_extract(meeting.value, '$.startsAt')
        )
        OR json_type(meeting.value, '$.endsAt') IS NOT 'text'
        OR json_extract(meeting.value, '$.endsAt') IS NOT strftime(
          '%Y-%m-%dT%H:%M:%fZ', json_extract(meeting.value, '$.endsAt')
        )
        OR json_extract(meeting.value, '$.endsAt') <=
          json_extract(meeting.value, '$.startsAt')
        OR json_type(meeting.value, '$.attendance') IS NOT 'text'
        OR json_extract(meeting.value, '$.attendance') NOT IN (
          'both', 'partner', 'admin'
        )
        OR json_type(meeting.value, '$.location') IS NOT 'text'
        OR json_extract(meeting.value, '$.location') IS NOT
          trim(json_extract(meeting.value, '$.location'))
        OR length(json_extract(meeting.value, '$.location')) NOT BETWEEN 1 AND 200
        OR json_extract(meeting.value, '$.status') IS NOT 'scheduled'
        OR json_type(meeting.value, '$.note') IS NOT 'text'
        OR json_extract(meeting.value, '$.note') IS NOT
          trim(json_extract(meeting.value, '$.note'))
        OR length(json_extract(meeting.value, '$.note')) > 1000
        OR json_extract(meeting.value, '$.createdBy') IS NOT CASE
          WHEN command.actor_key IS 'admin:primary' THEN 'admin:primary'
          WHEN command.actor_key IS
              ('member:' || json_extract(OLD.payload, '$.partnerId'))
          THEN json_extract(OLD.payload, '$.partnerId')
          ELSE NULL
        END
        OR json_type(meeting.value, '$.completedAt') IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.meetings') AS previous
          WHERE json_extract(previous.value, '$.status') IS 'scheduled'
            AND json_extract(meeting.value, '$.startsAt') <
              json_extract(previous.value, '$.endsAt')
            AND json_extract(meeting.value, '$.endsAt') >
              json_extract(previous.value, '$.startsAt')
        )
        OR CASE json_extract(meeting.value, '$.kind')
          WHEN 'first' THEN
            json_extract(meeting.value, '$.attendance') IS NOT 'both'
            OR json_extract(OLD.payload, '$.analysis.reportId') IS NOT (
              SELECT json_extract(report.value, '$.id')
              FROM json_each(OLD.payload, '$.reports') AS report
              WHERE json_extract(report.value, '$.stage') = 1
              ORDER BY CAST(report.key AS INTEGER) DESC
              LIMIT 1
            )
            OR json_type(OLD.payload, '$.analysis.adminAt') IS NOT 'text'
            OR json_type(OLD.payload, '$.analysis.partnerAt') IS NOT 'text'
            OR EXISTS (
              SELECT 1 FROM json_each(OLD.payload, '$.meetings') AS previous
              WHERE json_extract(previous.value, '$.kind') IS 'first'
                AND json_extract(previous.value, '$.status') IS NOT 'cancelled'
            )
          WHEN 'followup' THEN NOT EXISTS (
            SELECT 1 FROM json_each(OLD.payload, '$.meetings') AS previous
            WHERE json_extract(previous.value, '$.kind') IS 'first'
              AND json_extract(previous.value, '$.status') IS NOT 'cancelled'
              AND json_extract(previous.value, '$.status') IS 'completed'
            ORDER BY CAST(previous.key AS INTEGER)
            LIMIT 1
          )
          WHEN 'contract' THEN
            json_type(OLD.payload, '$.contract') IS NOT NULL
            OR json_type(OLD.payload, '$.decision') IS NOT 'object'
            OR NOT EXISTS (
              WITH latest_report(id) AS (
                SELECT json_extract(report.value, '$.id')
                FROM json_each(OLD.payload, '$.reports') AS report
                WHERE json_extract(report.value, '$.stage') = 1
                ORDER BY CAST(report.key AS INTEGER) DESC
                LIMIT 1
              ), latest_recording(id) AS (
                SELECT json_extract(recording.value, '$.id')
                FROM json_each(OLD.payload, '$.recordings') AS recording
                ORDER BY CAST(recording.key AS INTEGER) DESC
                LIMIT 1
              )
              SELECT 1 FROM json_each(OLD.payload, '$.reports') AS report
              WHERE json_extract(report.value, '$.stage') = 4
                AND json_extract(report.value, '$.id') IS
                  json_extract(OLD.payload, '$.decision.reportId')
                AND json_extract(report.value, '$.sourceReportId') IS
                  (SELECT id FROM latest_report)
                AND json_extract(report.value, '$.sourceRecordingId') IS
                  (SELECT id FROM latest_recording)
              ORDER BY CAST(report.key AS INTEGER) DESC
              LIMIT 1
            )
            OR (
              json_extract(OLD.payload, '$.decision.documentsNeeded') IS 1
              AND NOT EXISTS (
                SELECT 1 FROM json_each(OLD.payload, '$.requests') AS request
                WHERE json_extract(request.value, '$.required') IS 1
              )
            )
            OR EXISTS (
              SELECT 1 FROM json_each(OLD.payload, '$.requests') AS request
              WHERE json_extract(request.value, '$.required') IS 1
                AND json_extract(request.value, '$.status') IS NOT 'verified'
            )
            OR NOT EXISTS (
              SELECT 1 FROM (
                SELECT report.value
                FROM json_each(OLD.payload, '$.reports') AS report
                WHERE json_extract(report.value, '$.stage') = 5
                ORDER BY CAST(report.key AS INTEGER) DESC
                LIMIT 1
              ) AS report
              WHERE json_extract(report.value, '$.decisionId') IS
                  json_extract(OLD.payload, '$.decision.id')
                AND json_extract(report.value, '$.documentsKey') IS (
                  SELECT json_group_array(json_array(
                    json_extract(request.value, '$.id'),
                    json_extract(request.value, '$.fileId'),
                    json_extract(request.value, '$.verifiedAt')
                  ))
                  FROM json_each(OLD.payload, '$.requests') AS request
                  WHERE json_extract(request.value, '$.required') IS 1
                )
            )
            OR NOT EXISTS (
              SELECT 1 FROM (
                SELECT report.value
                FROM json_each(OLD.payload, '$.reports') AS report
                WHERE json_extract(report.value, '$.stage') = 6
                ORDER BY CAST(report.key AS INTEGER) DESC
                LIMIT 1
              ) AS report
              WHERE json_extract(report.value, '$.decisionId') IS
                  json_extract(OLD.payload, '$.decision.id')
                AND json_extract(report.value, '$.documentsKey') IS (
                  SELECT json_group_array(json_array(
                    json_extract(request.value, '$.id'),
                    json_extract(request.value, '$.fileId'),
                    json_extract(request.value, '$.verifiedAt')
                  ))
                  FROM json_each(OLD.payload, '$.requests') AS request
                  WHERE json_extract(request.value, '$.required') IS 1
                )
            )
          ELSE 1
        END
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow book meeting effect is invalid');
END
`;

export const consultingFlowsCommandInsertReceiptTargetTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_command_insert_receipt_target_guard
BEFORE INSERT ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandReceipts') AS receipt
  WHERE json_type(receipt.value, '$.targetId') IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial command receipt target is invalid');
END
`;

export const consultingFlowsNewCommandReceiptTargetTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_new_command_receipt_target_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
    ON receipt.key IS command.value
  WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
    AND CASE
      WHEN json_extract(receipt.value, '$.action') IN (
        'complete_meeting', 'cancel_meeting', 'mark_request_sent',
        'receive_document', 'review_document', 'record_contract'
      ) THEN
        json_type(receipt.value, '$.targetId') IS NOT 'text'
        OR length(json_extract(receipt.value, '$.targetId')) NOT BETWEEN 1 AND 200
      ELSE json_type(receipt.value, '$.targetId') IS NOT NULL
    END
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow new command receipt target is invalid');
END
`;

export const consultingFlowsCommandReceiptTargetHistoryTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_command_receipt_target_history_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(OLD.payload, '$.commandReceipts') AS previous
  JOIN json_each(NEW.payload, '$.commandReceipts') AS current
    ON current.key IS previous.key
  WHERE json_type(current.value, '$.targetId') IS NOT
      json_type(previous.value, '$.targetId')
    OR json_extract(current.value, '$.targetId') IS NOT
      json_extract(previous.value, '$.targetId')
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow command receipt target is immutable');
END
`;

export const consultingFlowsCompleteMeetingEffectTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_complete_meeting_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(actor_key, action, target_id) AS (
      SELECT json_extract(receipt.value, '$.actorKey'),
        json_extract(receipt.value, '$.action'),
        json_extract(receipt.value, '$.targetId')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), target(position, previous_value, next_value) AS (
      SELECT previous.key,
        previous.value,
        json_extract(
          NEW.payload,
          '$.meetings[' || previous.key || ']'
        )
      FROM json_each(OLD.payload, '$.meetings') AS previous
      CROSS JOIN command
      WHERE json_extract(previous.value, '$.id') IS command.target_id
    )
    SELECT 1 FROM command
    WHERE command.action IS 'complete_meeting'
      AND (
        (SELECT count(*) FROM target) IS NOT 1
        OR json_array_length(NEW.payload, '$.meetings') IS NOT
          json_array_length(OLD.payload, '$.meetings')
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.meetings') AS previous
          WHERE json_extract(previous.value, '$.id') IS NOT command.target_id
            AND json(json_extract(
              NEW.payload,
              '$.meetings[' || previous.key || ']'
            )) IS NOT json(previous.value)
        )
        OR EXISTS (
          SELECT 1 FROM target
          WHERE json_extract(previous_value, '$.status') IS NOT 'scheduled'
            OR json_type(previous_value, '$.completedAt') IS NOT NULL
            OR json_extract(next_value, '$.status') IS NOT 'completed'
            OR json_extract(next_value, '$.completedAt') IS NOT NEW.updated_at
            OR json_remove(
              json(next_value), '$.status', '$.completedAt', '$.note'
            ) IS NOT json_remove(
              json(previous_value), '$.status', '$.completedAt', '$.note'
            )
            OR json_type(next_value, '$.note') IS NOT 'text'
            OR length(json_extract(next_value, '$.note')) > 1500
            OR (
              json_extract(next_value, '$.note') IS NOT
                json_extract(previous_value, '$.note')
              AND (
                length(json_extract(next_value, '$.note')) = 0
                OR json_extract(next_value, '$.note') IS NOT
                  trim(json_extract(next_value, '$.note'))
              )
            )
            OR json_extract(previous_value, '$.startsAt') > NEW.updated_at
            OR NOT (
              command.actor_key IS 'admin:primary'
              OR (
                command.actor_key IS
                  ('member:' || json_extract(OLD.payload, '$.partnerId'))
                AND json_extract(previous_value, '$.attendance') IN (
                  'both', 'partner'
                )
              )
            )
            OR (
              json_extract(previous_value, '$.kind') IS 'first'
              AND (
                json_extract(OLD.payload, '$.analysis.reportId') IS NOT (
                  SELECT json_extract(report.value, '$.id')
                  FROM json_each(OLD.payload, '$.reports') AS report
                  WHERE json_extract(report.value, '$.stage') = 1
                  ORDER BY CAST(report.key AS INTEGER) DESC
                  LIMIT 1
                )
                OR json_type(OLD.payload, '$.analysis.adminAt') IS NOT 'text'
                OR json_type(OLD.payload, '$.analysis.partnerAt') IS NOT 'text'
                OR (
                  SELECT json_extract(report.value, '$.sourceReportId')
                  FROM json_each(OLD.payload, '$.reports') AS report
                  WHERE json_extract(report.value, '$.stage') = 2
                  ORDER BY CAST(report.key AS INTEGER) DESC
                  LIMIT 1
                ) IS NOT (
                  SELECT json_extract(report.value, '$.id')
                  FROM json_each(OLD.payload, '$.reports') AS report
                  WHERE json_extract(report.value, '$.stage') = 1
                  ORDER BY CAST(report.key AS INTEGER) DESC
                  LIMIT 1
                )
                OR (
                  SELECT json_extract(report.value, '$.sourceReportId')
                  FROM json_each(OLD.payload, '$.reports') AS report
                  WHERE json_extract(report.value, '$.stage') = 3
                  ORDER BY CAST(report.key AS INTEGER) DESC
                  LIMIT 1
                ) IS NOT (
                  SELECT json_extract(report.value, '$.id')
                  FROM json_each(OLD.payload, '$.reports') AS report
                  WHERE json_extract(report.value, '$.stage') = 1
                  ORDER BY CAST(report.key AS INTEGER) DESC
                  LIMIT 1
                )
                OR EXISTS (
                  SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS job
                  WHERE json_extract(job.value, '$.stage') = 1
                    AND json_extract(job.value, '$.status') IN (
                      'queued', 'processing'
                    )
                )
              )
            )
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow complete meeting effect is invalid');
END
`;

export const consultingFlowsCancelMeetingEffectTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_cancel_meeting_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(actor_key, action, target_id) AS (
      SELECT json_extract(receipt.value, '$.actorKey'),
        json_extract(receipt.value, '$.action'),
        json_extract(receipt.value, '$.targetId')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), target(position, previous_value, next_value) AS (
      SELECT previous.key,
        previous.value,
        json_extract(
          NEW.payload,
          '$.meetings[' || previous.key || ']'
        )
      FROM json_each(OLD.payload, '$.meetings') AS previous
      CROSS JOIN command
      WHERE json_extract(previous.value, '$.id') IS command.target_id
    )
    SELECT 1 FROM command
    WHERE command.action IS 'cancel_meeting'
      AND (
        (SELECT count(*) FROM target) IS NOT 1
        OR json_array_length(NEW.payload, '$.meetings') IS NOT
          json_array_length(OLD.payload, '$.meetings')
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.meetings') AS previous
          WHERE json_extract(previous.value, '$.id') IS NOT command.target_id
            AND json(json_extract(
              NEW.payload,
              '$.meetings[' || previous.key || ']'
            )) IS NOT json(previous.value)
        )
        OR EXISTS (
          SELECT 1 FROM target
          WHERE json_extract(previous_value, '$.status') IS NOT 'scheduled'
            OR json_type(previous_value, '$.completedAt') IS NOT NULL
            OR json_extract(next_value, '$.status') IS NOT 'cancelled'
            OR json_type(next_value, '$.completedAt') IS NOT NULL
            OR json_remove(
              json(next_value), '$.status', '$.note'
            ) IS NOT json_remove(
              json(previous_value), '$.status', '$.note'
            )
            OR json_type(next_value, '$.note') IS NOT 'text'
            OR length(json_extract(next_value, '$.note')) > 1500
            OR (
              json_extract(next_value, '$.note') IS NOT
                json_extract(previous_value, '$.note')
              AND (
                length(json_extract(next_value, '$.note')) = 0
                OR json_extract(next_value, '$.note') IS NOT
                  trim(json_extract(next_value, '$.note'))
              )
            )
            OR NOT (
              command.actor_key IS 'admin:primary'
              OR (
                command.actor_key IS
                  ('member:' || json_extract(OLD.payload, '$.partnerId'))
                AND json_extract(previous_value, '$.attendance') IN (
                  'both', 'partner'
                )
              )
            )
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow cancel meeting effect is invalid');
END
`;

export const consultingFlowsConfirmSolutionsEffectTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_confirm_solutions_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(id, actor_key, action) AS (
      SELECT command.value,
        json_extract(receipt.value, '$.actorKey'),
        json_extract(receipt.value, '$.action')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), latest_report(id) AS (
      SELECT json_extract(report.value, '$.id')
      FROM json_each(OLD.payload, '$.reports') AS report
      WHERE json_extract(report.value, '$.stage') = 1
      ORDER BY CAST(report.key AS INTEGER) DESC
      LIMIT 1
    ), latest_recording(id) AS (
      SELECT json_extract(recording.value, '$.id')
      FROM json_each(OLD.payload, '$.recordings') AS recording
      ORDER BY CAST(recording.key AS INTEGER) DESC
      LIMIT 1
    ), deep_report(id) AS (
      SELECT json_extract(report.value, '$.id')
      FROM json_each(OLD.payload, '$.reports') AS report
      WHERE json_extract(report.value, '$.stage') = 4
        AND json_extract(report.value, '$.sourceReportId') IS
          (SELECT id FROM latest_report)
        AND json_extract(report.value, '$.sourceRecordingId') IS
          (SELECT id FROM latest_recording)
      ORDER BY CAST(report.key AS INTEGER) DESC
      LIMIT 1
    )
    SELECT 1 FROM command
    WHERE command.action IS 'confirm_solutions'
      AND (
        command.actor_key IS NOT 'admin:primary'
        OR json_type(OLD.payload, '$.contract') IS NOT NULL
        OR NOT EXISTS (SELECT 1 FROM deep_report)
        OR json_type(NEW.payload, '$.decision') IS NOT 'object'
        OR (SELECT count(*) FROM json_each(
          NEW.payload, '$.decision'
        )) IS NOT 6
        OR EXISTS (
          SELECT 1 FROM json_each(NEW.payload, '$.decision') AS field
          WHERE field.key NOT IN (
            'id', 'reportId', 'solutions', 'note', 'documentsNeeded', 'at'
          )
        )
        OR json_extract(NEW.payload, '$.decision.id') IS NOT
          (command.id || '-decision')
        OR json_extract(NEW.payload, '$.decision.reportId') IS NOT
          (SELECT id FROM deep_report)
        OR json_type(NEW.payload, '$.decision.solutions') IS NOT 'array'
        OR json_array_length(
          NEW.payload, '$.decision.solutions'
        ) NOT BETWEEN 1 AND 12
        OR EXISTS (
          SELECT 1
          FROM json_each(NEW.payload, '$.decision.solutions') AS solution
          WHERE solution.type IS NOT 'text'
            OR length(trim(solution.value)) = 0
            OR solution.value IS NOT trim(solution.value)
            OR length(solution.value) > 80
        )
        OR EXISTS (
          SELECT 1
          FROM json_each(NEW.payload, '$.decision.solutions') AS solution
          GROUP BY solution.value
          HAVING count(*) > 1
        )
        OR json_type(
          NEW.payload, '$.decision.documentsNeeded'
        ) NOT IN ('true', 'false')
        OR json_type(NEW.payload, '$.decision.note') IS NOT 'text'
        OR json_extract(NEW.payload, '$.decision.note') IS NOT
          trim(json_extract(NEW.payload, '$.decision.note'))
        OR length(json_extract(NEW.payload, '$.decision.note')) > 2000
        OR json_extract(NEW.payload, '$.decision.at') IS NOT NEW.updated_at
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow confirm solutions effect is invalid');
END
`;

export const consultingFlowsRequestDocumentEffectTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_request_document_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(id, actor_key, action) AS (
      SELECT command.value,
        json_extract(receipt.value, '$.actorKey'),
        json_extract(receipt.value, '$.action')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), request(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.requests[' ||
          COALESCE(json_array_length(OLD.payload, '$.requests'), 0) || ']'
      )
    )
    SELECT 1 FROM command, request
    WHERE command.action IS 'request_document'
      AND (
        command.actor_key IS NOT 'admin:primary'
        OR json_type(OLD.payload, '$.contract') IS NOT NULL
        OR json_type(request.value) IS NOT 'object'
        OR (SELECT count(*) FROM json_each(request.value)) IS NOT 9
        OR EXISTS (
          SELECT 1 FROM json_each(request.value) AS field
          WHERE field.key NOT IN (
            'id', 'title', 'required', 'channel', 'recipient', 'dueDate',
            'status', 'note', 'createdAt'
          )
        )
        OR json_extract(request.value, '$.id') IS NOT
          (command.id || '-request')
        OR json_type(request.value, '$.title') IS NOT 'text'
        OR length(trim(json_extract(request.value, '$.title'))) = 0
        OR json_extract(request.value, '$.title') IS NOT
          trim(json_extract(request.value, '$.title'))
        OR length(json_extract(request.value, '$.title')) > 150
        OR json_type(request.value, '$.required') NOT IN ('true', 'false')
        OR json_type(request.value, '$.channel') IS NOT 'text'
        OR json_extract(request.value, '$.channel') NOT IN (
          '카카오톡', '이메일', '기타'
        )
        OR json_type(request.value, '$.recipient') IS NOT 'text'
        OR length(trim(json_extract(request.value, '$.recipient'))) = 0
        OR json_extract(request.value, '$.recipient') IS NOT
          trim(json_extract(request.value, '$.recipient'))
        OR length(json_extract(request.value, '$.recipient')) > 100
        OR json_type(request.value, '$.dueDate') IS NOT 'text'
        OR (
          json_extract(request.value, '$.dueDate') <> ''
          AND (
            length(json_extract(request.value, '$.dueDate')) <> 10
            OR substr(json_extract(request.value, '$.dueDate'), 5, 1) <> '-'
            OR substr(json_extract(request.value, '$.dueDate'), 8, 1) <> '-'
            OR strftime(
              '%Y-%m-%d',
              json_extract(request.value, '$.dueDate'),
              '+0 days'
            ) IS NOT json_extract(request.value, '$.dueDate')
          )
        )
        OR json_extract(request.value, '$.status') IS NOT 'requested'
        OR json_extract(request.value, '$.note') IS NOT ''
        OR json_extract(request.value, '$.createdAt') IS NOT NEW.updated_at
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow request document effect is invalid');
END
`;

export const consultingFlowsMarkRequestSentEffectTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_mark_request_sent_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(id, actor_key, action, target_id) AS (
      SELECT command.value,
        json_extract(receipt.value, '$.actorKey'),
        json_extract(receipt.value, '$.action'),
        json_extract(receipt.value, '$.targetId')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), previous_request(key, value) AS (
      SELECT request.key, request.value
      FROM command, json_each(OLD.payload, '$.requests') AS request
      WHERE json_extract(request.value, '$.id') IS command.target_id
    ), current_request(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.requests[' || previous_request.key || ']'
      )
      FROM previous_request
    )
    SELECT 1 FROM command
    WHERE command.action IS 'mark_request_sent'
      AND (
        NOT (
          command.actor_key IS 'admin:primary'
          OR command.actor_key IS
            ('member:' || json_extract(OLD.payload, '$.partnerId'))
        )
        OR typeof(command.target_id) <> 'text'
        OR length(command.target_id) NOT BETWEEN 1 AND 200
        OR (SELECT count(*) FROM previous_request) IS NOT 1
        OR json_array_length(NEW.payload, '$.requests') IS NOT
          json_array_length(OLD.payload, '$.requests')
        OR (
          SELECT count(*)
          FROM json_each(OLD.payload, '$.requests') AS previous
          WHERE previous.value IS NOT json_extract(
            NEW.payload,
            '$.requests[' || previous.key || ']'
          )
        ) IS NOT 1
        OR EXISTS (
          SELECT 1
          FROM json_each(OLD.payload, '$.requests') AS previous
          WHERE previous.value IS NOT json_extract(
            NEW.payload,
            '$.requests[' || previous.key || ']'
          )
            AND json_extract(previous.value, '$.id') IS NOT command.target_id
        )
        OR json_extract(
          (SELECT value FROM current_request), '$.id'
        ) IS NOT command.target_id
        OR json_remove(
          (SELECT value FROM previous_request), '$.sentAt'
        ) IS NOT json_remove(
          (SELECT value FROM current_request), '$.sentAt'
        )
        OR json_extract(
          (SELECT value FROM current_request), '$.sentAt'
        ) IS NOT NEW.updated_at
        OR (
          SELECT count(*)
          FROM json_each(NEW.payload, '$.audit') AS audit
          WHERE json_extract(audit.value, '$.id') IS command.id
            AND json_extract(audit.value, '$.at') IS NEW.updated_at
            AND json_extract(audit.value, '$.action') IS 'mark_request_sent'
            AND json_extract(audit.value, '$.detail') IS (
              json_extract(
                (SELECT value FROM previous_request), '$.channel'
              ) || ' 서류요청 실제 발송 기록'
            )
        ) IS NOT 1
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow mark request sent effect is invalid');
END
`;

export const consultingFlowsReceiveDocumentEffectTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_receive_document_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(id, actor_key, action, target_id) AS (
      SELECT command.value,
        json_extract(receipt.value, '$.actorKey'),
        json_extract(receipt.value, '$.action'),
        json_extract(receipt.value, '$.targetId')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), previous_request(key, value) AS (
      SELECT request.key, request.value
      FROM command, json_each(OLD.payload, '$.requests') AS request
      WHERE json_extract(request.value, '$.id') IS command.target_id
    ), current_request(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.requests[' || previous_request.key || ']'
      )
      FROM previous_request
    ), previous_file(value) AS (
      SELECT file.value
      FROM current_request, json_each(OLD.payload, '$.files') AS file
      WHERE json_extract(file.value, '$.id') IS
        json_extract(current_request.value, '$.fileId')
    ), current_file(value) AS (
      SELECT file.value
      FROM current_request, json_each(NEW.payload, '$.files') AS file
      WHERE json_extract(file.value, '$.id') IS
        json_extract(current_request.value, '$.fileId')
    ), new_file(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.files[' || json_array_length(OLD.payload, '$.files') || ']'
      )
    )
    SELECT 1 FROM command
    WHERE command.action IS 'receive_document'
      AND (
        NOT (
          command.actor_key IS 'admin:primary'
          OR command.actor_key IS
            ('member:' || json_extract(OLD.payload, '$.partnerId'))
        )
        OR typeof(command.target_id) <> 'text'
        OR length(command.target_id) NOT BETWEEN 1 AND 200
        OR json_type(OLD.payload, '$.contract') IS NOT NULL
        OR (SELECT count(*) FROM previous_request) IS NOT 1
        OR json_array_length(NEW.payload, '$.requests') IS NOT
          json_array_length(OLD.payload, '$.requests')
        OR (
          SELECT count(*)
          FROM json_each(OLD.payload, '$.requests') AS previous
          WHERE previous.value IS NOT json_extract(
            NEW.payload,
            '$.requests[' || previous.key || ']'
          )
        ) IS NOT 1
        OR EXISTS (
          SELECT 1
          FROM json_each(OLD.payload, '$.requests') AS previous
          WHERE previous.value IS NOT json_extract(
            NEW.payload,
            '$.requests[' || previous.key || ']'
          )
            AND json_extract(previous.value, '$.id') IS NOT command.target_id
        )
        OR json_extract(
          (SELECT value FROM current_request), '$.id'
        ) IS NOT command.target_id
        OR json_remove(
          (SELECT value FROM previous_request),
          '$.fileId', '$.status', '$.receivedAt', '$.reviewedAt',
          '$.verifiedAt', '$.note'
        ) IS NOT json_remove(
          (SELECT value FROM current_request),
          '$.fileId', '$.status', '$.receivedAt', '$.reviewedAt',
          '$.verifiedAt', '$.note'
        )
        OR json_extract(
          (SELECT value FROM current_request), '$.status'
        ) IS NOT 'received'
        OR json_type(
          (SELECT value FROM current_request), '$.fileId'
        ) IS NOT 'text'
        OR length(json_extract(
          (SELECT value FROM current_request), '$.fileId'
        )) NOT BETWEEN 1 AND 200
        OR json_type(
          (SELECT value FROM current_request), '$.note'
        ) IS NOT 'text'
        OR length(json_extract(
          (SELECT value FROM current_request), '$.note'
        )) > 1000
        OR trim(
          json_extract((SELECT value FROM current_request), '$.note'),
          char(9) || char(10) || char(11) || char(12) || char(13) ||
          char(32) || char(160) || char(5760) || char(8192) || char(8193) ||
          char(8194) || char(8195) || char(8196) || char(8197) || char(8198) ||
          char(8199) || char(8200) || char(8201) || char(8202) || char(8232) ||
          char(8233) || char(8239) || char(8287) || char(12288) || char(65279)
        ) IS NOT json_extract(
          (SELECT value FROM current_request), '$.note'
        )
        OR CASE
          WHEN json_extract(
            (SELECT value FROM previous_request), '$.fileId'
          ) IS NOT json_extract(
            (SELECT value FROM current_request), '$.fileId'
          ) OR json_extract(
            (SELECT value FROM previous_request), '$.status'
          ) IS NOT 'received'
          THEN
            json_extract(
              (SELECT value FROM current_request), '$.receivedAt'
            ) IS NOT NEW.updated_at
            OR json_type(
              (SELECT value FROM current_request), '$.reviewedAt'
            ) IS NOT NULL
            OR json_type(
              (SELECT value FROM current_request), '$.verifiedAt'
            ) IS NOT NULL
          ELSE
            json_extract(
              (SELECT value FROM current_request), '$.receivedAt'
            ) IS NOT json_extract(
              (SELECT value FROM previous_request), '$.receivedAt'
            )
            OR json_extract(
              (SELECT value FROM current_request), '$.reviewedAt'
            ) IS NOT json_extract(
              (SELECT value FROM previous_request), '$.reviewedAt'
            )
            OR json_extract(
              (SELECT value FROM current_request), '$.verifiedAt'
            ) IS NOT json_extract(
              (SELECT value FROM previous_request), '$.verifiedAt'
            )
        END
        OR (SELECT count(*) FROM current_file) IS NOT 1
        OR json_extract(
          (SELECT value FROM current_file), '$.purpose'
        ) IS NOT 'requested_document'
        OR (SELECT count(*) FROM previous_file) NOT IN (0, 1)
        OR CASE
          WHEN (SELECT count(*) FROM previous_file) = 1 THEN
            json_array_length(NEW.payload, '$.files') IS NOT
              json_array_length(OLD.payload, '$.files')
            OR EXISTS (
              SELECT 1
              FROM json_each(OLD.payload, '$.files') AS previous
              WHERE previous.value IS NOT json_extract(
                NEW.payload,
                '$.files[' || previous.key || ']'
              )
            )
          ELSE
            json_array_length(NEW.payload, '$.files') IS NOT
              json_array_length(OLD.payload, '$.files') + 1
            OR EXISTS (
              SELECT 1
              FROM json_each(OLD.payload, '$.files') AS previous
              WHERE previous.value IS NOT json_extract(
                NEW.payload,
                '$.files[' || previous.key || ']'
              )
            )
            OR json_extract(
              (SELECT value FROM new_file), '$.id'
            ) IS NOT json_extract(
              (SELECT value FROM current_request), '$.fileId'
            )
            OR json_extract(
              (SELECT value FROM new_file), '$.purpose'
            ) IS NOT 'requested_document'
            OR json_extract(
              (SELECT value FROM new_file), '$.createdAt'
            ) IS NOT NEW.updated_at
            OR json_type(
              (SELECT value FROM new_file), '$.intakeFileId'
            ) IS NOT NULL
            OR json_type(
              (SELECT value FROM new_file), '$.intakeSourceHash'
            ) IS NOT NULL
            OR json_type(
              (SELECT value FROM new_file), '$.sourceReviewedAt'
            ) IS NOT NULL
            OR json_type(
              (SELECT value FROM new_file), '$.sourceReviewedBy'
            ) IS NOT NULL
        END
        OR (
          SELECT count(*)
          FROM json_each(NEW.payload, '$.audit') AS audit
          WHERE json_extract(audit.value, '$.id') IS command.id
            AND json_extract(audit.value, '$.at') IS NEW.updated_at
            AND json_extract(audit.value, '$.action') IS 'receive_document'
            AND json_extract(audit.value, '$.detail') IS
              '요청 서류 수령 · 대표 검토 대기'
        ) IS NOT 1
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow receive document effect is invalid');
END
`;

export const consultingFlowsReviewDocumentEffectTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_review_document_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(id, actor_key, action, target_id) AS (
      SELECT command.value,
        json_extract(receipt.value, '$.actorKey'),
        json_extract(receipt.value, '$.action'),
        json_extract(receipt.value, '$.targetId')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), previous_request(key, value) AS (
      SELECT request.key, request.value
      FROM command, json_each(OLD.payload, '$.requests') AS request
      WHERE json_extract(request.value, '$.id') IS command.target_id
    ), current_request(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.requests[' || previous_request.key || ']'
      )
      FROM previous_request
    ), received_file(value) AS (
      SELECT file.value
      FROM previous_request, json_each(OLD.payload, '$.files') AS file
      WHERE json_extract(file.value, '$.id') IS
        json_extract(previous_request.value, '$.fileId')
    )
    SELECT 1 FROM command
    WHERE command.action IS 'review_document'
      AND (
        command.actor_key IS NOT 'admin:primary'
        OR typeof(command.target_id) <> 'text'
        OR length(command.target_id) NOT BETWEEN 1 AND 200
        OR json_type(OLD.payload, '$.contract') IS NOT NULL
        OR (SELECT count(*) FROM previous_request) IS NOT 1
        OR json_array_length(NEW.payload, '$.requests') IS NOT
          json_array_length(OLD.payload, '$.requests')
        OR (
          SELECT count(*)
          FROM json_each(OLD.payload, '$.requests') AS previous
          WHERE previous.value IS NOT json_extract(
            NEW.payload,
            '$.requests[' || previous.key || ']'
          )
        ) IS NOT 1
        OR EXISTS (
          SELECT 1
          FROM json_each(OLD.payload, '$.requests') AS previous
          WHERE previous.value IS NOT json_extract(
            NEW.payload,
            '$.requests[' || previous.key || ']'
          )
            AND json_extract(previous.value, '$.id') IS NOT command.target_id
        )
        OR json_extract(
          (SELECT value FROM current_request), '$.id'
        ) IS NOT command.target_id
        OR (
          json_extract(
            (SELECT value FROM previous_request), '$.status'
          ) IS NOT 'received'
          AND json_extract(
            (SELECT value FROM previous_request), '$.status'
          ) IS NOT 'needs_fix'
          AND json_extract(
            (SELECT value FROM previous_request), '$.status'
          ) IS NOT 'verified'
        )
        OR json_type(
          (SELECT value FROM previous_request), '$.fileId'
        ) IS NOT 'text'
        OR length(json_extract(
          (SELECT value FROM previous_request), '$.fileId'
        )) NOT BETWEEN 1 AND 200
        OR json_type(
          (SELECT value FROM previous_request), '$.receivedAt'
        ) IS NOT 'text'
        OR (SELECT count(*) FROM received_file) IS NOT 1
        OR json_extract(
          (SELECT value FROM received_file), '$.purpose'
        ) IS NOT 'requested_document'
        OR json(json_extract(NEW.payload, '$.files')) IS NOT
          json(json_extract(OLD.payload, '$.files'))
        OR json_remove(
          (SELECT value FROM previous_request),
          '$.status', '$.note', '$.reviewedAt', '$.verifiedAt'
        ) IS NOT json_remove(
          (SELECT value FROM current_request),
          '$.status', '$.note', '$.reviewedAt', '$.verifiedAt'
        )
        OR (
          json_extract(
            (SELECT value FROM current_request), '$.status'
          ) IS NOT 'verified'
          AND json_extract(
            (SELECT value FROM current_request), '$.status'
          ) IS NOT 'needs_fix'
        )
        OR json_extract(
          (SELECT value FROM current_request), '$.reviewedAt'
        ) IS NOT NEW.updated_at
        OR CASE
          WHEN json_extract(
            (SELECT value FROM current_request), '$.status'
          ) IS 'verified'
          THEN json_extract(
            (SELECT value FROM current_request), '$.verifiedAt'
          ) IS NOT NEW.updated_at
          ELSE json_type(
            (SELECT value FROM current_request), '$.verifiedAt'
          ) IS NOT NULL
        END
        OR json_type(
          (SELECT value FROM current_request), '$.note'
        ) IS NOT 'text'
        OR length(json_extract(
          (SELECT value FROM current_request), '$.note'
        )) > 1000
        OR trim(
          json_extract((SELECT value FROM current_request), '$.note'),
          char(9) || char(10) || char(11) || char(12) || char(13) ||
          char(32) || char(160) || char(5760) || char(8192) || char(8193) ||
          char(8194) || char(8195) || char(8196) || char(8197) || char(8198) ||
          char(8199) || char(8200) || char(8201) || char(8202) || char(8232) ||
          char(8233) || char(8239) || char(8287) || char(12288) || char(65279)
        ) IS NOT json_extract(
          (SELECT value FROM current_request), '$.note'
        )
        OR (
          json_extract(
            (SELECT value FROM current_request), '$.status'
          ) IS 'needs_fix'
          AND length(json_extract(
            (SELECT value FROM current_request), '$.note'
          )) = 0
        )
        OR (
          SELECT count(*)
          FROM json_each(NEW.payload, '$.audit') AS audit
          WHERE json_extract(audit.value, '$.id') IS command.id
            AND json_extract(audit.value, '$.at') IS NEW.updated_at
            AND json_extract(audit.value, '$.action') IS 'review_document'
            AND json_extract(audit.value, '$.detail') IS (
              CASE json_extract(
                (SELECT value FROM current_request), '$.status'
              )
                WHEN 'verified' THEN '필수 서류 검토 완료'
                ELSE '서류 보완 요청'
              END
            )
        ) IS NOT 1
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow review document effect is invalid');
END
`;

export const consultingFlowsRecordContractEffectTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_record_contract_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(id, actor_key, action, target_id) AS (
      SELECT command.value,
        json_extract(receipt.value, '$.actorKey'),
        json_extract(receipt.value, '$.action'),
        json_extract(receipt.value, '$.targetId')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), previous_meeting(key, value) AS (
      SELECT meeting.key, meeting.value
      FROM command, json_each(OLD.payload, '$.meetings') AS meeting
      WHERE json_extract(meeting.value, '$.id') IS command.target_id
    ), current_meeting(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.meetings[' || previous_meeting.key || ']'
      )
      FROM previous_meeting
    ), latest_report(value) AS (
      SELECT report.value
      FROM json_each(OLD.payload, '$.reports') AS report
      WHERE json_extract(report.value, '$.stage') = 6
      ORDER BY CAST(report.key AS INTEGER) DESC
      LIMIT 1
    )
    SELECT 1 FROM command
    WHERE command.action IS 'record_contract'
      AND (
        typeof(command.target_id) <> 'text'
        OR length(command.target_id) NOT BETWEEN 1 AND 200
        OR json_type(OLD.payload, '$.contract') IS NOT NULL
        OR (SELECT count(*) FROM previous_meeting) IS NOT 1
        OR json_extract(
          (SELECT value FROM previous_meeting), '$.kind'
        ) IS NOT 'contract'
        OR json_extract(
          (SELECT value FROM previous_meeting), '$.status'
        ) NOT IN ('scheduled', 'completed')
        OR json_extract(
          (SELECT value FROM previous_meeting), '$.startsAt'
        ) > NEW.updated_at
        OR NOT (
          command.actor_key IS 'admin:primary'
          OR (
            command.actor_key IS
              ('member:' || json_extract(OLD.payload, '$.partnerId'))
            AND json_extract(
              (SELECT value FROM previous_meeting), '$.attendance'
            ) IN ('both', 'partner')
          )
        )
        OR json_array_length(NEW.payload, '$.meetings') IS NOT
          json_array_length(OLD.payload, '$.meetings')
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.meetings') AS previous
          WHERE json_extract(previous.value, '$.id') IS NOT command.target_id
            AND previous.value IS NOT json_extract(
              NEW.payload, '$.meetings[' || previous.key || ']'
            )
        )
        OR CASE json_extract(
          (SELECT value FROM previous_meeting), '$.status'
        )
          WHEN 'scheduled' THEN json(
            (SELECT value FROM current_meeting)
          ) IS NOT json(json_set(
            (SELECT value FROM previous_meeting),
            '$.status', 'completed', '$.completedAt', NEW.updated_at
          ))
          WHEN 'completed' THEN json(
            (SELECT value FROM current_meeting)
          ) IS NOT json((SELECT value FROM previous_meeting))
          ELSE 1
        END
        OR json_type(OLD.payload, '$.decision') IS NOT 'object'
        OR NOT EXISTS (
          WITH latest_source_report(id) AS (
            SELECT json_extract(report.value, '$.id')
            FROM json_each(OLD.payload, '$.reports') AS report
            WHERE json_extract(report.value, '$.stage') = 1
            ORDER BY CAST(report.key AS INTEGER) DESC
            LIMIT 1
          ), latest_recording(id) AS (
            SELECT json_extract(recording.value, '$.id')
            FROM json_each(OLD.payload, '$.recordings') AS recording
            ORDER BY CAST(recording.key AS INTEGER) DESC
            LIMIT 1
          )
          SELECT 1 FROM json_each(OLD.payload, '$.reports') AS report
          WHERE json_extract(report.value, '$.stage') = 4
            AND json_extract(report.value, '$.id') IS
              json_extract(OLD.payload, '$.decision.reportId')
            AND json_extract(report.value, '$.sourceReportId') IS
              (SELECT id FROM latest_source_report)
            AND json_extract(report.value, '$.sourceRecordingId') IS
              (SELECT id FROM latest_recording)
          ORDER BY CAST(report.key AS INTEGER) DESC
          LIMIT 1
        )
        OR (
          json_extract(OLD.payload, '$.decision.documentsNeeded') IS 1
          AND NOT EXISTS (
            SELECT 1 FROM json_each(OLD.payload, '$.requests') AS request
            WHERE json_extract(request.value, '$.required') IS 1
          )
        )
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.requests') AS request
          WHERE json_extract(request.value, '$.required') IS 1
            AND json_extract(request.value, '$.status') IS NOT 'verified'
        )
        OR NOT EXISTS (
          SELECT 1 FROM (
            SELECT report.value
            FROM json_each(OLD.payload, '$.reports') AS report
            WHERE json_extract(report.value, '$.stage') = 5
            ORDER BY CAST(report.key AS INTEGER) DESC
            LIMIT 1
          ) AS report
          WHERE json_extract(report.value, '$.decisionId') IS
              json_extract(OLD.payload, '$.decision.id')
            AND json_extract(report.value, '$.documentsKey') IS (
              SELECT json_group_array(json_array(
                json_extract(request.value, '$.id'),
                json_extract(request.value, '$.fileId'),
                json_extract(request.value, '$.verifiedAt')
              ))
              FROM json_each(OLD.payload, '$.requests') AS request
              WHERE json_extract(request.value, '$.required') IS 1
            )
        )
        OR NOT EXISTS (
          SELECT 1 FROM latest_report AS report
          WHERE json_extract(report.value, '$.decisionId') IS
              json_extract(OLD.payload, '$.decision.id')
            AND json_extract(report.value, '$.documentsKey') IS (
              SELECT json_group_array(json_array(
                json_extract(request.value, '$.id'),
                json_extract(request.value, '$.fileId'),
                json_extract(request.value, '$.verifiedAt')
              ))
              FROM json_each(OLD.payload, '$.requests') AS request
              WHERE json_extract(request.value, '$.required') IS 1
            )
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow record contract effect is invalid');
END
`;

export const consultingFlowsRecordContractEvidenceTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_record_contract_evidence_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(id, actor_key, action, target_id) AS (
      SELECT command.value,
        json_extract(receipt.value, '$.actorKey'),
        json_extract(receipt.value, '$.action'),
        json_extract(receipt.value, '$.targetId')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), latest_report(value) AS (
      SELECT report.value
      FROM json_each(OLD.payload, '$.reports') AS report
      WHERE json_extract(report.value, '$.stage') = 6
      ORDER BY CAST(report.key AS INTEGER) DESC
      LIMIT 1
    ), new_file(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.files[' || json_array_length(OLD.payload, '$.files') || ']'
      )
    )
    SELECT 1 FROM command
    WHERE command.action IS 'record_contract'
      AND (
        json_type(NEW.payload, '$.contract') IS NOT 'object'
        OR (SELECT count(*) FROM json_each(
          NEW.payload, '$.contract'
        )) IS NOT 6
        OR EXISTS (
          SELECT 1 FROM json_each(NEW.payload, '$.contract') AS field
          WHERE field.key NOT IN (
            'meetingId', 'reportId', 'signedFileId', 'signedAt',
            'expectedDepositWon', 'recordedBy'
          )
        )
        OR json_extract(NEW.payload, '$.contract.meetingId') IS NOT
          command.target_id
        OR json_extract(NEW.payload, '$.contract.reportId') IS NOT
          json_extract((SELECT value FROM latest_report), '$.id')
        OR json_extract(NEW.payload, '$.contract.signedFileId') IS NOT
          json_extract((SELECT value FROM new_file), '$.id')
        OR json_type(NEW.payload, '$.contract.signedAt') IS NOT 'text'
        OR length(json_extract(
          NEW.payload, '$.contract.signedAt'
        )) IS NOT 10
        OR date(
          json_extract(NEW.payload, '$.contract.signedAt'), '+0 days'
        ) IS NOT json_extract(NEW.payload, '$.contract.signedAt')
        OR json_extract(NEW.payload, '$.contract.signedAt') >
          date(NEW.updated_at, '+9 hours')
        OR json_type(
          NEW.payload, '$.contract.expectedDepositWon'
        ) IS NOT 'integer'
        OR json_extract(
          NEW.payload, '$.contract.expectedDepositWon'
        ) NOT BETWEEN 1 AND 1000000000000
        OR json_extract(NEW.payload, '$.contract.recordedBy') IS NOT CASE
          WHEN command.actor_key IS 'admin:primary' THEN '김성민 대표'
          WHEN command.actor_key IS
              ('member:' || json_extract(OLD.payload, '$.partnerId'))
          THEN json_extract(OLD.payload, '$.partnerName')
          ELSE NULL
        END
        OR json_array_length(NEW.payload, '$.files') IS NOT
          json_array_length(OLD.payload, '$.files') + 1
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.files') AS previous
          WHERE previous.value IS NOT json_extract(
            NEW.payload, '$.files[' || previous.key || ']'
          )
        )
        OR json_type((SELECT value FROM new_file)) IS NOT 'object'
        OR (SELECT count(*) FROM json_each(
          (SELECT value FROM new_file)
        )) IS NOT 7
        OR EXISTS (
          SELECT 1 FROM json_each((SELECT value FROM new_file)) AS field
          WHERE field.key NOT IN (
            'id', 'name', 'contentType', 'size', 'key', 'createdAt', 'purpose'
          )
        )
        OR json_extract(
          (SELECT value FROM new_file), '$.purpose'
        ) IS NOT 'signed_contract'
        OR json_extract(
          (SELECT value FROM new_file), '$.createdAt'
        ) IS NOT NEW.updated_at
        OR json_type(
          (SELECT value FROM new_file), '$.intakeFileId'
        ) IS NOT NULL
        OR json_type(
          (SELECT value FROM new_file), '$.intakeSourceHash'
        ) IS NOT NULL
        OR json_type(
          (SELECT value FROM new_file), '$.sourceReviewedAt'
        ) IS NOT NULL
        OR json_type(
          (SELECT value FROM new_file), '$.sourceReviewedBy'
        ) IS NOT NULL
        OR (
          SELECT count(*)
          FROM json_each(NEW.payload, '$.audit') AS audit
          WHERE json_extract(audit.value, '$.id') IS command.id
            AND json_extract(audit.value, '$.at') IS NEW.updated_at
            AND json_extract(audit.value, '$.action') IS 'record_contract'
            AND json_extract(audit.value, '$.detail') IS
              '서명본과 약정 계약금 등록 · 입금 확인 대기'
        ) IS NOT 1
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow record contract effect is invalid');
END
`;

export const consultingFlowsConfirmPaymentEffectTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_confirm_payment_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(id, actor_key, action) AS (
      SELECT command.value,
        json_extract(receipt.value, '$.actorKey'),
        json_extract(receipt.value, '$.action')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), new_payment(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.payments[' || json_array_length(OLD.payload, '$.payments') || ']'
      )
    ), previous_paid(total) AS (
      SELECT COALESCE(SUM(json_extract(payment.value, '$.amountWon')), 0)
      FROM json_each(OLD.payload, '$.payments') AS payment
    )
    SELECT 1 FROM command
    WHERE command.action IS 'confirm_payment'
      AND (
        command.actor_key IS NOT 'admin:primary'
        OR json_type(OLD.payload, '$.contract') IS NOT 'object'
        OR json_array_length(NEW.payload, '$.payments') IS NOT
          json_array_length(OLD.payload, '$.payments') + 1
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.payments') AS previous
          WHERE previous.value IS NOT json_extract(
            NEW.payload, '$.payments[' || previous.key || ']'
          )
        )
        OR json_type((SELECT value FROM new_payment)) IS NOT 'object'
        OR (SELECT count(*) FROM json_each(
          (SELECT value FROM new_payment)
        )) IS NOT 6
        OR EXISTS (
          SELECT 1 FROM json_each((SELECT value FROM new_payment)) AS field
          WHERE field.key NOT IN (
            'id', 'amountWon', 'receivedAt', 'reference', 'confirmedBy',
            'recordedAt'
          )
        )
        OR json_extract(
          (SELECT value FROM new_payment), '$.id'
        ) IS NOT (command.id || '-payment')
        OR json_type(
          (SELECT value FROM new_payment), '$.amountWon'
        ) IS NOT 'integer'
        OR json_extract(
          (SELECT value FROM new_payment), '$.amountWon'
        ) NOT BETWEEN 1 AND 1000000000000
        OR json_type(
          (SELECT value FROM new_payment), '$.receivedAt'
        ) IS NOT 'text'
        OR length(json_extract(
          (SELECT value FROM new_payment), '$.receivedAt'
        )) IS NOT 10
        OR date(json_extract(
          (SELECT value FROM new_payment), '$.receivedAt'
        ), '+0 days') IS NOT json_extract(
          (SELECT value FROM new_payment), '$.receivedAt'
        )
        OR json_extract(
          (SELECT value FROM new_payment), '$.receivedAt'
        ) > date(NEW.updated_at, '+9 hours')
        OR json_type(
          (SELECT value FROM new_payment), '$.reference'
        ) IS NOT 'text'
        OR length(json_extract(
          (SELECT value FROM new_payment), '$.reference'
        )) NOT BETWEEN 1 AND 200
        OR trim(
          json_extract((SELECT value FROM new_payment), '$.reference'),
          char(9) || char(10) || char(11) || char(12) || char(13) ||
          char(32) || char(160) || char(5760) || char(8192) || char(8193) ||
          char(8194) || char(8195) || char(8196) || char(8197) || char(8198) ||
          char(8199) || char(8200) || char(8201) || char(8202) || char(8232) ||
          char(8233) || char(8239) || char(8287) || char(12288) || char(65279)
        ) IS NOT json_extract(
          (SELECT value FROM new_payment), '$.reference'
        )
        OR json_extract(
          (SELECT value FROM new_payment), '$.confirmedBy'
        ) IS NOT '김성민 대표'
        OR json_extract(
          (SELECT value FROM new_payment), '$.recordedAt'
        ) IS NOT NEW.updated_at
        OR CASE
          WHEN json_type(
            OLD.payload, '$.executionStartedAt'
          ) IS 'text' THEN
            json_extract(NEW.payload, '$.executionStartedAt') IS NOT
              json_extract(OLD.payload, '$.executionStartedAt')
          WHEN (
            (SELECT total FROM previous_paid) + json_extract(
              (SELECT value FROM new_payment), '$.amountWon'
            )
          ) >= json_extract(
            OLD.payload, '$.contract.expectedDepositWon'
          ) THEN
            json_extract(NEW.payload, '$.executionStartedAt') IS NOT
              NEW.updated_at
          ELSE json_type(
            NEW.payload, '$.executionStartedAt'
          ) IS NOT NULL
        END
        OR (
          SELECT count(*)
          FROM json_each(NEW.payload, '$.audit') AS audit
          WHERE json_extract(audit.value, '$.id') IS command.id
            AND json_extract(audit.value, '$.at') IS NEW.updated_at
            AND json_extract(audit.value, '$.action') IS 'confirm_payment'
            AND json_extract(audit.value, '$.detail') IS CASE
              WHEN (
                (SELECT total FROM previous_paid) + json_extract(
                  (SELECT value FROM new_payment), '$.amountWon'
                )
              ) >= json_extract(
                OLD.payload, '$.contract.expectedDepositWon'
              ) THEN '약정 계약금 입금 확인 완료 · 컨설팅 수행 시작'
              ELSE '계약금 일부 입금 확인 · 잔액 대기'
            END
        ) IS NOT 1
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow confirm payment effect is invalid');
END
`;

export const consultingFlowsStartAftercareEffectTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_start_aftercare_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(id, actor_key, action) AS (
      SELECT command.value,
        json_extract(receipt.value, '$.actorKey'),
        json_extract(receipt.value, '$.action')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), previous_paid(total) AS (
      SELECT COALESCE(SUM(json_extract(payment.value, '$.amountWon')), 0)
      FROM json_each(OLD.payload, '$.payments') AS payment
    )
    SELECT 1 FROM command
    WHERE command.action IS 'start_aftercare'
      AND (
        command.actor_key IS NOT 'admin:primary'
        OR json_type(OLD.payload, '$.contract') IS NOT 'object'
        OR json_type(OLD.payload, '$.executionStartedAt') IS NOT 'text'
        OR (SELECT total FROM previous_paid) < json_extract(
          OLD.payload, '$.contract.expectedDepositWon'
        )
        OR json_type(NEW.payload, '$.aftercare') IS NOT 'object'
        OR (
          SELECT count(*) FROM json_each(NEW.payload, '$.aftercare')
        ) IS NOT 4
        OR EXISTS (
          SELECT 1 FROM json_each(NEW.payload, '$.aftercare') AS field
          WHERE field.key NOT IN ('at', 'summary', 'nextDate', 'owner')
        )
        OR json_extract(NEW.payload, '$.aftercare.at') IS NOT NEW.updated_at
        OR json_type(NEW.payload, '$.aftercare.summary') IS NOT 'text'
        OR length(
          json_extract(NEW.payload, '$.aftercare.summary')
        ) NOT BETWEEN 1 AND 3000
        OR trim(
          json_extract(NEW.payload, '$.aftercare.summary'),
          char(9) || char(10) || char(11) || char(12) || char(13) ||
          char(32) || char(160) || char(5760) || char(8192) || char(8193) ||
          char(8194) || char(8195) || char(8196) || char(8197) || char(8198) ||
          char(8199) || char(8200) || char(8201) || char(8202) || char(8232) ||
          char(8233) || char(8239) || char(8287) || char(12288) || char(65279)
        ) IS NOT json_extract(NEW.payload, '$.aftercare.summary')
        OR json_type(NEW.payload, '$.aftercare.nextDate') IS NOT 'text'
        OR length(
          json_extract(NEW.payload, '$.aftercare.nextDate')
        ) IS NOT 10
        OR date(
          json_extract(NEW.payload, '$.aftercare.nextDate'), '+0 days'
        ) IS NOT json_extract(NEW.payload, '$.aftercare.nextDate')
        OR json_type(NEW.payload, '$.aftercare.owner') IS NOT 'text'
        OR length(
          json_extract(NEW.payload, '$.aftercare.owner')
        ) NOT BETWEEN 1 AND 100
        OR trim(
          json_extract(NEW.payload, '$.aftercare.owner'),
          char(9) || char(10) || char(11) || char(12) || char(13) ||
          char(32) || char(160) || char(5760) || char(8192) || char(8193) ||
          char(8194) || char(8195) || char(8196) || char(8197) || char(8198) ||
          char(8199) || char(8200) || char(8201) || char(8202) || char(8232) ||
          char(8233) || char(8239) || char(8287) || char(12288) || char(65279)
        ) IS NOT json_extract(NEW.payload, '$.aftercare.owner')
        OR (
          SELECT count(*)
          FROM json_each(NEW.payload, '$.audit') AS audit
          WHERE json_extract(audit.value, '$.id') IS command.id
            AND json_extract(audit.value, '$.at') IS NEW.updated_at
            AND json_extract(audit.value, '$.action') IS 'start_aftercare'
            AND json_extract(audit.value, '$.detail') IS
              '컨설팅 수행 결과 확인 · 사후관리 일정 등록'
        ) IS NOT 1
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow start aftercare effect is invalid');
END
`;

export const consultingFlowsSaveSourceEffectTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_save_source_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(action) AS (
      SELECT json_extract(receipt.value, '$.action')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), new_file(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.files[' || json_array_length(OLD.payload, '$.files') || ']'
      )
    )
    SELECT 1
    FROM command
    CROSS JOIN new_file
    WHERE command.action IS 'save_source'
      AND (
        json_array_length(NEW.payload, '$.files') NOT IN (
          json_array_length(OLD.payload, '$.files'),
          json_array_length(OLD.payload, '$.files') + 1
        )
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.files') AS previous
          WHERE json(json_extract(
              NEW.payload,
              '$.files[' || previous.key || ']'
            )) IS NOT json(previous.value)
        )
        OR (
          json_array_length(NEW.payload, '$.files') =
            json_array_length(OLD.payload, '$.files') + 1
          AND (
            json_extract(new_file.value, '$.purpose') IS NOT 'source'
            OR json_extract(new_file.value, '$.createdAt') IS NOT NEW.updated_at
            OR json_type(new_file.value, '$.intakeFileId') IS NOT NULL
          )
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow save source effect is invalid');
END
`;

export const consultingFlowsImportIntakeSourceEffectTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_import_intake_source_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(action) AS (
      SELECT json_extract(receipt.value, '$.action')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), new_file(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.files[' || json_array_length(OLD.payload, '$.files') || ']'
      )
    )
    SELECT 1
    FROM command
    CROSS JOIN new_file
    WHERE command.action IS 'import_intake_source'
      AND (
        json_array_length(NEW.payload, '$.files') IS NOT
          json_array_length(OLD.payload, '$.files') + 1
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.files') AS previous
          WHERE json(json_extract(
              NEW.payload,
              '$.files[' || previous.key || ']'
            )) IS NOT json(previous.value)
        )
        OR json_extract(new_file.value, '$.purpose') IS NOT 'source'
        OR json_extract(new_file.value, '$.createdAt') IS NOT NEW.updated_at
        OR json_type(new_file.value, '$.intakeFileId') IS NOT 'text'
        OR trim(json_extract(new_file.value, '$.intakeFileId')) = ''
        OR json_type(new_file.value, '$.intakeSourceHash') IS NOT 'text'
        OR length(json_extract(new_file.value, '$.intakeSourceHash')) <> 64
        OR json_extract(new_file.value, '$.intakeSourceHash') GLOB '*[^0-9a-f]*'
        OR json_extract(new_file.value, '$.sourceReviewedAt') IS NOT NEW.updated_at
        OR json_type(new_file.value, '$.sourceReviewedBy') IS NOT 'text'
        OR trim(json_extract(new_file.value, '$.sourceReviewedBy')) = ''
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow intake source effect is invalid');
END
`;

export const consultingFlowsExcludeSourceEffectTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_exclude_source_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(action) AS (
      SELECT json_extract(receipt.value, '$.action')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), compared(previous, current) AS (
      SELECT previous.value, json_extract(
        NEW.payload,
        '$.files[' || previous.key || ']'
      )
      FROM json_each(OLD.payload, '$.files') AS previous
    )
    SELECT 1
    FROM command
    WHERE command.action IS 'exclude_source'
      AND (
        json_array_length(NEW.payload, '$.files') IS NOT
          json_array_length(OLD.payload, '$.files')
        OR (SELECT count(*) FROM compared
          WHERE json(current) IS NOT json(previous)) IS NOT 1
        OR EXISTS (
          SELECT 1 FROM compared
          WHERE json(current) IS NOT json(previous)
            AND (
              json_extract(previous, '$.purpose') IS NOT 'source'
              OR json(current) IS NOT json(json_set(
                json(previous), '$.purpose', 'source_archived'
              ))
            )
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow exclude source effect is invalid');
END
`;

export const consultingFlowsSaveRecordingEffectTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_save_recording_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(id, action) AS (
      SELECT command.value, json_extract(receipt.value, '$.action')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), recording(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.recordings[' ||
          json_array_length(OLD.payload, '$.recordings') || ']'
      )
    ), new_job(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.jobs[' || json_array_length(OLD.payload, '$.jobs') || ']'
      )
    ), expected(reason) AS (
      SELECT CASE
        WHEN COALESCE(json_extract(recording.value, '$.transcript'), '') = ''
        THEN '전사문 대기: Word·TXT를 첨부하거나 본문을 입력해 주세요. 음성은 보관만 하며 자동전사는 미연결입니다.'
        WHEN json_extract(NEW.payload, '$.ai.enabled') IS 0
        THEN '김성민 대표의 외부 AI 자동생성 승인이 필요합니다.'
        ELSE ''
      END
      FROM recording
    )
    SELECT 1
    FROM command
    CROSS JOIN recording
    CROSS JOIN new_job
    CROSS JOIN expected
    WHERE command.action IS 'save_recording'
      AND (
        json_array_length(NEW.payload, '$.recordings') IS NOT
          json_array_length(OLD.payload, '$.recordings') + 1
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.recordings') AS previous
          WHERE json(json_extract(
              NEW.payload,
              '$.recordings[' || previous.key || ']'
            )) IS NOT json(previous.value)
        )
        OR json_extract(recording.value, '$.id') IS NOT
          (command.id || '-recording')
        OR json_extract(recording.value, '$.createdAt') IS NOT NEW.updated_at
        OR json_extract(recording.value, '$.consentAt') IS NOT NEW.updated_at
        OR json_extract(recording.value, '$.transcript') IS NOT
          trim(json_extract(recording.value, '$.transcript'))
        OR NOT EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.meetings') AS meeting
          WHERE json_extract(meeting.value, '$.id') IS
              json_extract(recording.value, '$.meetingId')
            AND json_extract(meeting.value, '$.status') IS 'completed'
        )
        OR CASE
          WHEN COALESCE(json_extract(recording.value, '$.transcript'), '') <> ''
          THEN json_extract(recording.value, '$.transcriptReviewedAt') IS NOT
              NEW.updated_at
            OR COALESCE(
              trim(json_extract(recording.value, '$.transcriptReviewedBy')),
              ''
            ) = ''
          ELSE json_type(recording.value, '$.transcriptReviewedAt') IS NOT NULL
            OR json_type(recording.value, '$.transcriptReviewedBy') IS NOT NULL
        END
        OR json_array_length(NEW.payload, '$.files') IS NOT
          json_array_length(OLD.payload, '$.files') +
          CASE WHEN json_type(recording.value, '$.fileId') = 'text'
            THEN 1 ELSE 0 END +
          CASE WHEN json_type(recording.value, '$.audioFileId') = 'text'
              AND json_extract(recording.value, '$.audioFileId') IS NOT
                json_extract(recording.value, '$.fileId')
            THEN 1 ELSE 0 END
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.files') AS previous
          WHERE json(json_extract(
              NEW.payload,
              '$.files[' || previous.key || ']'
            )) IS NOT json(previous.value)
        )
        OR EXISTS (
          SELECT 1 FROM json_each(NEW.payload, '$.files') AS file
          WHERE CAST(file.key AS INTEGER) >=
              json_array_length(OLD.payload, '$.files')
            AND (
              json_extract(file.value, '$.purpose') IS NOT 'recording'
              OR json_extract(file.value, '$.createdAt') IS NOT NEW.updated_at
              OR (
                json_extract(file.value, '$.id') IS NOT
                  json_extract(recording.value, '$.fileId')
                AND json_extract(file.value, '$.id') IS NOT
                  json_extract(recording.value, '$.audioFileId')
              )
            )
        )
        OR (
          json_type(recording.value, '$.fileId') = 'text'
          AND json_extract(
            NEW.payload,
            '$.files[' || json_array_length(OLD.payload, '$.files') || '].id'
          ) IS NOT json_extract(recording.value, '$.fileId')
        )
        OR (
          json_type(recording.value, '$.audioFileId') = 'text'
          AND json_extract(recording.value, '$.audioFileId') IS NOT
            json_extract(recording.value, '$.fileId')
          AND json_extract(
            NEW.payload,
            '$.files[' ||
              (json_array_length(OLD.payload, '$.files') +
                CASE WHEN json_type(recording.value, '$.fileId') = 'text'
                  THEN 1 ELSE 0 END) || '].id'
          ) IS NOT json_extract(recording.value, '$.audioFileId')
        )
        OR (
          json_type(recording.value, '$.fileId') = 'text'
          AND (
            lower(json_extract(
              NEW.payload,
              '$.files[' || json_array_length(OLD.payload, '$.files') || '].name'
            )) GLOB '*.docx'
            OR lower(json_extract(
              NEW.payload,
              '$.files[' || json_array_length(OLD.payload, '$.files') || '].name'
            )) GLOB '*.txt'
          )
          AND json_extract(recording.value, '$.transcriptFileId') IS NOT
            json_extract(recording.value, '$.fileId')
        )
        OR (
          (
            json_type(recording.value, '$.fileId') IS NOT 'text'
            OR NOT (
              lower(json_extract(
                NEW.payload,
                '$.files[' || json_array_length(OLD.payload, '$.files') || '].name'
              )) GLOB '*.docx'
              OR lower(json_extract(
                NEW.payload,
                '$.files[' || json_array_length(OLD.payload, '$.files') || '].name'
              )) GLOB '*.txt'
            )
          )
          AND json_type(recording.value, '$.transcriptFileId') IS NOT NULL
        )
        OR (
          json_type(recording.value, '$.fileId') = 'text'
          AND (
            lower(json_extract(
              NEW.payload,
              '$.files[' || json_array_length(OLD.payload, '$.files') || '].name'
            )) GLOB '*.mp3'
            OR lower(json_extract(
              NEW.payload,
              '$.files[' || json_array_length(OLD.payload, '$.files') || '].name'
            )) GLOB '*.m4a'
            OR lower(json_extract(
              NEW.payload,
              '$.files[' || json_array_length(OLD.payload, '$.files') || '].name'
            )) GLOB '*.wav'
          )
          AND json_extract(recording.value, '$.audioFileId') IS NOT
            json_extract(recording.value, '$.fileId')
        )
        OR (
          json_type(recording.value, '$.fileId') = 'text'
          AND NOT (
            lower(json_extract(
              NEW.payload,
              '$.files[' || json_array_length(OLD.payload, '$.files') || '].name'
            )) GLOB '*.mp3'
            OR lower(json_extract(
              NEW.payload,
              '$.files[' || json_array_length(OLD.payload, '$.files') || '].name'
            )) GLOB '*.m4a'
            OR lower(json_extract(
              NEW.payload,
              '$.files[' || json_array_length(OLD.payload, '$.files') || '].name'
            )) GLOB '*.wav'
          )
          AND json_extract(recording.value, '$.audioFileId') IS
            json_extract(recording.value, '$.fileId')
        )
        OR (
          json_type(recording.value, '$.audioFileId') = 'text'
          AND NOT EXISTS (
            SELECT 1 FROM json_each(NEW.payload, '$.files') AS audio
            WHERE CAST(audio.key AS INTEGER) >=
                json_array_length(OLD.payload, '$.files')
              AND json_extract(audio.value, '$.id') IS
                json_extract(recording.value, '$.audioFileId')
              AND (
                lower(json_extract(audio.value, '$.name')) GLOB '*.mp3'
                OR lower(json_extract(audio.value, '$.name')) GLOB '*.m4a'
                OR lower(json_extract(audio.value, '$.name')) GLOB '*.wav'
              )
          )
        )
        OR json_array_length(NEW.payload, '$.jobs') IS NOT
          json_array_length(OLD.payload, '$.jobs') + 1
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
          WHERE json(json_extract(
              NEW.payload,
              '$.jobs[' || previous.key || ']'
            )) IS NOT json(previous.value)
        )
        OR json(new_job.value) IS NOT json(json_object(
          'id', command.id || '-job',
          'stage', 4,
          'sourceRecordingId', command.id || '-recording',
          'sourceReportId', (
            SELECT json_extract(report.value, '$.id')
            FROM json_each(NEW.payload, '$.reports') AS report
            WHERE json_extract(report.value, '$.stage') = 1
            ORDER BY CAST(report.key AS INTEGER) DESC
            LIMIT 1
          ),
          'status', CASE WHEN expected.reason = '' THEN 'queued' ELSE 'blocked' END,
          'reason', expected.reason,
          'createdAt', NEW.updated_at
        ))
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow save recording effect is invalid');
END
`;

export const consultingFlowsSaveTranscriptJobsTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_save_transcript_jobs_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(action) AS (
      SELECT json_extract(receipt.value, '$.action')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    )
    SELECT 1 FROM command
    WHERE command.action IS 'save_transcript'
      AND (
        json_array_length(NEW.payload, '$.jobs') IS NOT
          json_array_length(OLD.payload, '$.jobs')
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
          WHERE json(json_extract(
              NEW.payload,
              '$.jobs[' || previous.key || ']'
            )) IS NOT json(
              CASE
                WHEN previous.key IS (
                    SELECT target.key
                    FROM json_each(OLD.payload, '$.jobs') AS target
                    WHERE json_type(target.value, '$.sourceRecordingId') = 'text'
                      AND json_extract(target.value, '$.sourceRecordingId') IS (
                        SELECT json_extract(recording.value, '$.id')
                        FROM json_each(NEW.payload, '$.recordings') AS recording
                        ORDER BY CAST(recording.key AS INTEGER) DESC
                        LIMIT 1
                      )
                    ORDER BY CAST(target.key AS INTEGER) DESC
                    LIMIT 1
                  )
                  AND NOT (
                    json_extract(previous.value, '$.status') IS 'failed'
                    AND json_extract(NEW.payload, '$.ai.enabled') IS 0
                  )
                THEN json_set(
                  json_remove(
                    CASE
                      WHEN json_type(previous.value, '$.failureEvidence') = 'object'
                      THEN json_set(
                        previous.value,
                        '$.failureEvidenceHistory',
                        json_insert(
                          COALESCE(
                            json(json_extract(
                              previous.value,
                              '$.failureEvidenceHistory'
                            )),
                            json('[]')
                          ),
                          '$[#]',
                          json(json_extract(previous.value, '$.failureEvidence'))
                        )
                      )
                      ELSE previous.value
                    END,
                    '$.failureEvidence',
                    '$.startedAt'
                  ),
                  '$.status',
                    CASE WHEN json_extract(NEW.payload, '$.ai.enabled') IS 1
                      THEN 'queued' ELSE 'blocked' END,
                  '$.reason',
                    CASE WHEN json_extract(NEW.payload, '$.ai.enabled') IS 1
                      THEN '' ELSE '대표의 AI 자동생성 승인이 필요합니다.' END
                )
                ELSE previous.value
              END
            )
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow save transcript jobs are invalid');
END
`;

export const consultingFlowsRetryJobEffectTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_retry_job_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(action) AS (
      SELECT json_extract(receipt.value, '$.action')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    )
    SELECT 1 FROM command
    WHERE command.action IS 'retry_job'
      AND (
        json_array_length(NEW.payload, '$.jobs') IS NOT
          json_array_length(OLD.payload, '$.jobs')
        OR (SELECT count(*)
          FROM json_each(OLD.payload, '$.jobs') AS previous
          WHERE json_extract(previous.value, '$.status') IN (
              'blocked', 'failed', 'processing'
            )
            AND json(json_extract(
                NEW.payload,
                '$.jobs[' || previous.key || ']'
              )) IS json(
                json_set(
                  json_remove(
                    CASE
                      WHEN json_type(previous.value, '$.failureEvidence') = 'object'
                      THEN json_set(
                        previous.value,
                        '$.failureEvidenceHistory',
                        json_insert(
                          COALESCE(
                            json(json_extract(
                              previous.value,
                              '$.failureEvidenceHistory'
                            )),
                            json('[]')
                          ),
                          '$[#]',
                          json(json_extract(previous.value, '$.failureEvidence'))
                        )
                      )
                      ELSE previous.value
                    END,
                    '$.failureEvidence',
                    '$.startedAt'
                  ),
                  '$.status', 'queued',
                  '$.reason', ''
                )
              )) IS NOT 1
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
          WHERE json(json_extract(
              NEW.payload,
              '$.jobs[' || previous.key || ']'
            )) IS NOT json(previous.value)
            AND NOT (
              json_extract(previous.value, '$.status') IN (
                'blocked', 'failed', 'processing'
              )
              AND json(json_extract(
                  NEW.payload,
                  '$.jobs[' || previous.key || ']'
                )) IS json(
                  json_set(
                    json_remove(
                      CASE
                        WHEN json_type(previous.value, '$.failureEvidence') = 'object'
                        THEN json_set(
                          previous.value,
                          '$.failureEvidenceHistory',
                          json_insert(
                            COALESCE(
                              json(json_extract(
                                previous.value,
                                '$.failureEvidenceHistory'
                              )),
                              json('[]')
                            ),
                            '$[#]',
                            json(json_extract(previous.value, '$.failureEvidence'))
                          )
                        )
                        ELSE previous.value
                      END,
                      '$.failureEvidence',
                      '$.startedAt'
                    ),
                    '$.status', 'queued',
                    '$.reason', ''
                  )
                )
            )
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow retry job effect is invalid');
END
`;

export const consultingFlowsJobsTransitionTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_jobs_transition_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
  WHERE NOT EXISTS (
    SELECT 1 FROM json_each(NEW.payload, '$.jobs') AS next
    WHERE json_extract(next.value, '$.id') IS json_extract(previous.value, '$.id')
  )
) OR EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.jobs') AS next
  WHERE NOT EXISTS (
    SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
    WHERE json_extract(previous.value, '$.id') IS json_extract(next.value, '$.id')
  ) AND (
    COALESCE(json_extract(next.value, '$.status'), '') NOT IN ('queued', 'blocked')
    OR json_type(next.value, '$.startedAt') IS NOT NULL
    OR json_type(next.value, '$.completedAt') IS NOT NULL
    OR json_type(next.value, '$.reportId') IS NOT NULL
    OR json_type(next.value, '$.evidence') IS NOT NULL
    OR json_type(next.value, '$.failureEvidence') IS NOT NULL
    OR json_type(next.value, '$.failureEvidenceHistory') IS NOT NULL
  )
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow job transition is invalid');
END
`;

export const consultingFlowsSuccessEvidenceTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_success_evidence_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1
  FROM json_each(OLD.payload, '$.jobs') AS previous
  JOIN json_each(NEW.payload, '$.jobs') AS next
    ON json_extract(next.value, '$.id') IS json_extract(previous.value, '$.id')
  WHERE (
    json_type(previous.value, '$.evidence') = 'object'
    AND (
      json_type(next.value, '$.evidence') IS NOT 'object'
      OR json_extract(next.value, '$.evidence') IS NOT json_extract(previous.value, '$.evidence')
    )
  ) OR (
    json_type(previous.value, '$.evidence') IS NULL
    AND json_type(next.value, '$.evidence') = 'object'
    AND NOT (
      json_extract(previous.value, '$.status') = 'processing'
      AND json_extract(next.value, '$.status') = 'complete'
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow success evidence transition is invalid');
END
`;

export const consultingFlowsFailureHistoryTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_failure_history_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1
  FROM json_each(OLD.payload, '$.jobs') AS previous_job
  JOIN json_each(NEW.payload, '$.jobs') AS next_job
    ON json_extract(next_job.value, '$.id') IS json_extract(previous_job.value, '$.id')
  WHERE EXISTS (
    SELECT 1
    FROM json_each(previous_job.value, '$.failureEvidenceHistory') AS previous
    LEFT JOIN json_each(next_job.value, '$.failureEvidenceHistory') AS next
      ON next.key = previous.key
    WHERE next.key IS NULL OR json(next.value) IS NOT json(previous.value)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow failure history is immutable');
END
`;

export const consultingFlowsFailureEvidenceTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_failure_evidence_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1
  FROM json_each(OLD.payload, '$.jobs') AS previous
  JOIN json_each(NEW.payload, '$.jobs') AS next
    ON json_extract(next.value, '$.id') IS json_extract(previous.value, '$.id')
  WHERE CASE
    WHEN json_type(previous.value, '$.failureEvidence') = 'object' THEN NOT (
      (
        json_type(next.value, '$.failureEvidence') = 'object'
        AND json_extract(next.value, '$.failureEvidence') IS json_extract(previous.value, '$.failureEvidence')
        AND COALESCE(json_array_length(next.value, '$.failureEvidenceHistory'), 0)
          = COALESCE(json_array_length(previous.value, '$.failureEvidenceHistory'), 0)
      ) OR (
        json_type(next.value, '$.failureEvidence') IS NULL
        AND COALESCE(json_array_length(next.value, '$.failureEvidenceHistory'), 0)
          = COALESCE(json_array_length(previous.value, '$.failureEvidenceHistory'), 0) + 1
        AND json_extract(
          next.value,
          '$.failureEvidenceHistory[' || COALESCE(json_array_length(previous.value, '$.failureEvidenceHistory'), 0) || ']'
        ) IS json_extract(previous.value, '$.failureEvidence')
      )
    )
    ELSE
      COALESCE(json_array_length(next.value, '$.failureEvidenceHistory'), 0)
        <> COALESCE(json_array_length(previous.value, '$.failureEvidenceHistory'), 0)
      OR (
        json_type(next.value, '$.failureEvidence') = 'object'
        AND NOT (
          json_extract(previous.value, '$.status') = 'processing'
          AND json_extract(next.value, '$.status') = 'failed'
        )
      )
  END
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow failure evidence transition is invalid');
END
`;

export const consultingFlowsJobIdentityTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_job_identity_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1
  FROM json_each(OLD.payload, '$.jobs') AS previous
  JOIN json_each(NEW.payload, '$.jobs') AS next
    ON json_extract(next.value, '$.id') IS json_extract(previous.value, '$.id')
  WHERE json_extract(next.value, '$.stage') IS NOT json_extract(previous.value, '$.stage')
    OR json_extract(next.value, '$.sourceRecordingId') IS NOT json_extract(previous.value, '$.sourceRecordingId')
    OR json_extract(next.value, '$.sourceReportId') IS NOT json_extract(previous.value, '$.sourceReportId')
    OR json_extract(next.value, '$.createdAt') IS NOT json_extract(previous.value, '$.createdAt')
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow job identity is immutable');
END
`;

export const consultingFlowsJobStatusTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_job_status_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1
  FROM json_each(OLD.payload, '$.jobs') AS previous
  JOIN json_each(NEW.payload, '$.jobs') AS next
    ON json_extract(next.value, '$.id') IS json_extract(previous.value, '$.id')
  WHERE NOT (
    json_extract(next.value, '$.status') IS json_extract(previous.value, '$.status')
    OR (json_extract(previous.value, '$.status') = 'queued' AND json_extract(next.value, '$.status') IN ('processing', 'blocked'))
    OR (json_extract(previous.value, '$.status') IN ('blocked', 'failed') AND json_extract(next.value, '$.status') = 'queued')
    OR (json_extract(previous.value, '$.status') = 'processing' AND json_extract(next.value, '$.status') IN ('queued', 'blocked', 'failed', 'complete'))
  )
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow job status transition is invalid');
END
`;

export const consultingFlowsJobLifecycleTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_job_lifecycle_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1
  FROM json_each(OLD.payload, '$.jobs') AS previous
  JOIN json_each(NEW.payload, '$.jobs') AS next
    ON json_extract(next.value, '$.id') IS json_extract(previous.value, '$.id')
  WHERE NOT CASE
    WHEN json_extract(previous.value, '$.status') IS json_extract(next.value, '$.status') THEN
      CASE WHEN json_extract(previous.value, '$.status') = 'blocked' THEN
        (json_extract(next.value, '$.startedAt') IS json_extract(previous.value, '$.startedAt') OR json_type(next.value, '$.startedAt') IS NULL)
        AND json_type(next.value, '$.completedAt') IS NULL
        AND json_type(next.value, '$.reportId') IS NULL
        AND json_type(next.value, '$.evidence') IS NULL
        AND json_type(next.value, '$.failureEvidence') IS NULL
      ELSE
        json_extract(next.value, '$.reason') IS json_extract(previous.value, '$.reason')
        AND json_extract(next.value, '$.startedAt') IS json_extract(previous.value, '$.startedAt')
        AND json_extract(next.value, '$.completedAt') IS json_extract(previous.value, '$.completedAt')
        AND json_extract(next.value, '$.reportId') IS json_extract(previous.value, '$.reportId')
        AND json_extract(next.value, '$.evidence') IS json_extract(previous.value, '$.evidence')
        AND json_extract(next.value, '$.failureEvidence') IS json_extract(previous.value, '$.failureEvidence')
      END
    WHEN json_extract(previous.value, '$.status') = 'queued' AND json_extract(next.value, '$.status') = 'processing' THEN
      json_extract(next.value, '$.reason') = ''
      AND json_type(next.value, '$.startedAt') = 'text'
      AND json_type(next.value, '$.completedAt') IS NULL
      AND json_type(next.value, '$.reportId') IS NULL
      AND json_type(next.value, '$.evidence') IS NULL
      AND json_type(next.value, '$.failureEvidence') IS NULL
    WHEN json_extract(previous.value, '$.status') = 'queued' AND json_extract(next.value, '$.status') = 'blocked' THEN
      COALESCE(json_extract(next.value, '$.reason'), '') <> ''
      AND json_type(next.value, '$.startedAt') IS NULL
      AND json_type(next.value, '$.completedAt') IS NULL
      AND json_type(next.value, '$.reportId') IS NULL
      AND json_type(next.value, '$.evidence') IS NULL
      AND json_type(next.value, '$.failureEvidence') IS NULL
    WHEN json_extract(previous.value, '$.status') IN ('blocked', 'failed', 'processing') AND json_extract(next.value, '$.status') = 'queued' THEN
      json_extract(next.value, '$.reason') = ''
      AND json_type(next.value, '$.startedAt') IS NULL
      AND json_type(next.value, '$.completedAt') IS NULL
      AND json_type(next.value, '$.reportId') IS NULL
      AND json_type(next.value, '$.evidence') IS NULL
      AND json_type(next.value, '$.failureEvidence') IS NULL
    WHEN json_extract(previous.value, '$.status') = 'processing' AND json_extract(next.value, '$.status') = 'blocked' THEN
      COALESCE(json_extract(next.value, '$.reason'), '') <> ''
      AND json_extract(next.value, '$.startedAt') IS json_extract(previous.value, '$.startedAt')
      AND json_type(next.value, '$.completedAt') IS NULL
      AND json_type(next.value, '$.reportId') IS NULL
      AND json_type(next.value, '$.evidence') IS NULL
      AND json_type(next.value, '$.failureEvidence') IS NULL
    WHEN json_extract(previous.value, '$.status') = 'processing' AND json_extract(next.value, '$.status') = 'failed' THEN
      COALESCE(json_extract(next.value, '$.reason'), '') <> ''
      AND json_extract(next.value, '$.startedAt') IS json_extract(previous.value, '$.startedAt')
      AND json_type(next.value, '$.completedAt') IS NULL
      AND json_type(next.value, '$.reportId') IS NULL
      AND json_type(next.value, '$.evidence') IS NULL
    WHEN json_extract(previous.value, '$.status') = 'processing' AND json_extract(next.value, '$.status') = 'complete' THEN
      json_extract(next.value, '$.reason') = ''
      AND json_extract(next.value, '$.startedAt') IS json_extract(previous.value, '$.startedAt')
      AND json_type(next.value, '$.completedAt') = 'text'
      AND json_type(next.value, '$.reportId') = 'text'
      AND json_type(next.value, '$.evidence') = 'object'
      AND json_type(next.value, '$.failureEvidence') IS NULL
    ELSE 0
  END
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow job lifecycle transition is invalid');
END
`;

export const consultingFlowsJobTransitionTimestampTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_job_transition_timestamp_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1
  FROM json_each(OLD.payload, '$.jobs') AS previous
  JOIN json_each(NEW.payload, '$.jobs') AS next
    ON json_extract(next.value, '$.id') IS json_extract(previous.value, '$.id')
  WHERE (json_extract(previous.value, '$.status') = 'queued'
      AND json_extract(next.value, '$.status') = 'processing'
      AND json_extract(next.value, '$.startedAt') IS NOT NEW.updated_at)
    OR (json_extract(previous.value, '$.status') = 'processing'
      AND json_extract(next.value, '$.status') = 'complete'
      AND json_extract(next.value, '$.completedAt') IS NOT NEW.updated_at)
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow job transition timestamp is invalid');
END
`;

export const consultingFlowsJobTransitionAuditTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_job_transition_audit_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1
  FROM json_each(OLD.payload, '$.jobs') AS previous
  JOIN json_each(NEW.payload, '$.jobs') AS next
    ON json_extract(next.value, '$.id') IS json_extract(previous.value, '$.id')
  WHERE (json_extract(previous.value, '$.status') = 'processing'
      AND json_extract(next.value, '$.status') IN ('blocked', 'failed', 'complete')
      AND (SELECT count(*) FROM json_each(NEW.payload, '$.audit') AS audit
        WHERE audit.key >= json_array_length(OLD.payload, '$.audit')
          AND json_extract(audit.value, '$.id') = json_extract(next.value, '$.id') || '-' || NEW.updated_at
          AND json_extract(audit.value, '$.at') = NEW.updated_at
          AND json_extract(audit.value, '$.actor') = '보고서 자동생성'
          AND json_extract(audit.value, '$.action') = 'ai_result') <> 1)
    OR (json_extract(previous.value, '$.status') IN ('blocked', 'failed', 'processing')
      AND json_extract(next.value, '$.status') = 'queued'
      AND (SELECT count(*) FROM json_each(OLD.payload, '$.jobs') AS retry_previous
        JOIN json_each(NEW.payload, '$.jobs') AS retry_next
          ON json_extract(retry_next.value, '$.id') IS json_extract(retry_previous.value, '$.id')
        WHERE json_extract(retry_previous.value, '$.status') IN ('blocked', 'failed', 'processing')
          AND json_extract(retry_next.value, '$.status') = 'queued') IS NOT
        (SELECT count(*) FROM json_each(NEW.payload, '$.audit') AS audit
          WHERE audit.key >= json_array_length(OLD.payload, '$.audit')
            AND json_extract(audit.value, '$.at') = NEW.updated_at
            AND json_extract(audit.value, '$.action') IN ('retry_job', 'save_transcript')))
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow job transition audit is invalid');
END
`;

export const consultingFlowsJobInsertOriginTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_job_insert_origin_guard
BEFORE INSERT ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.jobs') AS job
  WHERE json_extract(job.value, '$.createdAt') IS NOT NEW.updated_at
    OR (json_extract(job.value, '$.stage') = 1 AND
      (json_type(job.value, '$.sourceRecordingId') IS NOT NULL OR
        json_type(job.value, '$.sourceReportId') IS NOT NULL))
    OR (json_extract(job.value, '$.stage') = 4 AND
      (COALESCE(json_type(job.value, '$.sourceRecordingId'), '') <> 'text' OR
        json_extract(job.value, '$.sourceRecordingId') IS NOT
          (SELECT json_extract(recording.value, '$.id')
          FROM json_each(NEW.payload, '$.recordings') AS recording
          ORDER BY CAST(recording.key AS INTEGER) DESC LIMIT 1) OR
        COALESCE(json_type(job.value, '$.sourceReportId'), '') <> 'text' OR
        json_extract(job.value, '$.sourceReportId') IS NOT
          (SELECT json_extract(report.value, '$.id')
          FROM json_each(NEW.payload, '$.reports') AS report
          WHERE json_extract(report.value, '$.stage') = 1
          ORDER BY CAST(report.key AS INTEGER) DESC LIMIT 1)))
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial job origin is invalid');
END
`;

export const consultingFlowsJobCreationOriginTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_job_creation_origin_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.jobs') AS job
  WHERE NOT EXISTS (
    SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
    WHERE json_extract(previous.value, '$.id') IS json_extract(job.value, '$.id')
  ) AND (
    json_extract(job.value, '$.createdAt') IS NOT NEW.updated_at
    OR (json_extract(job.value, '$.stage') = 1 AND
      (json_type(job.value, '$.sourceRecordingId') IS NOT NULL OR
        json_type(job.value, '$.sourceReportId') IS NOT NULL))
    OR (json_extract(job.value, '$.stage') = 4 AND
      (COALESCE(json_type(job.value, '$.sourceRecordingId'), '') <> 'text' OR
        json_extract(job.value, '$.sourceRecordingId') IS NOT
          (SELECT json_extract(recording.value, '$.id')
          FROM json_each(NEW.payload, '$.recordings') AS recording
          ORDER BY CAST(recording.key AS INTEGER) DESC LIMIT 1) OR
        COALESCE(json_type(job.value, '$.sourceReportId'), '') <> 'text' OR
        json_extract(job.value, '$.sourceReportId') IS NOT
          (SELECT json_extract(report.value, '$.id')
          FROM json_each(NEW.payload, '$.reports') AS report
          WHERE json_extract(report.value, '$.stage') = 1
          ORDER BY CAST(report.key AS INTEGER) DESC LIMIT 1)))
    OR (SELECT count(*) FROM json_each(NEW.payload, '$.jobs') AS added
      WHERE NOT EXISTS (
        SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
        WHERE json_extract(previous.value, '$.id') IS json_extract(added.value, '$.id')
      ) AND json_extract(added.value, '$.stage') = 1) IS NOT
      (SELECT count(*) FROM json_each(NEW.payload, '$.audit') AS audit
      WHERE audit.key >= json_array_length(OLD.payload, '$.audit')
        AND json_extract(audit.value, '$.at') = NEW.updated_at
        AND json_extract(audit.value, '$.action') = 'queue_report1')
    OR (SELECT count(*) FROM json_each(NEW.payload, '$.jobs') AS added
      WHERE NOT EXISTS (
        SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
        WHERE json_extract(previous.value, '$.id') IS json_extract(added.value, '$.id')
      ) AND json_extract(added.value, '$.stage') = 4) IS NOT
      (SELECT count(*) FROM json_each(NEW.payload, '$.audit') AS audit
      WHERE audit.key >= json_array_length(OLD.payload, '$.audit')
        AND json_extract(audit.value, '$.at') = NEW.updated_at
        AND json_extract(audit.value, '$.action') = 'save_recording')
  )
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow job creation origin is invalid');
END
`;

export const consultingFlowsJobInsertAuditIdentityTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_job_insert_audit_identity_guard
BEFORE INSERT ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.jobs') AS job
  WHERE json_extract(job.value, '$.status') IN ('queued', 'blocked')
    AND (SELECT count(*) FROM json_each(NEW.payload, '$.audit') AS audit
      WHERE json_extract(audit.value, '$.id') || '-job' IS json_extract(job.value, '$.id')
        AND json_extract(audit.value, '$.at') IS NEW.updated_at
        AND json_extract(audit.value, '$.action') IS
          CASE json_extract(job.value, '$.stage')
            WHEN 1 THEN 'queue_report1'
            WHEN 4 THEN 'save_recording'
          END) IS NOT 1
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial job audit identity is invalid');
END
`;

export const consultingFlowsJobCreationAuditIdentityTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_job_creation_audit_identity_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.jobs') AS job
  WHERE json_extract(job.value, '$.status') IN ('queued', 'blocked')
    AND NOT EXISTS (
      SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
      WHERE json_extract(previous.value, '$.id') IS json_extract(job.value, '$.id')
    )
    AND (SELECT count(*) FROM json_each(NEW.payload, '$.audit') AS audit
      WHERE audit.key >= json_array_length(OLD.payload, '$.audit')
        AND json_extract(audit.value, '$.id') || '-job' IS json_extract(job.value, '$.id')
        AND json_extract(audit.value, '$.at') IS NEW.updated_at
        AND json_extract(audit.value, '$.action') IS
          CASE json_extract(job.value, '$.stage')
            WHEN 1 THEN 'queue_report1'
            WHEN 4 THEN 'save_recording'
          END) IS NOT 1
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow job creation audit identity is invalid');
END
`;

export const consultingFlowsCommandHistoryTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_command_history_guard
BEFORE UPDATE ON consulting_flows
WHEN json_array_length(NEW.payload, '$.commandIds') < json_array_length(OLD.payload, '$.commandIds')
  OR EXISTS (
    SELECT 1 FROM json_each(OLD.payload, '$.commandIds') AS previous
    WHERE json_extract(NEW.payload, '$.commandIds[' || previous.key || ']') IS NOT previous.value
  )
  OR EXISTS (
    SELECT 1 FROM json_each(OLD.payload, '$.commandReceipts') AS previous
    WHERE NOT EXISTS (
      SELECT 1 FROM json_each(NEW.payload, '$.commandReceipts') AS current
      WHERE current.key IS previous.key
        AND json_extract(current.value, '$.actorKey') IS json_extract(previous.value, '$.actorKey')
        AND json_extract(current.value, '$.fingerprint') IS json_extract(previous.value, '$.fingerprint')
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow command history is immutable');
END
`;

export const consultingFlowsJobInsertCommandTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_job_insert_command_guard
BEFORE INSERT ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.jobs') AS job
  WHERE json_extract(job.value, '$.status') IN ('queued', 'blocked')
    AND (SELECT count(*) FROM json_each(NEW.payload, '$.commandIds') AS command
      WHERE command.value || '-job' IS json_extract(job.value, '$.id')) IS NOT 1
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial job command identity is invalid');
END
`;

export const consultingFlowsJobCreationCommandTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_job_creation_command_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.jobs') AS job
  WHERE json_extract(job.value, '$.status') IN ('queued', 'blocked')
    AND NOT EXISTS (
      SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
      WHERE json_extract(previous.value, '$.id') IS json_extract(job.value, '$.id')
    )
    AND (SELECT count(*) FROM json_each(NEW.payload, '$.commandIds') AS command
      WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
        AND command.value || '-job' IS json_extract(job.value, '$.id')) IS NOT 1
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow job creation command identity is invalid');
END
`;

export const consultingFlowsCommandInsertEvidenceTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_command_insert_evidence_guard
BEFORE INSERT ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  WHERE (SELECT count(*) FROM json_each(NEW.payload, '$.audit') AS audit
      WHERE json_extract(audit.value, '$.id') IS command.value
        AND json_extract(audit.value, '$.at') IS NEW.updated_at
        AND json_extract(audit.value, '$.action') IS NOT 'ai_result') IS NOT 1
    OR (SELECT count(*) FROM json_each(NEW.payload, '$.commandReceipts') AS receipt
      WHERE receipt.key IS command.value) IS NOT 1
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial command evidence is invalid');
END
`;

export const consultingFlowsNewCommandEvidenceTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_new_command_evidence_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
    AND ((SELECT count(*) FROM json_each(NEW.payload, '$.audit') AS audit
      WHERE audit.key >= json_array_length(OLD.payload, '$.audit')
        AND json_extract(audit.value, '$.id') IS command.value
        AND json_extract(audit.value, '$.at') IS NEW.updated_at
        AND json_extract(audit.value, '$.action') IS NOT 'ai_result') IS NOT 1
      OR (SELECT count(*) FROM json_each(NEW.payload, '$.commandReceipts') AS receipt
        WHERE receipt.key IS command.value) IS NOT 1)
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow new command evidence is invalid');
END
`;

export const consultingFlowsCommandReceiptOriginTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_command_receipt_origin_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandReceipts') AS receipt
  WHERE NOT EXISTS (
    SELECT 1 FROM json_each(OLD.payload, '$.commandReceipts') AS previous
    WHERE previous.key IS receipt.key
  ) AND NOT EXISTS (
    SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
    WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
      AND command.value IS receipt.key
  )
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow command receipt origin is invalid');
END
`;

export const consultingFlowsCommandInsertSemanticsTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_command_insert_semantics_guard
BEFORE INSERT ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  WHERE (SELECT count(*) FROM json_each(NEW.payload, '$.audit') AS audit
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE json_extract(audit.value, '$.id') IS command.value
        AND json_extract(audit.value, '$.at') IS NEW.updated_at
        AND json_extract(audit.value, '$.action') IS NOT 'ai_result'
        AND json_extract(receipt.value, '$.actor') IS json_extract(audit.value, '$.actor')
        AND json_extract(receipt.value, '$.action') IS json_extract(audit.value, '$.action')
        AND json_type(receipt.value, '$.actor') = 'text'
        AND json_type(receipt.value, '$.action') = 'text') IS NOT 1
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial command semantics are invalid');
END
`;

export const consultingFlowsCommandSemanticsTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_command_semantics_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(OLD.payload, '$.commandReceipts') AS previous
  JOIN json_each(NEW.payload, '$.commandReceipts') AS current
    ON current.key IS previous.key
  WHERE json_extract(current.value, '$.actor') IS NOT json_extract(previous.value, '$.actor')
    OR json_extract(current.value, '$.action') IS NOT json_extract(previous.value, '$.action')
)
OR EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
    AND (SELECT count(*) FROM json_each(NEW.payload, '$.audit') AS audit
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE audit.key >= json_array_length(OLD.payload, '$.audit')
        AND json_extract(audit.value, '$.id') IS command.value
        AND json_extract(audit.value, '$.at') IS NEW.updated_at
        AND json_extract(audit.value, '$.action') IS NOT 'ai_result'
        AND json_extract(receipt.value, '$.actor') IS json_extract(audit.value, '$.actor')
        AND json_extract(receipt.value, '$.action') IS json_extract(audit.value, '$.action')
        AND json_type(receipt.value, '$.actor') = 'text'
        AND json_type(receipt.value, '$.action') = 'text') IS NOT 1
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow command semantics are invalid');
END
`;

export const FLOW_COMMAND_EFFECT_PATHS = {
  import_intake_source: ['$.files'],
  save_source: ['$.ai.sourceText', '$.files'],
  exclude_source: ['$.files'],
  set_ai_policy: ['$.ai'],
  queue_report1: ['$.jobs'],
  save_report: ['$.reports'],
  confirm_analysis: ['$.analysis'],
  book_meeting: ['$.meetings'],
  complete_meeting: ['$.meetings'],
  cancel_meeting: ['$.meetings'],
  save_recording: ['$.recordings'],
  save_transcript: ['$.recordings'],
  retry_job: ['$.jobs'],
  confirm_solutions: ['$.decision'],
  request_document: ['$.requests'],
  mark_request_sent: ['$.requests'],
  receive_document: ['$.requests'],
  review_document: ['$.requests'],
  record_contract: ['$.contract'],
  confirm_payment: ['$.payments'],
  start_aftercare: ['$.aftercare'],
} as const;

export const FLOW_COMMAND_EXACT_EFFECT_TRIGGERS = {
  import_intake_source: [consultingFlowsImportIntakeSourceEffectTriggerSql],
  save_source: [consultingFlowsSaveSourceEffectTriggerSql],
  exclude_source: [consultingFlowsExcludeSourceEffectTriggerSql],
  set_ai_policy: [consultingFlowsSetAiPolicyJobsTriggerSql],
  queue_report1: [consultingFlowsQueueReportJobEffectTriggerSql],
  save_report: [consultingFlowsSaveReportEffectTriggerSql],
  confirm_analysis: [consultingFlowsConfirmAnalysisEffectTriggerSql],
  book_meeting: [consultingFlowsBookMeetingEffectTriggerSql],
  complete_meeting: [consultingFlowsCompleteMeetingEffectTriggerSql],
  cancel_meeting: [consultingFlowsCancelMeetingEffectTriggerSql],
  save_recording: [consultingFlowsSaveRecordingEffectTriggerSql],
  save_transcript: [consultingFlowsSaveTranscriptJobsTriggerSql],
  retry_job: [consultingFlowsRetryJobEffectTriggerSql],
  confirm_solutions: [consultingFlowsConfirmSolutionsEffectTriggerSql],
  request_document: [consultingFlowsRequestDocumentEffectTriggerSql],
  mark_request_sent: [consultingFlowsMarkRequestSentEffectTriggerSql],
  receive_document: [consultingFlowsReceiveDocumentEffectTriggerSql],
  review_document: [consultingFlowsReviewDocumentEffectTriggerSql],
  record_contract: [
    consultingFlowsRecordContractEffectTriggerSql,
    consultingFlowsRecordContractEvidenceTriggerSql,
  ],
  confirm_payment: [consultingFlowsConfirmPaymentEffectTriggerSql],
  start_aftercare: [consultingFlowsStartAftercareEffectTriggerSql],
} as const satisfies Record<
  keyof typeof FLOW_COMMAND_EFFECT_PATHS,
  readonly string[]
>;

const consultingFlowInitialEffectDefaults: Record<string, string | null> = {
  '$.reports': '[]',
  '$.files': '[]',
  '$.analysis': '{"reportId":""}',
  '$.meetings': '[]',
  '$.recordings': '[]',
  '$.requests': '[]',
  '$.decision': null,
  '$.contract': null,
  '$.payments': '[]',
  '$.executionStartedAt': null,
  '$.aftercare': null,
  '$.ai': '{"enabled":false,"sourceText":""}',
  '$.ai.sourceText': '',
  '$.jobs': '[]',
};

const consultingFlowCommandActionsSql = Object.keys(FLOW_COMMAND_EFFECT_PATHS)
  .map((action) => `'${action}'`)
  .join(', ');

const consultingFlowCommandEffectCaseSql = (initial: boolean) =>
  Object.entries(FLOW_COMMAND_EFFECT_PATHS)
    .map(([action, paths]) => {
      const changed = paths
        .map((path) => {
          if (!initial)
            return `json_extract(NEW.payload, '${path}') IS NOT json_extract(OLD.payload, '${path}')`;
          const baseline = consultingFlowInitialEffectDefaults[path];
          return baseline === null
            ? `json_type(NEW.payload, '${path}') IS NOT NULL`
            : `COALESCE(json_extract(NEW.payload, '${path}'), char(0)) IS NOT '${baseline}'`;
        })
        .join(' OR ');
      return `WHEN '${action}' THEN NOT (${changed})`;
    })
    .join('\n      ');

export const consultingFlowsCommandInsertEffectTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_command_insert_effect_guard
BEFORE INSERT ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) > 0
  AND (
    EXISTS (
      SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE COALESCE(json_extract(receipt.value, '$.action'), '') NOT IN (${consultingFlowCommandActionsSql})
        OR CASE json_extract(receipt.value, '$.action')
          ${consultingFlowCommandEffectCaseSql(true)}
          ELSE 1
        END
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial command effect is invalid');
END
`;

export const consultingFlowsCommandEffectTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_command_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND (
    EXISTS (
      SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
        AND (
          COALESCE(json_extract(receipt.value, '$.action'), '') NOT IN (${consultingFlowCommandActionsSql})
          OR CASE json_extract(receipt.value, '$.action')
            ${consultingFlowCommandEffectCaseSql(false)}
            ELSE 1
          END
        )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow command effect is invalid');
END
`;

export const FLOW_COMMAND_STATE_SCOPE_PATHS = {
  import_intake_source: ['$.files'],
  save_source: ['$.ai.sourceText', '$.files'],
  exclude_source: ['$.files'],
  set_ai_policy: [
    '$.ai.enabled',
    '$.ai.approvedAt',
    '$.ai.approvedBy',
    '$.jobs',
  ],
  queue_report1: ['$.jobs'],
  save_report: ['$.reports', '$.files', '$.analysis'],
  confirm_analysis: ['$.analysis'],
  book_meeting: ['$.meetings'],
  complete_meeting: ['$.meetings'],
  cancel_meeting: ['$.meetings'],
  save_recording: ['$.recordings', '$.jobs', '$.files'],
  save_transcript: ['$.recordings', '$.jobs', '$.files'],
  retry_job: ['$.jobs'],
  confirm_solutions: ['$.decision'],
  request_document: ['$.requests'],
  mark_request_sent: ['$.requests'],
  receive_document: ['$.requests', '$.files'],
  review_document: ['$.requests'],
  record_contract: ['$.contract', '$.meetings', '$.files'],
  confirm_payment: ['$.payments', '$.executionStartedAt'],
  start_aftercare: ['$.aftercare'],
} as const;

const consultingFlowInitialStateBaselines: Record<
  string,
  string | number | null
> = {
  '$.reports': '[]',
  '$.files': '[]',
  '$.analysis': '{"reportId":""}',
  '$.meetings': '[]',
  '$.recordings': '[]',
  '$.requests': '[]',
  '$.decision': null,
  '$.contract': null,
  '$.payments': '[]',
  '$.executionStartedAt': null,
  '$.aftercare': null,
  '$.ai.enabled': 0,
  '$.ai.approvedAt': null,
  '$.ai.approvedBy': null,
  '$.ai.sourceText': '',
  '$.jobs': '[]',
};

const consultingFlowInitialStateChangedSql = (
  path: string,
  baseline: string | number | null,
) => {
  if (baseline === null) return `json_type(NEW.payload, '${path}') IS NOT NULL`;
  const value =
    typeof baseline === 'number'
      ? String(baseline)
      : `'${baseline.replaceAll("'", "''")}'`;
  return `COALESCE(json_extract(NEW.payload, '${path}'), char(0)) IS NOT ${value}`;
};

const consultingFlowCommandScopeValuesSql = Object.entries(
  FLOW_COMMAND_STATE_SCOPE_PATHS,
)
  .flatMap(([action, paths]) => paths.map((path) => `('${action}', '${path}')`))
  .join(',\n      ');

const consultingFlowCommandInsertChangedSql = Object.entries(
  consultingFlowInitialStateBaselines,
)
  .map(
    ([path, baseline]) =>
      `CASE WHEN ${consultingFlowInitialStateChangedSql(path, baseline)} THEN '${path}' END`,
  )
  .join(',\n        ');

const consultingFlowCommandChangedSql = [
  '$.company',
  '$.partnerName',
  ...Object.keys(consultingFlowInitialStateBaselines),
]
  .map(
    (path) =>
      `CASE WHEN json_extract(NEW.payload, '${path}') IS NOT json_extract(OLD.payload, '${path}') THEN '${path}' END`,
  )
  .join(',\n          ');

export const consultingFlowsCommandInsertScopeTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_command_insert_scope_guard
BEFORE INSERT ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
    LEFT JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
      ON receipt.key IS command.value
    WHERE receipt.key IS NULL
  )
  AND EXISTS (
    WITH new_actions(action) AS (
      SELECT json_extract(receipt.value, '$.action')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
    ), allowed(action, path) AS (
      VALUES ${consultingFlowCommandScopeValuesSql}
    ), changed(path) AS (
      SELECT value FROM json_each(json_array(
        ${consultingFlowCommandInsertChangedSql}
      )) WHERE value IS NOT NULL
    )
    SELECT 1 FROM changed
    WHERE NOT EXISTS (
      SELECT 1 FROM new_actions
      JOIN allowed ON allowed.action IS new_actions.action
      WHERE allowed.path IS changed.path
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial command scope is invalid');
END
`;

export const consultingFlowsCommandScopeTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_command_scope_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND NOT EXISTS (
    SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
    LEFT JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
      ON receipt.key IS command.value
    WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
      AND receipt.key IS NULL
  )
  AND (
    EXISTS (
      WITH new_actions(action) AS (
        SELECT json_extract(receipt.value, '$.action')
        FROM json_each(NEW.payload, '$.commandIds') AS command
        JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
          ON receipt.key IS command.value
        WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
      ), allowed(action, path) AS (
        VALUES ${consultingFlowCommandScopeValuesSql}
      ), changed(path) AS (
        SELECT value FROM json_each(json_array(
          ${consultingFlowCommandChangedSql}
        )) WHERE value IS NOT NULL
      )
      SELECT 1 FROM changed
      WHERE NOT EXISTS (
        SELECT 1 FROM new_actions
        JOIN allowed ON allowed.action IS new_actions.action
        WHERE allowed.path IS changed.path
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow command scope is invalid');
END
`;

const flowCommandTargetCollections = [
  'reports',
  'meetings',
  'recordings',
  'requests',
  'payments',
] as const;

type FlowCommandTargetRule =
  | { kind: 'append'; idSuffix: string }
  | {
      kind: 'update';
      fields: readonly string[];
      minimum: number;
      maximum: number;
    };

export const FLOW_COMMAND_TARGET_RULES: Record<
  keyof typeof FLOW_COMMAND_STATE_SCOPE_PATHS,
  Partial<
    Record<(typeof flowCommandTargetCollections)[number], FlowCommandTargetRule>
  >
> = {
  import_intake_source: {},
  save_source: {},
  exclude_source: {},
  set_ai_policy: {},
  queue_report1: {},
  save_report: { reports: { kind: 'append', idSuffix: 'report' } },
  confirm_analysis: {},
  book_meeting: { meetings: { kind: 'append', idSuffix: 'meeting' } },
  complete_meeting: {
    meetings: {
      kind: 'update',
      fields: ['status', 'completedAt', 'note'],
      minimum: 1,
      maximum: 1,
    },
  },
  cancel_meeting: {
    meetings: {
      kind: 'update',
      fields: ['status', 'note'],
      minimum: 1,
      maximum: 1,
    },
  },
  save_recording: {
    recordings: { kind: 'append', idSuffix: 'recording' },
  },
  save_transcript: {
    recordings: {
      kind: 'update',
      fields: [
        'transcript',
        'transcriptFileId',
        'transcriptReviewedAt',
        'transcriptReviewedBy',
      ],
      minimum: 1,
      maximum: 1,
    },
  },
  retry_job: {},
  confirm_solutions: {},
  request_document: { requests: { kind: 'append', idSuffix: 'request' } },
  mark_request_sent: {
    requests: {
      kind: 'update',
      fields: ['sentAt'],
      minimum: 1,
      maximum: 1,
    },
  },
  receive_document: {
    requests: {
      kind: 'update',
      fields: [
        'fileId',
        'status',
        'receivedAt',
        'reviewedAt',
        'verifiedAt',
        'note',
      ],
      minimum: 1,
      maximum: 1,
    },
  },
  review_document: {
    requests: {
      kind: 'update',
      fields: ['status', 'note', 'reviewedAt', 'verifiedAt'],
      minimum: 1,
      maximum: 1,
    },
  },
  record_contract: {
    meetings: {
      kind: 'update',
      fields: ['status', 'completedAt'],
      minimum: 0,
      maximum: 1,
    },
  },
  confirm_payment: { payments: { kind: 'append', idSuffix: 'payment' } },
  start_aftercare: {},
};

const flowCommandTrackedCollectionsSql = flowCommandTargetCollections
  .map((collection) => `('${collection}')`)
  .join(', ');

const flowCommandAppendTargetRulesSql = Object.entries(
  FLOW_COMMAND_TARGET_RULES,
)
  .flatMap(([action, rules]) =>
    Object.entries(rules).flatMap(([collection, rule]) =>
      rule?.kind === 'append'
        ? [`('${action}', '${collection}', '${rule.idSuffix}')`]
        : [],
    ),
  )
  .join(',\n      ');

const flowCommandTargetRulesSql = Object.entries(FLOW_COMMAND_TARGET_RULES)
  .flatMap(([action, rules]) =>
    Object.entries(rules).map(([collection, rule]) =>
      rule.kind === 'append'
        ? `('${action}', '${collection}', 'append', '${rule.idSuffix}', NULL, 1, 1)`
        : `('${action}', '${collection}', 'update', NULL, '${JSON.stringify(rule.fields)}', ${rule.minimum}, ${rule.maximum})`,
    ),
  )
  .join(',\n      ');

const flowCommandTargetActionsSql = Object.entries(FLOW_COMMAND_TARGET_RULES)
  .filter(([, rules]) => Object.keys(rules).length > 0)
  .map(([action]) => `'${action}'`)
  .join(', ');

export const consultingFlowsCommandInsertTargetTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_command_insert_target_guard
BEFORE INSERT ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
    LEFT JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
      ON receipt.key IS command.value
    WHERE receipt.key IS NULL
  )
  AND (
    (
      json_array_length(NEW.payload, '$.commandIds') <> 1
      AND EXISTS (
        SELECT 1 FROM json_each(NEW.payload, '$.commandReceipts') AS receipt
        WHERE json_extract(receipt.value, '$.action') IN (${flowCommandTargetActionsSql})
      )
    )
    OR EXISTS (
      WITH command(id, action) AS (
        SELECT command.value, json_extract(receipt.value, '$.action')
        FROM json_each(NEW.payload, '$.commandIds') AS command
        JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
          ON receipt.key IS command.value
        LIMIT 1
      ), collections(name) AS (
        VALUES ${flowCommandTrackedCollectionsSql}
      ), append_rules(action, collection_name, id_suffix) AS (
        VALUES ${flowCommandAppendTargetRulesSql}
      )
      SELECT 1 FROM collections
      CROSS JOIN command
      LEFT JOIN append_rules AS rule
        ON rule.action IS command.action
        AND rule.collection_name IS collections.name
      WHERE (
        rule.id_suffix IS NULL
        AND json_array_length(NEW.payload, '$.' || collections.name) <> 0
      ) OR (
        rule.id_suffix IS NOT NULL
        AND (
          json_array_length(NEW.payload, '$.' || collections.name) <> 1
          OR json_extract(
            NEW.payload,
            '$.' || collections.name || '[0].id'
          ) IS NOT (command.id || '-' || rule.id_suffix)
        )
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial command target is invalid');
END
`;

export const consultingFlowsCommandTargetTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_command_target_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND NOT EXISTS (
    SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
    LEFT JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
      ON receipt.key IS command.value
    WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
      AND receipt.key IS NULL
  )
  AND (
    (
      json_array_length(NEW.payload, '$.commandIds') -
        json_array_length(OLD.payload, '$.commandIds') <> 1
      AND EXISTS (
        SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
        JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
          ON receipt.key IS command.value
        WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
          AND json_extract(receipt.value, '$.action') IN (${flowCommandTargetActionsSql})
      )
    )
    OR EXISTS (
      WITH command(id, action) AS (
        SELECT command.value, json_extract(receipt.value, '$.action')
        FROM json_each(NEW.payload, '$.commandIds') AS command
        JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
          ON receipt.key IS command.value
        WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
      ), collections(name) AS (
        VALUES ${flowCommandTrackedCollectionsSql}
      ), rules(action, collection_name, kind, id_suffix, fields, minimum, maximum) AS (
        VALUES ${flowCommandTargetRulesSql}
      )
      SELECT 1 FROM collections
      CROSS JOIN command
      LEFT JOIN rules AS rule
        ON rule.action IS command.action
        AND rule.collection_name IS collections.name
      WHERE (
        rule.kind IS NULL
        AND json_extract(NEW.payload, '$.' || collections.name) IS NOT
          json_extract(OLD.payload, '$.' || collections.name)
      ) OR (
        rule.kind IS 'append'
        AND (
          json_array_length(NEW.payload, '$.' || collections.name) <>
            json_array_length(OLD.payload, '$.' || collections.name) + 1
          OR EXISTS (
            SELECT 1 FROM json_each(
              OLD.payload,
              '$.' || collections.name
            ) AS previous
            WHERE previous.value IS NOT json_extract(
              NEW.payload,
              '$.' || collections.name || '[' || previous.key || ']'
            )
          )
          OR json_extract(
            NEW.payload,
            '$.' || collections.name || '[' ||
              json_array_length(OLD.payload, '$.' || collections.name) || '].id'
          ) IS NOT (command.id || '-' || rule.id_suffix)
        )
      ) OR (
        rule.kind IS 'update'
        AND (
          json_array_length(NEW.payload, '$.' || collections.name) <>
            json_array_length(OLD.payload, '$.' || collections.name)
          OR (
            SELECT COUNT(*) FROM json_each(
              OLD.payload,
              '$.' || collections.name
            ) AS previous
            WHERE previous.value IS NOT json_extract(
              NEW.payload,
              '$.' || collections.name || '[' || previous.key || ']'
            )
          ) NOT BETWEEN rule.minimum AND rule.maximum
          OR EXISTS (
            SELECT 1 FROM json_each(
              OLD.payload,
              '$.' || collections.name
            ) AS previous
            WHERE previous.value IS NOT json_extract(
              NEW.payload,
              '$.' || collections.name || '[' || previous.key || ']'
            )
              AND (
                EXISTS (
                  SELECT 1 FROM (
                    SELECT key FROM json_each(previous.value)
                    UNION
                    SELECT key FROM json_each(json_extract(
                      NEW.payload,
                      '$.' || collections.name || '[' || previous.key || ']'
                    ))
                  ) AS property
                  WHERE NOT EXISTS (
                    SELECT 1 FROM json_each(rule.fields) AS allowed
                    WHERE allowed.value IS property.key
                  )
                    AND (
                      json_type(previous.value, '$.' || property.key) IS NOT
                        json_type(json_extract(
                          NEW.payload,
                          '$.' || collections.name || '[' || previous.key || ']'
                        ), '$.' || property.key)
                      OR json_extract(previous.value, '$.' || property.key) IS NOT
                        json_extract(json_extract(
                          NEW.payload,
                          '$.' || collections.name || '[' || previous.key || ']'
                        ), '$.' || property.key)
                    )
                )
                OR CASE command.action
                  WHEN 'complete_meeting' THEN
                    json_extract(json_extract(
                      NEW.payload,
                      '$.' || collections.name || '[' || previous.key || ']'
                    ), '$.status') IS NOT 'completed'
                    OR json_extract(json_extract(
                      NEW.payload,
                      '$.' || collections.name || '[' || previous.key || ']'
                    ), '$.completedAt') IS NOT NEW.updated_at
                  WHEN 'cancel_meeting' THEN
                    json_extract(json_extract(
                      NEW.payload,
                      '$.' || collections.name || '[' || previous.key || ']'
                    ), '$.status') IS NOT 'cancelled'
                  WHEN 'save_transcript' THEN
                    json_extract(json_extract(
                      NEW.payload,
                      '$.' || collections.name || '[' || previous.key || ']'
                    ), '$.id') IS NOT json_extract(
                      NEW.payload,
                      '$.recordings[' ||
                        (json_array_length(NEW.payload, '$.recordings') - 1) || '].id'
                    )
                    OR json_extract(json_extract(
                      NEW.payload,
                      '$.' || collections.name || '[' || previous.key || ']'
                    ), '$.transcriptReviewedAt') IS NOT NEW.updated_at
                  WHEN 'mark_request_sent' THEN
                    json_extract(json_extract(
                      NEW.payload,
                      '$.' || collections.name || '[' || previous.key || ']'
                    ), '$.sentAt') IS NOT NEW.updated_at
                  WHEN 'receive_document' THEN
                    json_extract(json_extract(
                      NEW.payload,
                      '$.' || collections.name || '[' || previous.key || ']'
                    ), '$.status') IS NOT 'received'
                  WHEN 'review_document' THEN
                    json_extract(json_extract(
                      NEW.payload,
                      '$.' || collections.name || '[' || previous.key || ']'
                    ), '$.status') NOT IN ('verified', 'needs_fix')
                    OR json_extract(json_extract(
                      NEW.payload,
                      '$.' || collections.name || '[' || previous.key || ']'
                    ), '$.reviewedAt') IS NOT NEW.updated_at
                  WHEN 'record_contract' THEN
                    json_extract(json_extract(
                      NEW.payload,
                      '$.' || collections.name || '[' || previous.key || ']'
                    ), '$.id') IS NOT json_extract(NEW.payload, '$.contract.meetingId')
                    OR json_extract(json_extract(
                      NEW.payload,
                      '$.' || collections.name || '[' || previous.key || ']'
                    ), '$.status') IS NOT 'completed'
                  ELSE 0
                END
              )
          )
        )
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow command target is invalid');
END
`;

const consultingFlowNonCommandImmutablePaths = [
  '$.company',
  '$.partnerName',
  '$.meetings',
  '$.recordings',
  '$.requests',
  '$.decision',
  '$.contract',
  '$.payments',
  '$.executionStartedAt',
  '$.aftercare',
  '$.ai',
] as const;

const consultingFlowNonCommandImmutableSql =
  consultingFlowNonCommandImmutablePaths
    .map(
      (path) =>
        `json_extract(NEW.payload, '${path}') IS NOT json_extract(OLD.payload, '${path}')`,
    )
    .join('\n    OR ');

export const consultingFlowsNonCommandScopeTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_non_command_scope_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) =
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
    WHERE previous.value IS NOT json_extract(
      NEW.payload,
      '$.jobs[' || previous.key || ']'
    )
  )
  AND (
    ${consultingFlowNonCommandImmutableSql}
    OR (
      NOT EXISTS (
        SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
        WHERE json_extract(previous.value, '$.status') IS 'processing'
          AND json_extract(
            NEW.payload,
            '$.jobs[' || previous.key || '].status'
          ) IS 'complete'
      )
      AND (
        json_extract(NEW.payload, '$.reports') IS NOT json_extract(OLD.payload, '$.reports')
        OR json_extract(NEW.payload, '$.files') IS NOT json_extract(OLD.payload, '$.files')
        OR json_extract(NEW.payload, '$.analysis') IS NOT json_extract(OLD.payload, '$.analysis')
      )
    )
    OR (
      NOT EXISTS (
        SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
        WHERE json_extract(previous.value, '$.status') IS 'processing'
          AND json_extract(
            NEW.payload,
            '$.jobs[' || previous.key || '].status'
          ) IN ('blocked', 'failed', 'complete')
        OR json_extract(previous.value, '$.status') IN ('blocked', 'failed', 'processing')
          AND json_extract(
            NEW.payload,
            '$.jobs[' || previous.key || '].status'
          ) IS 'queued'
      )
      AND json_extract(NEW.payload, '$.audit') IS NOT json_extract(OLD.payload, '$.audit')
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow non-command scope is invalid');
END
`;

export const consultingFlowsNonCommandJobTargetTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_non_command_job_target_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) =
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND json_extract(NEW.payload, '$.jobs') IS NOT
    json_extract(OLD.payload, '$.jobs')
  AND (
    COALESCE(json_array_length(NEW.payload, '$.jobs'), -1) <>
      COALESCE(json_array_length(OLD.payload, '$.jobs'), -1)
    OR EXISTS (
      SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
      WHERE json_extract(
        NEW.payload,
        '$.jobs[' || previous.key || '].id'
      ) IS NOT json_extract(previous.value, '$.id')
    )
    OR (
      SELECT count(*) FROM json_each(OLD.payload, '$.jobs') AS previous
      WHERE previous.value IS NOT json_extract(
        NEW.payload,
        '$.jobs[' || previous.key || ']'
      )
    ) <> 1
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow non-command job target is invalid');
END
`;

export const consultingFlowsNonCommandJobTransitionTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_non_command_job_transition_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) =
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND json_array_length(NEW.payload, '$.jobs') =
    json_array_length(OLD.payload, '$.jobs')
  AND NOT EXISTS (
    SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
    WHERE json_extract(
      NEW.payload,
      '$.jobs[' || previous.key || '].id'
    ) IS NOT json_extract(previous.value, '$.id')
  )
  AND (
    SELECT count(*) FROM json_each(OLD.payload, '$.jobs') AS previous
    WHERE previous.value IS NOT json_extract(
      NEW.payload,
      '$.jobs[' || previous.key || ']'
    )
  ) = 1
  AND EXISTS (
    SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
    WHERE previous.value IS NOT json_extract(
        NEW.payload,
        '$.jobs[' || previous.key || ']'
      )
      AND json_extract(previous.value, '$.status') IS NOT json_extract(
        NEW.payload,
        '$.jobs[' || previous.key || '].status'
      )
      AND NOT (
        json_extract(previous.value, '$.status') IS 'queued'
          AND json_extract(
            NEW.payload,
            '$.jobs[' || previous.key || '].status'
          ) IN ('processing', 'blocked')
        OR json_extract(previous.value, '$.status') IS 'processing'
          AND json_extract(
            NEW.payload,
            '$.jobs[' || previous.key || '].status'
          ) IN ('blocked', 'failed', 'complete')
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow non-command job transition is invalid');
END
`;

export const consultingFlowsNonCommandAuditCardinalityTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_non_command_audit_cardinality_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) =
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND json_array_length(NEW.payload, '$.jobs') =
    json_array_length(OLD.payload, '$.jobs')
  AND NOT EXISTS (
    SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
    WHERE json_extract(
      NEW.payload,
      '$.jobs[' || previous.key || '].id'
    ) IS NOT json_extract(previous.value, '$.id')
  )
  AND (
    SELECT count(*) FROM json_each(OLD.payload, '$.jobs') AS previous
    WHERE previous.value IS NOT json_extract(
      NEW.payload,
      '$.jobs[' || previous.key || ']'
    )
  ) = 1
  AND EXISTS (
    SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
    WHERE previous.value IS NOT json_extract(
        NEW.payload,
        '$.jobs[' || previous.key || ']'
      )
      AND (
        json_extract(previous.value, '$.status') IS 'queued'
          AND json_extract(
            NEW.payload,
            '$.jobs[' || previous.key || '].status'
          ) IN ('processing', 'blocked')
        OR json_extract(previous.value, '$.status') IS 'processing'
          AND json_extract(
            NEW.payload,
            '$.jobs[' || previous.key || '].status'
          ) IN ('blocked', 'failed', 'complete')
      )
  )
  AND COALESCE(json_array_length(NEW.payload, '$.audit'), -1) <>
    COALESCE(json_array_length(OLD.payload, '$.audit'), -1) +
      CASE WHEN EXISTS (
        SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
        WHERE previous.value IS NOT json_extract(
            NEW.payload,
            '$.jobs[' || previous.key || ']'
          )
          AND json_extract(previous.value, '$.status') IS 'processing'
          AND json_extract(
            NEW.payload,
            '$.jobs[' || previous.key || '].status'
          ) IN ('blocked', 'failed', 'complete')
      ) THEN 1 ELSE 0 END
BEGIN
  SELECT RAISE(ABORT, 'consulting flow non-command audit cardinality is invalid');
END
`;

export const consultingFlowsAiResultReportTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_ai_result_report_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) =
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
    WHERE json_extract(previous.value, '$.status') IS 'processing'
      AND json_extract(
        NEW.payload,
        '$.jobs[' || previous.key || '].status'
      ) IS 'complete'
  )
  AND (
    (
      SELECT count(*) FROM json_each(OLD.payload, '$.jobs') AS previous
      WHERE json_extract(previous.value, '$.status') IS 'processing'
        AND json_extract(
          NEW.payload,
          '$.jobs[' || previous.key || '].status'
        ) IS 'complete'
    ) <> 1
    OR json_array_length(NEW.payload, '$.reports') <>
      json_array_length(OLD.payload, '$.reports') + 1
    OR EXISTS (
      SELECT 1 FROM json_each(OLD.payload, '$.reports') AS previous
      WHERE previous.value IS NOT json_extract(
        NEW.payload,
        '$.reports[' || previous.key || ']'
      )
    )
    OR EXISTS (
      SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
      WHERE json_extract(previous.value, '$.status') IS 'processing'
        AND json_extract(
          NEW.payload,
          '$.jobs[' || previous.key || '].status'
        ) IS 'complete'
        AND (
          json_extract(
            NEW.payload,
            '$.jobs[' || previous.key || '].reportId'
          ) IS NOT (json_extract(previous.value, '$.id') || '-result')
          OR json_extract(
            NEW.payload,
            '$.reports[' || json_array_length(OLD.payload, '$.reports') || '].id'
          ) IS NOT (json_extract(previous.value, '$.id') || '-result')
          OR json_extract(
            NEW.payload,
            '$.reports[' || json_array_length(OLD.payload, '$.reports') || '].stage'
          ) IS NOT json_extract(previous.value, '$.stage')
          OR json_extract(
            NEW.payload,
            '$.reports[' || json_array_length(OLD.payload, '$.reports') || '].version'
          ) IS NOT (
            SELECT count(*) + 1 FROM json_each(OLD.payload, '$.reports') AS report
            WHERE json_extract(report.value, '$.stage') IS
              json_extract(previous.value, '$.stage')
          )
          OR json_extract(
            NEW.payload,
            '$.reports[' || json_array_length(OLD.payload, '$.reports') || '].title'
          ) IS NOT CASE json_extract(previous.value, '$.stage')
            WHEN 1 THEN '1차 정밀진단보고서'
            WHEN 4 THEN '4차 심화보고서'
          END
          OR json_extract(
            NEW.payload,
            '$.reports[' || json_array_length(OLD.payload, '$.reports') || '].createdAt'
          ) IS NOT NEW.updated_at
          OR json_extract(
            NEW.payload,
            '$.reports[' || json_array_length(OLD.payload, '$.reports') || '].createdBy'
          ) IS NOT 'Claude · 대표 검토 전'
          OR json_extract(
            NEW.payload,
            '$.reports[' || json_array_length(OLD.payload, '$.reports') || '].origin'
          ) IS NOT 'ai'
          OR json_type(
            NEW.payload,
            '$.reports[' || json_array_length(OLD.payload, '$.reports') || '].decisionId'
          ) IS NOT NULL
          OR json_type(
            NEW.payload,
            '$.reports[' || json_array_length(OLD.payload, '$.reports') || '].documentsKey'
          ) IS NOT NULL
          OR CASE json_extract(previous.value, '$.stage')
            WHEN 1 THEN
              json_type(
                NEW.payload,
                '$.reports[' || json_array_length(OLD.payload, '$.reports') || '].sourceReportId'
              ) IS NOT NULL
              OR json_type(
                NEW.payload,
                '$.reports[' || json_array_length(OLD.payload, '$.reports') || '].sourceRecordingId'
              ) IS NOT NULL
              OR json_extract(NEW.payload, '$.analysis.reportId') IS NOT
                (json_extract(previous.value, '$.id') || '-result')
              OR (
                SELECT count(*) FROM json_each(NEW.payload, '$.analysis')
              ) <> 1
            WHEN 4 THEN
              json_extract(
                NEW.payload,
                '$.reports[' || json_array_length(OLD.payload, '$.reports') || '].sourceReportId'
              ) IS NOT json_extract(previous.value, '$.sourceReportId')
              OR json_extract(
                NEW.payload,
                '$.reports[' || json_array_length(OLD.payload, '$.reports') || '].sourceRecordingId'
              ) IS NOT json_extract(previous.value, '$.sourceRecordingId')
              OR json_extract(NEW.payload, '$.analysis') IS NOT
                json_extract(OLD.payload, '$.analysis')
            ELSE 1
          END
        )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow AI result report is invalid');
END
`;

export const consultingFlowsAiResultFileTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_ai_result_file_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) =
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
    WHERE json_extract(previous.value, '$.status') IS 'processing'
      AND json_extract(
        NEW.payload,
        '$.jobs[' || previous.key || '].status'
      ) IS 'complete'
  )
  AND (
    json_extract(NEW.payload, '$.files') IS NOT
      json_extract(OLD.payload, '$.files')
    OR EXISTS (
      SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
      WHERE json_extract(previous.value, '$.status') IS 'processing'
        AND json_extract(
          NEW.payload,
          '$.jobs[' || previous.key || '].status'
        ) IS 'complete'
        AND EXISTS (
          SELECT 1 FROM json_each(NEW.payload, '$.reports') AS report
          WHERE json_extract(report.value, '$.id') IS
              (json_extract(previous.value, '$.id') || '-result')
            AND json_type(report.value, '$.fileId') IS NOT NULL
        )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow AI result file is invalid');
END
`;

export const consultingFlowsAiResultAuditDetailTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_ai_result_audit_detail_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1
  FROM json_each(OLD.payload, '$.jobs') AS previous
  JOIN json_each(NEW.payload, '$.jobs') AS next
    ON json_extract(next.value, '$.id') IS json_extract(previous.value, '$.id')
  WHERE json_extract(previous.value, '$.status') IS 'processing'
    AND json_extract(next.value, '$.status') IN ('blocked', 'failed', 'complete')
    AND EXISTS (
      SELECT 1 FROM json_each(NEW.payload, '$.audit') AS audit
      WHERE audit.key >= json_array_length(OLD.payload, '$.audit')
        AND json_extract(audit.value, '$.id') IS
          (json_extract(next.value, '$.id') || '-' || NEW.updated_at)
        AND json_extract(audit.value, '$.at') IS NEW.updated_at
        AND json_extract(audit.value, '$.actor') IS '보고서 자동생성'
        AND json_extract(audit.value, '$.action') IS 'ai_result'
    )
    AND (
      SELECT count(*) FROM json_each(NEW.payload, '$.audit') AS audit
      WHERE audit.key >= json_array_length(OLD.payload, '$.audit')
        AND json_extract(audit.value, '$.id') IS
          (json_extract(next.value, '$.id') || '-' || NEW.updated_at)
        AND json_extract(audit.value, '$.at') IS NEW.updated_at
        AND json_extract(audit.value, '$.actor') IS '보고서 자동생성'
        AND json_extract(audit.value, '$.action') IS 'ai_result'
        AND json_extract(audit.value, '$.detail') IS
          CASE json_extract(next.value, '$.status')
            WHEN 'complete' THEN
              CASE json_extract(next.value, '$.stage')
                WHEN 1 THEN '1차 정밀진단보고서 자동 저장 · 담당 파트너 공유'
                WHEN 4 THEN '4차 심화보고서 자동 저장 · 담당 파트너 공유'
              END
            WHEN 'blocked' THEN
              CASE json_extract(next.value, '$.stage')
                WHEN 1 THEN '1차 정밀진단보고서 보류 · '
                WHEN 4 THEN '4차 심화보고서 보류 · '
              END || json_extract(next.value, '$.reason')
            WHEN 'failed' THEN
              CASE json_extract(next.value, '$.stage')
                WHEN 1 THEN '1차 정밀진단보고서 실패 · '
                WHEN 4 THEN '4차 심화보고서 실패 · '
              END || json_extract(next.value, '$.reason')
          END
    ) <> 1
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow AI result audit detail is invalid');
END
`;

const consultingFlowCommandReceiptIdentityViolationSql = (receipt: string) => `
  COALESCE(json_type(${receipt}.value, '$.fingerprint'), '') <> 'text'
  OR length(json_extract(${receipt}.value, '$.fingerprint')) <> 64
  OR json_extract(${receipt}.value, '$.fingerprint') GLOB '*[^0-9a-f]*'
  OR COALESCE(json_type(${receipt}.value, '$.actorKey'), '') <> 'text'
  OR length(json_extract(${receipt}.value, '$.actorKey')) NOT BETWEEN 8 AND 500
  OR NOT (
    substr(json_extract(${receipt}.value, '$.actorKey'), 1, 6) = 'admin:'
    OR substr(json_extract(${receipt}.value, '$.actorKey'), 1, 7) = 'member:'
  )
  OR instr(json_extract(${receipt}.value, '$.actorKey'), char(9)) > 0
  OR instr(json_extract(${receipt}.value, '$.actorKey'), char(10)) > 0
  OR instr(json_extract(${receipt}.value, '$.actorKey'), char(13)) > 0
  OR instr(json_extract(${receipt}.value, '$.actorKey'), ' ') > 0`;

export const consultingFlowsCommandInsertReceiptIdentityTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_command_insert_receipt_identity_guard
BEFORE INSERT ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
    ON receipt.key IS command.value
  WHERE ${consultingFlowCommandReceiptIdentityViolationSql('receipt')}
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial command receipt identity is invalid');
END
`;

export const consultingFlowsNewCommandReceiptIdentityTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_new_command_receipt_identity_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
    ON receipt.key IS command.value
  WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
    AND (${consultingFlowCommandReceiptIdentityViolationSql('receipt')})
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow new command receipt identity is invalid');
END
`;

const consultingFlowMemberCommandActorViolationSql = (receipt: string) => `
  substr(json_extract(${receipt}.value, '$.actorKey'), 1, 7) = 'member:'
  AND (
    json_extract(${receipt}.value, '$.actorKey') IS NOT ('member:' || NEW.partner_id)
    OR json_extract(${receipt}.value, '$.actor') IS NOT json_extract(NEW.payload, '$.partnerName')
  )`;

export const consultingFlowsCommandInsertMemberActorTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_command_insert_member_actor_guard
BEFORE INSERT ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
    ON receipt.key IS command.value
  WHERE ${consultingFlowMemberCommandActorViolationSql('receipt')}
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial member command actor is invalid');
END
`;

export const consultingFlowsNewCommandMemberActorTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_new_command_member_actor_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
    ON receipt.key IS command.value
  WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
    AND (${consultingFlowMemberCommandActorViolationSql('receipt')})
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow new member command actor is invalid');
END
`;

const consultingFlowAdminCommandActorViolationSql = (receipt: string) => `
  substr(json_extract(${receipt}.value, '$.actorKey'), 1, 6) = 'admin:'
  AND json_extract(${receipt}.value, '$.actorKey') IS NOT 'admin:primary'`;

export const consultingFlowsCommandInsertAdminActorTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_command_insert_admin_actor_guard
BEFORE INSERT ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
    ON receipt.key IS command.value
  WHERE ${consultingFlowAdminCommandActorViolationSql('receipt')}
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial admin command actor is invalid');
END
`;

export const consultingFlowsNewCommandAdminActorTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_new_command_admin_actor_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
    ON receipt.key IS command.value
  WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
    AND (${consultingFlowAdminCommandActorViolationSql('receipt')})
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow new admin command actor is invalid');
END
`;

const consultingFlowAdminCommandDisplayViolationSql = (receipt: string) => `
  substr(json_extract(${receipt}.value, '$.actorKey'), 1, 6) = 'admin:'
  AND json_extract(${receipt}.value, '$.actor') IS NOT '김성민 대표'`;

export const consultingFlowsCommandInsertAdminDisplayTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_command_insert_admin_display_guard
BEFORE INSERT ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
    ON receipt.key IS command.value
  WHERE ${consultingFlowAdminCommandDisplayViolationSql('receipt')}
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial admin command display is invalid');
END
`;

export const consultingFlowsNewCommandAdminDisplayTriggerSql = `
CREATE TRIGGER IF NOT EXISTS consulting_flows_new_command_admin_display_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
    ON receipt.key IS command.value
  WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
    AND (${consultingFlowAdminCommandDisplayViolationSql('receipt')})
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow new admin command display is invalid');
END
`;

export const consultingFlowsNoDeleteTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS consulting_flows_no_delete BEFORE DELETE ON consulting_flows BEGIN SELECT RAISE(ABORT, 'consulting flow root is durable'); END";

export const consultingFlowFileOwnersTableSql = `
CREATE TABLE IF NOT EXISTS consulting_flow_file_owners (
  file_id TEXT PRIMARY KEY NOT NULL,
  case_id TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
)
`;

export const consultingFlowFileOwnersNoUpdateTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS consulting_flow_file_owners_no_update BEFORE UPDATE ON consulting_flow_file_owners BEGIN SELECT RAISE(ABORT, 'consulting flow file owner is immutable'); END";

export const consultingFlowFileOwnersNoDeleteTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS consulting_flow_file_owners_no_delete BEFORE DELETE ON consulting_flow_file_owners BEGIN SELECT RAISE(ABORT, 'consulting flow file owner is durable'); END";

export const consultingFlowFileOwnersCaseIndexSql = `
CREATE INDEX IF NOT EXISTS consulting_flow_file_owners_case_idx
ON consulting_flow_file_owners (case_id)
`;

export const consultingFlowFileOwnersBackfillSql = `
WITH flow_files AS (
  SELECT flow.case_id AS case_id, json_extract(file.value, '$.id') AS file_id,
    json_extract(file.value, '$.key') AS storage_key,
    json_extract(file.value, '$.createdAt') AS created_at
  FROM consulting_flows flow,
    json_each(CASE WHEN json_valid(flow.payload) THEN flow.payload ELSE '{"files":[]}' END, '$.files') file
  WHERE json_type(file.value, '$.id') = 'text'
    AND json_type(file.value, '$.key') = 'text'
    AND json_type(file.value, '$.createdAt') = 'text'
)
INSERT OR IGNORE INTO consulting_flow_file_owners
  (file_id, case_id, storage_key, created_at)
SELECT candidate.file_id, candidate.case_id, candidate.storage_key,
  candidate.created_at
FROM flow_files candidate
WHERE NOT EXISTS (SELECT 1 FROM flow_files other
  WHERE other.case_id <> candidate.case_id AND
    (other.file_id = candidate.file_id OR other.storage_key = candidate.storage_key))
ORDER BY candidate.created_at, candidate.case_id
`;

export const consultingFlowFileMetadataTableSql = `
CREATE TABLE IF NOT EXISTS consulting_flow_file_metadata (
  file_id TEXT PRIMARY KEY NOT NULL,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  purpose TEXT NOT NULL,
  intake_file_id TEXT,
  intake_source_hash TEXT,
  source_reviewed_at TEXT,
  source_reviewed_by TEXT
)
`;

export const consultingFlowFileMetadataLifecycleTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS consulting_flow_file_metadata_lifecycle_guard BEFORE UPDATE ON consulting_flow_file_metadata WHEN NEW.file_id <> OLD.file_id OR NEW.original_name <> OLD.original_name OR NEW.content_type <> OLD.content_type OR NEW.size_bytes <> OLD.size_bytes OR NEW.intake_file_id IS NOT OLD.intake_file_id OR NEW.intake_source_hash IS NOT OLD.intake_source_hash OR NEW.source_reviewed_at IS NOT OLD.source_reviewed_at OR NEW.source_reviewed_by IS NOT OLD.source_reviewed_by OR NOT (NEW.purpose = OLD.purpose OR (OLD.purpose = 'source' AND NEW.purpose = 'source_archived')) BEGIN SELECT RAISE(ABORT, 'consulting flow file metadata transition is invalid'); END";

export const consultingFlowFileMetadataNoDeleteTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS consulting_flow_file_metadata_no_delete BEFORE DELETE ON consulting_flow_file_metadata BEGIN SELECT RAISE(ABORT, 'consulting flow file metadata is durable'); END";

export const consultingFlowFileMetadataBackfillSql = `
WITH flow_files AS (
  SELECT flow.case_id AS case_id, json_extract(file.value, '$.id') AS file_id,
    json_extract(file.value, '$.key') AS storage_key,
    json_extract(file.value, '$.name') AS original_name,
    json_extract(file.value, '$.contentType') AS content_type,
    json_extract(file.value, '$.size') AS size_bytes,
    json_extract(file.value, '$.purpose') AS purpose,
    json_extract(file.value, '$.intakeFileId') AS intake_file_id,
    json_extract(file.value, '$.intakeSourceHash') AS intake_source_hash,
    json_extract(file.value, '$.sourceReviewedAt') AS source_reviewed_at,
    json_extract(file.value, '$.sourceReviewedBy') AS source_reviewed_by
  FROM consulting_flows flow,
    json_each(CASE WHEN json_valid(flow.payload) THEN flow.payload ELSE '{"files":[]}' END, '$.files') file
  WHERE json_type(file.value, '$.id') = 'text'
    AND json_type(file.value, '$.key') = 'text'
    AND json_type(file.value, '$.name') = 'text'
    AND json_type(file.value, '$.contentType') = 'text'
    AND json_type(file.value, '$.size') = 'integer'
    AND json_type(file.value, '$.purpose') = 'text'
    AND (json_type(file.value, '$.intakeFileId') IS NULL OR json_type(file.value, '$.intakeFileId') = 'text')
    AND (json_type(file.value, '$.intakeSourceHash') IS NULL OR json_type(file.value, '$.intakeSourceHash') = 'text')
    AND (json_type(file.value, '$.sourceReviewedAt') IS NULL OR json_type(file.value, '$.sourceReviewedAt') = 'text')
    AND (json_type(file.value, '$.sourceReviewedBy') IS NULL OR json_type(file.value, '$.sourceReviewedBy') = 'text')
)
INSERT OR IGNORE INTO consulting_flow_file_metadata
  (file_id, original_name, content_type, size_bytes, purpose, intake_file_id,
    intake_source_hash, source_reviewed_at, source_reviewed_by)
SELECT candidate.file_id, candidate.original_name, candidate.content_type,
  candidate.size_bytes, candidate.purpose, candidate.intake_file_id,
  candidate.intake_source_hash, candidate.source_reviewed_at,
  candidate.source_reviewed_by
FROM flow_files candidate
JOIN consulting_flow_file_owners owner ON owner.file_id = candidate.file_id
  AND owner.case_id = candidate.case_id
  AND owner.storage_key = candidate.storage_key
ORDER BY owner.created_at, candidate.case_id
`;

export const consultingFlowFileObjectIntegrityTableSql = `
CREATE TABLE IF NOT EXISTS consulting_flow_file_object_integrity (
  file_id TEXT PRIMARY KEY NOT NULL,
  validation_mode TEXT NOT NULL CHECK (validation_mode IN ('metadata', 'etag')),
  r2_etag TEXT,
  r2_content_type TEXT NOT NULL,
  CHECK ((validation_mode = 'metadata' AND r2_etag IS NULL) OR
    (validation_mode = 'etag' AND length(r2_etag) BETWEEN 1 AND 256))
)
`;

export const consultingFlowFileObjectIntegrityNoUpdateTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS consulting_flow_file_object_integrity_no_update BEFORE UPDATE ON consulting_flow_file_object_integrity BEGIN SELECT RAISE(ABORT, 'consulting flow file object integrity is immutable'); END";

export const consultingFlowFileObjectIntegrityNoDeleteTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS consulting_flow_file_object_integrity_no_delete BEFORE DELETE ON consulting_flow_file_object_integrity BEGIN SELECT RAISE(ABORT, 'consulting flow file object integrity is durable'); END";

export const consultingFlowFileObjectIntegrityBackfillSql = `
INSERT OR IGNORE INTO consulting_flow_file_object_integrity
  (file_id, validation_mode, r2_etag, r2_content_type)
SELECT metadata.file_id, 'metadata', NULL, metadata.content_type
FROM consulting_flow_file_metadata metadata
JOIN consulting_flow_file_owners owner ON owner.file_id = metadata.file_id
ORDER BY owner.created_at, metadata.file_id
`;

// A reservation exists before R2.put so an ambiguous D1 response remains
// discoverable and an exact retry reuses the same private object key.
export const consultingFlowUploadRequestsTableSql = `
CREATE TABLE IF NOT EXISTS consulting_flow_upload_requests (
  case_id TEXT NOT NULL,
  actor_key TEXT NOT NULL,
  command_id TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('file', 'audio')),
  fingerprint TEXT NOT NULL,
  file_id TEXT NOT NULL UNIQUE,
  storage_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  purpose TEXT NOT NULL,
  intake_file_id TEXT,
  intake_source_hash TEXT,
  source_reviewed_at TEXT,
  source_reviewed_by TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready')),
  PRIMARY KEY (case_id, actor_key, command_id, slot)
)
`;

export const consultingFlowUploadRequestsPendingIndexSql = `
CREATE INDEX IF NOT EXISTS consulting_flow_upload_requests_pending_idx
ON consulting_flow_upload_requests (status, created_at, file_id)
WHERE status = 'pending'
`;

export const consultingFlowUploadRequestsInsertEnvelopeTriggerSql = `CREATE TRIGGER IF NOT EXISTS consulting_flow_upload_requests_insert_envelope_guard BEFORE INSERT ON consulting_flow_upload_requests WHEN typeof(NEW.case_id) <> 'text' OR length(NEW.case_id) NOT BETWEEN 1 AND 120 OR NEW.case_id GLOB '*[^A-Za-z0-9_-]*' OR typeof(NEW.actor_key) <> 'text' OR length(NEW.actor_key) NOT BETWEEN 8 AND 500 OR NOT (NEW.actor_key = 'admin:primary' OR (substr(NEW.actor_key, 1, 7) = 'member:' AND length(NEW.actor_key) BETWEEN 8 AND 127 AND substr(NEW.actor_key, 8) NOT GLOB '*[^A-Za-z0-9_-]*')) OR typeof(NEW.command_id) <> 'text' OR length(NEW.command_id) NOT BETWEEN 8 AND 100 OR NEW.command_id GLOB '*[^A-Za-z0-9_-]*' OR NEW.slot NOT IN ('file', 'audio') OR typeof(NEW.fingerprint) <> 'text' OR length(NEW.fingerprint) <> 64 OR NEW.fingerprint GLOB '*[^0-9a-f]*' OR typeof(NEW.file_id) <> 'text' OR length(NEW.file_id) NOT BETWEEN 1 AND 200 OR NEW.file_id GLOB '*[^A-Za-z0-9_-]*' OR NEW.storage_key IS NOT 'consulting-flow/' || NEW.file_id OR typeof(NEW.original_name) <> 'text' OR length(NEW.original_name) NOT BETWEEN 1 AND 300 OR typeof(NEW.content_type) <> 'text' OR length(NEW.content_type) NOT BETWEEN 1 AND 200 OR typeof(NEW.size_bytes) <> 'integer' OR NEW.size_bytes NOT BETWEEN 1 AND ${MAX_FLOW_UPLOAD_BYTES} OR NEW.purpose NOT IN ('source', 'report', 'recording', 'transcript', 'requested_document', 'signed_contract') OR (NEW.slot = 'audio' AND NEW.purpose <> 'recording') OR (NEW.purpose <> 'source' AND (NEW.intake_file_id IS NOT NULL OR NEW.intake_source_hash IS NOT NULL OR NEW.source_reviewed_at IS NOT NULL OR NEW.source_reviewed_by IS NOT NULL)) OR ((NEW.intake_file_id IS NULL) <> (NEW.intake_source_hash IS NULL)) OR ((NEW.intake_file_id IS NULL) <> (NEW.source_reviewed_at IS NULL)) OR ((NEW.intake_file_id IS NULL) <> (NEW.source_reviewed_by IS NULL)) OR (NEW.intake_file_id IS NOT NULL AND (typeof(NEW.intake_file_id) <> 'text' OR length(NEW.intake_file_id) NOT BETWEEN 1 AND 120 OR typeof(NEW.intake_source_hash) <> 'text' OR length(NEW.intake_source_hash) <> 64 OR NEW.intake_source_hash GLOB '*[^0-9a-f]*' OR ${invalidUtcMillisecondTimestampSql('NEW.source_reviewed_at')} OR typeof(NEW.source_reviewed_by) <> 'text' OR length(NEW.source_reviewed_by) NOT BETWEEN 1 AND 200)) OR ${invalidUtcMillisecondTimestampSql('NEW.created_at')} OR NEW.status <> 'pending' BEGIN SELECT RAISE(ABORT, 'consulting flow upload reservation envelope is invalid'); END`;

export const consultingFlowUploadRequestsFingerprintTriggerSql = `CREATE TRIGGER IF NOT EXISTS consulting_flow_upload_requests_fingerprint_guard BEFORE INSERT ON consulting_flow_upload_requests WHEN EXISTS (SELECT 1 FROM consulting_flow_upload_requests WHERE case_id = NEW.case_id AND actor_key = NEW.actor_key AND command_id = NEW.command_id AND fingerprint <> NEW.fingerprint) BEGIN SELECT RAISE(ABORT, 'consulting flow upload reservation fingerprint is immutable'); END`;

export const consultingFlowUploadRequestsLifecycleTriggerSql = `CREATE TRIGGER IF NOT EXISTS consulting_flow_upload_requests_lifecycle_guard BEFORE UPDATE ON consulting_flow_upload_requests WHEN NEW.case_id <> OLD.case_id OR NEW.actor_key <> OLD.actor_key OR NEW.command_id <> OLD.command_id OR NEW.slot <> OLD.slot OR NEW.fingerprint <> OLD.fingerprint OR NEW.file_id <> OLD.file_id OR NEW.storage_key <> OLD.storage_key OR NEW.original_name <> OLD.original_name OR NEW.content_type <> OLD.content_type OR NEW.size_bytes <> OLD.size_bytes OR NEW.purpose <> OLD.purpose OR NEW.intake_file_id IS NOT OLD.intake_file_id OR NEW.intake_source_hash IS NOT OLD.intake_source_hash OR NEW.source_reviewed_at IS NOT OLD.source_reviewed_at OR NEW.source_reviewed_by IS NOT OLD.source_reviewed_by OR NEW.created_at <> OLD.created_at OR NOT (NEW.status = OLD.status OR (OLD.status = 'pending' AND NEW.status = 'ready')) BEGIN SELECT RAISE(ABORT, 'consulting flow upload reservation transition is invalid'); END`;

export const consultingFlowUploadRequestsReadyTriggerSql = `CREATE TRIGGER IF NOT EXISTS consulting_flow_upload_requests_ready_guard BEFORE UPDATE ON consulting_flow_upload_requests WHEN OLD.status = 'pending' AND NEW.status = 'ready' AND (NOT EXISTS (SELECT 1 FROM consulting_flow_file_owners owner JOIN consulting_flow_file_metadata metadata ON metadata.file_id = owner.file_id JOIN consulting_flow_file_object_integrity integrity ON integrity.file_id = owner.file_id WHERE owner.file_id = NEW.file_id AND owner.case_id = NEW.case_id AND owner.storage_key = NEW.storage_key AND metadata.original_name = NEW.original_name AND metadata.content_type = NEW.content_type AND metadata.size_bytes = NEW.size_bytes AND metadata.purpose = NEW.purpose AND metadata.intake_file_id IS NEW.intake_file_id AND metadata.intake_source_hash IS NEW.intake_source_hash AND metadata.source_reviewed_at IS NEW.source_reviewed_at AND metadata.source_reviewed_by IS NEW.source_reviewed_by AND integrity.validation_mode = 'etag' AND integrity.r2_content_type = NEW.content_type) OR NOT EXISTS (SELECT 1 FROM consulting_flows flow, json_each(flow.payload, '$.files') file WHERE flow.case_id = NEW.case_id AND json_extract(file.value, '$.id') = NEW.file_id AND json_extract(file.value, '$.key') = NEW.storage_key AND json_extract(file.value, '$.name') = NEW.original_name AND json_extract(file.value, '$.contentType') = NEW.content_type AND json_extract(file.value, '$.size') = NEW.size_bytes AND json_extract(file.value, '$.purpose') = NEW.purpose AND json_extract(file.value, '$.intakeFileId') IS NEW.intake_file_id AND json_extract(file.value, '$.intakeSourceHash') IS NEW.intake_source_hash AND json_extract(file.value, '$.sourceReviewedAt') IS NEW.source_reviewed_at AND json_extract(file.value, '$.sourceReviewedBy') IS NEW.source_reviewed_by)) BEGIN SELECT RAISE(ABORT, 'consulting flow upload reservation is not committed'); END`;

export const consultingFlowUploadRequestsNoDeleteTriggerSql =
  "CREATE TRIGGER IF NOT EXISTS consulting_flow_upload_requests_no_delete BEFORE DELETE ON consulting_flow_upload_requests BEGIN SELECT RAISE(ABORT, 'consulting flow upload reservation is durable'); END";

// Credentials and tokens must never be included in the client-facing portal_state JSON.
export const portalPasswordSchemaSql = [
  `CREATE TABLE IF NOT EXISTS portal_password_accounts (
    member_id TEXT PRIMARY KEY NOT NULL, email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, credential_version TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS portal_chatgpt_identity_bindings (
    subject_type TEXT NOT NULL CHECK (subject_type IN ('owner', 'member')),
    subject_id TEXT NOT NULL, user_key TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (subject_type, subject_id),
    CHECK ((subject_type = 'owner' AND subject_id = 'primary') OR
      (subject_type = 'member' AND length(subject_id) > 0))
  )`,
  `CREATE TABLE IF NOT EXISTS portal_password_sessions (
    token_hash TEXT PRIMARY KEY NOT NULL, member_id TEXT NOT NULL,
    email TEXT NOT NULL, credential_version TEXT NOT NULL, expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS portal_password_sessions_member_idx ON portal_password_sessions(member_id)`,
  `CREATE TABLE IF NOT EXISTS portal_password_links (
    token_hash TEXT PRIMARY KEY NOT NULL, member_id TEXT NOT NULL, email TEXT NOT NULL,
    expires_at INTEGER NOT NULL, consumed_by TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS portal_password_links_member_idx ON portal_password_links(member_id)`,
  `CREATE TABLE IF NOT EXISTS portal_auth_limits (
    key_hash TEXT PRIMARY KEY NOT NULL, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS portal_auth_limits_expiry_idx ON portal_auth_limits(expires_at)`,
];
