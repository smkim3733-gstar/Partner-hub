import {
  AI_DIAGNOSIS_RUN_FIELD_LIMITS,
  AI_PROVIDER_MESSAGE_ID_LIMIT,
  AI_PROVIDER_REQUEST_ID_LIMIT,
  PORTAL_STATE_LIMIT_BYTES,
  STEP_ZERO_MAX_OUTPUT_TOKENS,
  STEP_ZERO_PENDING_LIMIT_BYTES,
  STEP_ZERO_RESULT_LIMIT_BYTES,
} from '@/lib/storage-limits';

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
