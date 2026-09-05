CREATE TRIGGER IF NOT EXISTS consulting_flows_job_insert_audit_identity_guard
BEFORE INSERT ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.jobs') AS job
  WHERE json_extract(job.value, '$.status') IN ('queued', 'blocked')
    AND (SELECT count(*) FROM json_each(NEW.payload, '$.audit') AS audit
      WHERE json_extract(audit.value, '$.id') || '-job' IS json_extract(job.value, '$.id')
        AND json_extract(audit.value, '$.at') IS NEW.updated_at
        AND json_extract(audit.value, '$.action') IS
          CASE json_extract(job.value, '$.stage')
            WHEN 1 THEN 'queue_report1'
            WHEN 4 THEN 'save_recording'
          END) IS NOT 1
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial job audit identity is invalid');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_job_creation_audit_identity_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.jobs') AS job
  WHERE json_extract(job.value, '$.status') IN ('queued', 'blocked')
    AND NOT EXISTS (
      SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
      WHERE json_extract(previous.value, '$.id') IS json_extract(job.value, '$.id')
    )
    AND (SELECT count(*) FROM json_each(NEW.payload, '$.audit') AS audit
      WHERE audit.key >= json_array_length(OLD.payload, '$.audit')
        AND json_extract(audit.value, '$.id') || '-job' IS json_extract(job.value, '$.id')
        AND json_extract(audit.value, '$.at') IS NEW.updated_at
        AND json_extract(audit.value, '$.action') IS
          CASE json_extract(job.value, '$.stage')
            WHEN 1 THEN 'queue_report1'
            WHEN 4 THEN 'save_recording'
          END) IS NOT 1
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow job creation audit identity is invalid');
END;
