CREATE TRIGGER IF NOT EXISTS consulting_flows_jobs_insert_guard
BEFORE INSERT ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.jobs') AS job
  WHERE COALESCE(json_extract(job.value, '$.status'), '') NOT IN ('queued', 'blocked')
    OR json_type(job.value, '$.startedAt') IS NOT NULL
    OR json_type(job.value, '$.completedAt') IS NOT NULL
    OR json_type(job.value, '$.reportId') IS NOT NULL
    OR json_type(job.value, '$.evidence') IS NOT NULL
    OR json_type(job.value, '$.failureEvidence') IS NOT NULL
    OR json_type(job.value, '$.failureEvidenceHistory') IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial job is invalid');
END;
