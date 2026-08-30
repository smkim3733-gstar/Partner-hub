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
