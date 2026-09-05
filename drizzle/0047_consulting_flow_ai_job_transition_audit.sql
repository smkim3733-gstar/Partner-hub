CREATE TRIGGER IF NOT EXISTS consulting_flows_job_transition_audit_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1
  FROM json_each(OLD.payload, '$.jobs') AS previous
  JOIN json_each(NEW.payload, '$.jobs') AS next
    ON json_extract(next.value, '$.id') IS json_extract(previous.value, '$.id')
  WHERE (json_extract(previous.value, '$.status') = 'processing'
      AND json_extract(next.value, '$.status') IN ('blocked', 'failed', 'complete')
      AND (SELECT count(*) FROM json_each(NEW.payload, '$.audit') AS audit
        WHERE audit.key >= json_array_length(OLD.payload, '$.audit')
          AND json_extract(audit.value, '$.id') = json_extract(next.value, '$.id') || '-' || NEW.updated_at
          AND json_extract(audit.value, '$.at') = NEW.updated_at
          AND json_extract(audit.value, '$.actor') = '보고서 자동생성'
          AND json_extract(audit.value, '$.action') = 'ai_result') <> 1)
    OR (json_extract(previous.value, '$.status') IN ('blocked', 'failed', 'processing')
      AND json_extract(next.value, '$.status') = 'queued'
      AND (SELECT count(*) FROM json_each(OLD.payload, '$.jobs') AS retry_previous
        JOIN json_each(NEW.payload, '$.jobs') AS retry_next
          ON json_extract(retry_next.value, '$.id') IS json_extract(retry_previous.value, '$.id')
        WHERE json_extract(retry_previous.value, '$.status') IN ('blocked', 'failed', 'processing')
          AND json_extract(retry_next.value, '$.status') = 'queued') IS NOT
        (SELECT count(*) FROM json_each(NEW.payload, '$.audit') AS audit
          WHERE audit.key >= json_array_length(OLD.payload, '$.audit')
            AND json_extract(audit.value, '$.at') = NEW.updated_at
            AND json_extract(audit.value, '$.action') IN ('retry_job', 'save_transcript')))
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow job transition audit is invalid');
END;
