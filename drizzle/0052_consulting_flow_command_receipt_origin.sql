CREATE TRIGGER IF NOT EXISTS consulting_flows_command_receipt_origin_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandReceipts') AS receipt
  WHERE NOT EXISTS (
    SELECT 1 FROM json_each(OLD.payload, '$.commandReceipts') AS previous
    WHERE previous.key IS receipt.key
  ) AND NOT EXISTS (
    SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
    WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
      AND command.value IS receipt.key
  )
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow command receipt origin is invalid');
END;
