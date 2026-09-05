-- Immutable metadata for FLOW files, additive after the ownership ledger.
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
);

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
ORDER BY owner.created_at, candidate.case_id;
