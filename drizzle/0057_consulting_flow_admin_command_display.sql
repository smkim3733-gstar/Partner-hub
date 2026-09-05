CREATE TRIGGER IF NOT EXISTS consulting_flows_command_insert_admin_display_guard
BEFORE INSERT ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
    ON receipt.key IS command.value
  WHERE substr(json_extract(receipt.value, '$.actorKey'), 1, 6) = 'admin:'
    AND json_extract(receipt.value, '$.actor') IS NOT '김성민 대표'
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial admin command display is invalid');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_new_command_admin_display_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
    ON receipt.key IS command.value
  WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
    AND substr(json_extract(receipt.value, '$.actorKey'), 1, 6) = 'admin:'
    AND json_extract(receipt.value, '$.actor') IS NOT '김성민 대표'
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow new admin command display is invalid');
END;
