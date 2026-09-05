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

// A missing row denotes a legacy name assignment. An empty member ID explicitly
// means administrator-only and must never fall back to a name match.
export const companyFileAssignmentsTableSql = `
CREATE TABLE IF NOT EXISTS company_file_assignments (
  file_id TEXT PRIMARY KEY NOT NULL REFERENCES company_file_objects(id) ON DELETE CASCADE,
  partner_member_id TEXT NOT NULL
)
`;

export const companyFileCaseLinksTableSql = `
CREATE TABLE IF NOT EXISTS company_file_case_links (
  file_id TEXT PRIMARY KEY NOT NULL REFERENCES company_file_objects(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL
)
`;

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

export const portalStateId = 'keve-partner-hub';

export const applicationDraftsTableSql = `
CREATE TABLE IF NOT EXISTS application_drafts (
  owner_key TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL,
  draft_id TEXT NOT NULL UNIQUE,
  payload TEXT,
  updated_at TEXT NOT NULL
)
`;

export const consultingFlowsTableSql = `
CREATE TABLE IF NOT EXISTS consulting_flows (
  case_id TEXT PRIMARY KEY NOT NULL,
  partner_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
`;

export const consultingFlowFileOwnersTableSql = `
CREATE TABLE IF NOT EXISTS consulting_flow_file_owners (
  file_id TEXT PRIMARY KEY NOT NULL,
  case_id TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
)
`;

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
