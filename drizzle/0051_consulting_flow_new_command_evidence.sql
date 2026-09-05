CREATE TRIGGER IF NOT EXISTS consulting_flows_command_insert_evidence_guard
BEFORE INSERT ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  WHERE (SELECT count(*) FROM json_each(NEW.payload, '$.audit') AS audit
      WHERE json_extract(audit.value, '$.id') IS command.value
        AND json_extract(audit.value, '$.at') IS NEW.updated_at
        AND json_extract(audit.value, '$.action') IS NOT 'ai_result') IS NOT 1
    OR (SELECT count(*) FROM json_each(NEW.payload, '$.commandReceipts') AS receipt
      WHERE receipt.key IS command.value) IS NOT 1
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial command evidence is invalid');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_new_command_evidence_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
    AND ((SELECT count(*) FROM json_each(NEW.payload, '$.audit') AS audit
      WHERE audit.key >= json_array_length(OLD.payload, '$.audit')
        AND json_extract(audit.value, '$.id') IS command.value
        AND json_extract(audit.value, '$.at') IS NEW.updated_at
        AND json_extract(audit.value, '$.action') IS NOT 'ai_result') IS NOT 1
      OR (SELECT count(*) FROM json_each(NEW.payload, '$.commandReceipts') AS receipt
        WHERE receipt.key IS command.value) IS NOT 1)
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow new command evidence is invalid');
END;
