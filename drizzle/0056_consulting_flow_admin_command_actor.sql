CREATE TRIGGER IF NOT EXISTS consulting_flows_command_insert_admin_actor_guard
BEFORE INSERT ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
    ON receipt.key IS command.value
  WHERE substr(json_extract(receipt.value, '$.actorKey'), 1, 6) = 'admin:'
    AND json_extract(receipt.value, '$.actorKey') IS NOT 'admin:primary'
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial admin command actor is invalid');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_new_command_admin_actor_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
    ON receipt.key IS command.value
  WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
    AND substr(json_extract(receipt.value, '$.actorKey'), 1, 6) = 'admin:'
    AND json_extract(receipt.value, '$.actorKey') IS NOT 'admin:primary'
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow new admin command actor is invalid');
END;
