CREATE TRIGGER IF NOT EXISTS consulting_flows_command_insert_semantics_guard
BEFORE INSERT ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  WHERE (SELECT count(*) FROM json_each(NEW.payload, '$.audit') AS audit
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE json_extract(audit.value, '$.id') IS command.value
        AND json_extract(audit.value, '$.at') IS NEW.updated_at
        AND json_extract(audit.value, '$.action') IS NOT 'ai_result'
        AND json_extract(receipt.value, '$.actor') IS json_extract(audit.value, '$.actor')
        AND json_extract(receipt.value, '$.action') IS json_extract(audit.value, '$.action')
        AND json_type(receipt.value, '$.actor') = 'text'
        AND json_type(receipt.value, '$.action') = 'text') IS NOT 1
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial command semantics are invalid');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_command_semantics_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(OLD.payload, '$.commandReceipts') AS previous
  JOIN json_each(NEW.payload, '$.commandReceipts') AS current
    ON current.key IS previous.key
  WHERE json_extract(current.value, '$.actor') IS NOT json_extract(previous.value, '$.actor')
    OR json_extract(current.value, '$.action') IS NOT json_extract(previous.value, '$.action')
)
OR EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
    AND (SELECT count(*) FROM json_each(NEW.payload, '$.audit') AS audit
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE audit.key >= json_array_length(OLD.payload, '$.audit')
        AND json_extract(audit.value, '$.id') IS command.value
        AND json_extract(audit.value, '$.at') IS NEW.updated_at
        AND json_extract(audit.value, '$.action') IS NOT 'ai_result'
        AND json_extract(receipt.value, '$.actor') IS json_extract(audit.value, '$.actor')
        AND json_extract(receipt.value, '$.action') IS json_extract(audit.value, '$.action')
        AND json_type(receipt.value, '$.actor') = 'text'
        AND json_type(receipt.value, '$.action') = 'text') IS NOT 1
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow command semantics are invalid');
END;
