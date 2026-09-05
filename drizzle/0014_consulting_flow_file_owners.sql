-- Durable ownership and immutable metadata for FLOW R2 objects.
CREATE TABLE IF NOT EXISTS consulting_flow_file_owners (
  file_id TEXT PRIMARY KEY NOT NULL,
  case_id TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  purpose TEXT NOT NULL,
  intake_file_id TEXT,
  intake_source_hash TEXT,
  source_reviewed_at TEXT,
  source_reviewed_by TEXT
);

CREATE INDEX IF NOT EXISTS consulting_flow_file_owners_case_idx
ON consulting_flow_file_owners (case_id);

WITH flow_files AS (
  SELECT flow.case_id AS case_id, json_extract(file.value, '$.id') AS file_id,
    json_extract(file.value, '$.key') AS storage_key,
    json_extract(file.value, '$.name') AS original_name,
    json_extract(file.value, '$.contentType') AS content_type,
    json_extract(file.value, '$.size') AS size_bytes,
    json_extract(file.value, '$.createdAt') AS created_at,
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
    AND json_type(file.value, '$.createdAt') = 'text'
    AND json_type(file.value, '$.purpose') = 'text'
    AND (json_type(file.value, '$.intakeFileId') IS NULL OR json_type(file.value, '$.intakeFileId') = 'text')
    AND (json_type(file.value, '$.intakeSourceHash') IS NULL OR json_type(file.value, '$.intakeSourceHash') = 'text')
    AND (json_type(file.value, '$.sourceReviewedAt') IS NULL OR json_type(file.value, '$.sourceReviewedAt') = 'text')
    AND (json_type(file.value, '$.sourceReviewedBy') IS NULL OR json_type(file.value, '$.sourceReviewedBy') = 'text')
)
INSERT OR IGNORE INTO consulting_flow_file_owners
  (file_id, case_id, storage_key, original_name, content_type, size_bytes,
    created_at, purpose, intake_file_id, intake_source_hash,
    source_reviewed_at, source_reviewed_by)
SELECT candidate.file_id, candidate.case_id, candidate.storage_key,
  candidate.original_name, candidate.content_type, candidate.size_bytes,
  candidate.created_at, candidate.purpose, candidate.intake_file_id,
  candidate.intake_source_hash, candidate.source_reviewed_at,
  candidate.source_reviewed_by
FROM flow_files candidate
WHERE NOT EXISTS (SELECT 1 FROM flow_files other
  WHERE other.case_id <> candidate.case_id AND
    (other.file_id = candidate.file_id OR other.storage_key = candidate.storage_key))
ORDER BY candidate.created_at, candidate.case_id;
