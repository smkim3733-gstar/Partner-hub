-- Freeze every existing company-file metadata fact without rewriting legacy values.
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
);

INSERT OR IGNORE INTO company_file_metadata
  (file_id, original_name, company, category, title, assigned_trainee,
   uploaded_by_user_id, uploaded_by_email, content_type, size_bytes, created_at)
SELECT id, original_name, company, category, title, assigned_trainee,
  uploaded_by_user_id, uploaded_by_email, content_type, size_bytes, created_at
FROM company_file_objects
ORDER BY created_at, id;
