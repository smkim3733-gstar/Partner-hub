CREATE TRIGGER IF NOT EXISTS consulting_flows_command_history_guard
BEFORE UPDATE ON consulting_flows
WHEN json_array_length(NEW.payload, '$.commandIds') < json_array_length(OLD.payload, '$.commandIds')
  OR EXISTS (
    SELECT 1 FROM json_each(OLD.payload, '$.commandIds') AS previous
    WHERE json_extract(NEW.payload, '$.commandIds[' || previous.key || ']') IS NOT previous.value
  )
  OR EXISTS (
    SELECT 1 FROM json_each(OLD.payload, '$.commandReceipts') AS previous
    WHERE NOT EXISTS (
      SELECT 1 FROM json_each(NEW.payload, '$.commandReceipts') AS current
      WHERE current.key IS previous.key
        AND json_extract(current.value, '$.actorKey') IS json_extract(previous.value, '$.actorKey')
        AND json_extract(current.value, '$.fingerprint') IS json_extract(previous.value, '$.fingerprint')
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow command history is immutable');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_job_insert_command_guard
BEFORE INSERT ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.jobs') AS job
  WHERE json_extract(job.value, '$.status') IN ('queued', 'blocked')
    AND (SELECT count(*) FROM json_each(NEW.payload, '$.commandIds') AS command
      WHERE command.value || '-job' IS json_extract(job.value, '$.id')) IS NOT 1
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial job command identity is invalid');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_job_creation_command_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.jobs') AS job
  WHERE json_extract(job.value, '$.status') IN ('queued', 'blocked')
    AND NOT EXISTS (
      SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
      WHERE json_extract(previous.value, '$.id') IS json_extract(job.value, '$.id')
    )
    AND (SELECT count(*) FROM json_each(NEW.payload, '$.commandIds') AS command
      WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
        AND command.value || '-job' IS json_extract(job.value, '$.id')) IS NOT 1
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow job creation command identity is invalid');
END;
