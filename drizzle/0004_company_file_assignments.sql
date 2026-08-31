-- Additive only: legacy file rows and R2 objects are not modified or reassigned.
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
);

CREATE INDEX IF NOT EXISTS company_file_objects_owner_idx
ON company_file_objects (assigned_trainee, created_at);

CREATE INDEX IF NOT EXISTS company_file_objects_company_idx
ON company_file_objects (company, created_at);

CREATE TABLE IF NOT EXISTS company_file_assignments (
  file_id TEXT PRIMARY KEY NOT NULL REFERENCES company_file_objects(id) ON DELETE CASCADE,
  partner_member_id TEXT NOT NULL
);
