CREATE TRIGGER IF NOT EXISTS consulting_flows_non_command_scope_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) =
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
    WHERE previous.value IS NOT json_extract(
      NEW.payload,
      '$.jobs[' || previous.key || ']'
    )
  )
  AND (
    json_extract(NEW.payload, '$.company') IS NOT json_extract(OLD.payload, '$.company')
    OR json_extract(NEW.payload, '$.partnerName') IS NOT json_extract(OLD.payload, '$.partnerName')
    OR json_extract(NEW.payload, '$.meetings') IS NOT json_extract(OLD.payload, '$.meetings')
    OR json_extract(NEW.payload, '$.recordings') IS NOT json_extract(OLD.payload, '$.recordings')
    OR json_extract(NEW.payload, '$.requests') IS NOT json_extract(OLD.payload, '$.requests')
    OR json_extract(NEW.payload, '$.decision') IS NOT json_extract(OLD.payload, '$.decision')
    OR json_extract(NEW.payload, '$.contract') IS NOT json_extract(OLD.payload, '$.contract')
    OR json_extract(NEW.payload, '$.payments') IS NOT json_extract(OLD.payload, '$.payments')
    OR json_extract(NEW.payload, '$.executionStartedAt') IS NOT json_extract(OLD.payload, '$.executionStartedAt')
    OR json_extract(NEW.payload, '$.aftercare') IS NOT json_extract(OLD.payload, '$.aftercare')
    OR json_extract(NEW.payload, '$.ai') IS NOT json_extract(OLD.payload, '$.ai')
    OR (
      NOT EXISTS (
        SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
        WHERE json_extract(previous.value, '$.status') IS 'processing'
          AND json_extract(
            NEW.payload,
            '$.jobs[' || previous.key || '].status'
          ) IS 'complete'
      )
      AND (
        json_extract(NEW.payload, '$.reports') IS NOT json_extract(OLD.payload, '$.reports')
        OR json_extract(NEW.payload, '$.files') IS NOT json_extract(OLD.payload, '$.files')
        OR json_extract(NEW.payload, '$.analysis') IS NOT json_extract(OLD.payload, '$.analysis')
      )
    )
    OR (
      NOT EXISTS (
        SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
        WHERE json_extract(previous.value, '$.status') IS 'processing'
          AND json_extract(
            NEW.payload,
            '$.jobs[' || previous.key || '].status'
          ) IN ('blocked', 'failed', 'complete')
        OR json_extract(previous.value, '$.status') IN ('blocked', 'failed', 'processing')
          AND json_extract(
            NEW.payload,
            '$.jobs[' || previous.key || '].status'
          ) IS 'queued'
      )
      AND json_extract(NEW.payload, '$.audit') IS NOT json_extract(OLD.payload, '$.audit')
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow non-command scope is invalid');
END;
