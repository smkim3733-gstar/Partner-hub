CREATE TRIGGER IF NOT EXISTS consulting_flows_job_transition_timestamp_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1
  FROM json_each(OLD.payload, '$.jobs') AS previous
  JOIN json_each(NEW.payload, '$.jobs') AS next
    ON json_extract(next.value, '$.id') IS json_extract(previous.value, '$.id')
  WHERE (json_extract(previous.value, '$.status') = 'queued'
      AND json_extract(next.value, '$.status') = 'processing'
      AND json_extract(next.value, '$.startedAt') IS NOT NEW.updated_at)
    OR (json_extract(previous.value, '$.status') = 'processing'
      AND json_extract(next.value, '$.status') = 'complete'
      AND json_extract(next.value, '$.completedAt') IS NOT NEW.updated_at)
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow job transition timestamp is invalid');
END;
