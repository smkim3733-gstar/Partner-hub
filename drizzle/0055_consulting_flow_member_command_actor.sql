CREATE TRIGGER IF NOT EXISTS consulting_flows_command_insert_member_actor_guard
BEFORE INSERT ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
    ON receipt.key IS command.value
  WHERE substr(json_extract(receipt.value, '$.actorKey'), 1, 7) = 'member:'
    AND (
      json_extract(receipt.value, '$.actorKey') IS NOT ('member:' || NEW.partner_id)
      OR json_extract(receipt.value, '$.actor') IS NOT json_extract(NEW.payload, '$.partnerName')
    )
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial member command actor is invalid');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_new_command_member_actor_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
    ON receipt.key IS command.value
  WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
    AND substr(json_extract(receipt.value, '$.actorKey'), 1, 7) = 'member:'
    AND (
      json_extract(receipt.value, '$.actorKey') IS NOT ('member:' || NEW.partner_id)
      OR json_extract(receipt.value, '$.actor') IS NOT json_extract(NEW.payload, '$.partnerName')
    )
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow new member command actor is invalid');
END;
