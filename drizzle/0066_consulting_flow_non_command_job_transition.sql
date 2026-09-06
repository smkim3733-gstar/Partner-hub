CREATE TRIGGER IF NOT EXISTS consulting_flows_non_command_job_transition_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) =
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND json_array_length(NEW.payload, '$.jobs') =
    json_array_length(OLD.payload, '$.jobs')
  AND NOT EXISTS (
    SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
    WHERE json_extract(
      NEW.payload,
      '$.jobs[' || previous.key || '].id'
    ) IS NOT json_extract(previous.value, '$.id')
  )
  AND (
    SELECT count(*) FROM json_each(OLD.payload, '$.jobs') AS previous
    WHERE previous.value IS NOT json_extract(
      NEW.payload,
      '$.jobs[' || previous.key || ']'
    )
  ) = 1
  AND EXISTS (
    SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
    WHERE previous.value IS NOT json_extract(
        NEW.payload,
        '$.jobs[' || previous.key || ']'
      )
      AND json_extract(previous.value, '$.status') IS NOT json_extract(
        NEW.payload,
        '$.jobs[' || previous.key || '].status'
      )
      AND NOT (
        json_extract(previous.value, '$.status') IS 'queued'
          AND json_extract(
            NEW.payload,
            '$.jobs[' || previous.key || '].status'
          ) IN ('processing', 'blocked')
        OR json_extract(previous.value, '$.status') IS 'processing'
          AND json_extract(
            NEW.payload,
            '$.jobs[' || previous.key || '].status'
          ) IN ('blocked', 'failed', 'complete')
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow non-command job transition is invalid');
END;
