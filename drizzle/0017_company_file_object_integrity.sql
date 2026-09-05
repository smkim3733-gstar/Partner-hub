-- Bind company source files to native R2 metadata. Legacy objects keep explicit metadata-only mode.
CREATE TABLE IF NOT EXISTS company_file_object_integrity (
  file_id TEXT PRIMARY KEY NOT NULL REFERENCES company_file_objects(id) ON DELETE CASCADE,
  validation_mode TEXT NOT NULL CHECK (validation_mode IN ('metadata', 'etag')),
  r2_etag TEXT,
  r2_content_type TEXT NOT NULL,
  CHECK ((validation_mode = 'metadata' AND r2_etag IS NULL) OR
    (validation_mode = 'etag' AND length(r2_etag) BETWEEN 1 AND 256))
);

INSERT OR IGNORE INTO company_file_object_integrity
  (file_id, validation_mode, r2_etag, r2_content_type)
SELECT id, 'metadata', NULL, content_type
FROM company_file_objects
ORDER BY created_at, id;
