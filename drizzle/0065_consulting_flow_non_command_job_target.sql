CREATE TRIGGER IF NOT EXISTS consulting_flows_non_command_job_target_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) =
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND json_extract(NEW.payload, '$.jobs') IS NOT
    json_extract(OLD.payload, '$.jobs')
  AND (
    COALESCE(json_array_length(NEW.payload, '$.jobs'), -1) <>
      COALESCE(json_array_length(OLD.payload, '$.jobs'), -1)
    OR EXISTS (
      SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
      WHERE json_extract(
        NEW.payload,
        '$.jobs[' || previous.key || '].id'
      ) IS NOT json_extract(previous.value, '$.id')
    )
    OR (
      SELECT count(*) FROM json_each(OLD.payload, '$.jobs') AS previous
      WHERE previous.value IS NOT json_extract(
        NEW.payload,
        '$.jobs[' || previous.key || ']'
      )
    ) <> 1
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow non-command job target is invalid');
END;
