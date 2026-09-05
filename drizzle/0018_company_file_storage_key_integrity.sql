-- Freeze the existing R2 key for every company file without rewriting legacy object locations.
CREATE TABLE IF NOT EXISTS company_file_storage_keys (
  file_id TEXT PRIMARY KEY NOT NULL REFERENCES company_file_objects(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE
);

INSERT OR IGNORE INTO company_file_storage_keys (file_id, storage_key)
SELECT id, storage_key
FROM company_file_objects
ORDER BY created_at, id;
