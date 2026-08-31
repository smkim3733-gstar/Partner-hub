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

// A missing row denotes a legacy name assignment. An empty member ID explicitly
// means administrator-only and must never fall back to a name match.
export const companyFileAssignmentsTableSql = `
CREATE TABLE IF NOT EXISTS company_file_assignments (
  file_id TEXT PRIMARY KEY NOT NULL REFERENCES company_file_objects(id) ON DELETE CASCADE,
  partner_member_id TEXT NOT NULL
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

export const portalStateId = 'keve-partner-hub';

export const consultingFlowsTableSql = `
CREATE TABLE IF NOT EXISTS consulting_flows (
  case_id TEXT PRIMARY KEY NOT NULL,
  partner_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
`;

// Credentials and tokens must never be included in the client-facing portal_state JSON.
export const portalPasswordSchemaSql = [
  `CREATE TABLE IF NOT EXISTS portal_password_accounts (
    member_id TEXT PRIMARY KEY NOT NULL, email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, credential_version TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
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
