-- Durable ownership for FLOW R2 objects. Existing files keep their original keys.
CREATE TABLE IF NOT EXISTS consulting_flow_file_owners (
  file_id TEXT PRIMARY KEY NOT NULL,
  case_id TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS consulting_flow_file_owners_case_idx
ON consulting_flow_file_owners (case_id);

WITH flow_files AS (
  SELECT flow.case_id AS case_id, json_extract(file.value, '$.id') AS file_id,
    json_extract(file.value, '$.key') AS storage_key,
    json_extract(file.value, '$.createdAt') AS created_at
  FROM consulting_flows flow,
    json_each(CASE WHEN json_valid(flow.payload) THEN flow.payload ELSE '{"files":[]}' END, '$.files') file
  WHERE json_type(file.value, '$.id') = 'text'
    AND json_type(file.value, '$.key') = 'text'
    AND json_type(file.value, '$.createdAt') = 'text'
)
INSERT OR IGNORE INTO consulting_flow_file_owners
  (file_id, case_id, storage_key, created_at)
SELECT candidate.file_id, candidate.case_id, candidate.storage_key,
  candidate.created_at
FROM flow_files candidate
WHERE NOT EXISTS (SELECT 1 FROM flow_files other
  WHERE other.case_id <> candidate.case_id AND
    (other.file_id = candidate.file_id OR other.storage_key = candidate.storage_key))
ORDER BY candidate.created_at, candidate.case_id;
