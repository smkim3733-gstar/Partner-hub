CREATE TRIGGER IF NOT EXISTS consulting_flows_command_ai_transition_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    SELECT 1
    FROM json_each(OLD.payload, '$.jobs') AS previous
    JOIN json_each(NEW.payload, '$.jobs') AS next
      ON json_extract(next.value, '$.id') IS json_extract(previous.value, '$.id')
    WHERE (json_extract(previous.value, '$.status') IS 'queued'
        AND json_extract(next.value, '$.status') IS 'processing')
      OR (json_extract(previous.value, '$.status') IS 'processing'
        AND json_extract(next.value, '$.status') IN ('blocked', 'failed', 'complete'))
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow command AI transition is invalid');
END;
