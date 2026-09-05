-- Bind FLOW files to native R2 metadata. Legacy objects keep explicit metadata-only mode.
CREATE TABLE IF NOT EXISTS consulting_flow_file_object_integrity (
  file_id TEXT PRIMARY KEY NOT NULL,
  validation_mode TEXT NOT NULL CHECK (validation_mode IN ('metadata', 'etag')),
  r2_etag TEXT,
  r2_content_type TEXT NOT NULL,
  CHECK ((validation_mode = 'metadata' AND r2_etag IS NULL) OR
    (validation_mode = 'etag' AND length(r2_etag) BETWEEN 1 AND 256))
);

INSERT OR IGNORE INTO consulting_flow_file_object_integrity
  (file_id, validation_mode, r2_etag, r2_content_type)
SELECT metadata.file_id, 'metadata', NULL, metadata.content_type
FROM consulting_flow_file_metadata metadata
JOIN consulting_flow_file_owners owner ON owner.file_id = metadata.file_id
ORDER BY owner.created_at, metadata.file_id;
