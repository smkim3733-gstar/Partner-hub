-- Additive only. Existing files remain unlinked; do not infer historical case IDs.
CREATE TABLE IF NOT EXISTS company_file_case_links (
  file_id TEXT PRIMARY KEY NOT NULL REFERENCES company_file_objects(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL
);
