CREATE TRIGGER IF NOT EXISTS consulting_flows_command_insert_receipt_identity_guard
BEFORE INSERT ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
    ON receipt.key IS command.value
  WHERE COALESCE(json_type(receipt.value, '$.fingerprint'), '') <> 'text'
    OR length(json_extract(receipt.value, '$.fingerprint')) <> 64
    OR json_extract(receipt.value, '$.fingerprint') GLOB '*[^0-9a-f]*'
    OR COALESCE(json_type(receipt.value, '$.actorKey'), '') <> 'text'
    OR length(json_extract(receipt.value, '$.actorKey')) NOT BETWEEN 8 AND 500
    OR NOT (
      substr(json_extract(receipt.value, '$.actorKey'), 1, 6) = 'admin:'
      OR substr(json_extract(receipt.value, '$.actorKey'), 1, 7) = 'member:'
    )
    OR instr(json_extract(receipt.value, '$.actorKey'), char(9)) > 0
    OR instr(json_extract(receipt.value, '$.actorKey'), char(10)) > 0
    OR instr(json_extract(receipt.value, '$.actorKey'), char(13)) > 0
    OR instr(json_extract(receipt.value, '$.actorKey'), ' ') > 0
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial command receipt identity is invalid');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_new_command_receipt_identity_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
    ON receipt.key IS command.value
  WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
    AND (
      COALESCE(json_type(receipt.value, '$.fingerprint'), '') <> 'text'
      OR length(json_extract(receipt.value, '$.fingerprint')) <> 64
      OR json_extract(receipt.value, '$.fingerprint') GLOB '*[^0-9a-f]*'
      OR COALESCE(json_type(receipt.value, '$.actorKey'), '') <> 'text'
      OR length(json_extract(receipt.value, '$.actorKey')) NOT BETWEEN 8 AND 500
      OR NOT (
        substr(json_extract(receipt.value, '$.actorKey'), 1, 6) = 'admin:'
        OR substr(json_extract(receipt.value, '$.actorKey'), 1, 7) = 'member:'
      )
      OR instr(json_extract(receipt.value, '$.actorKey'), char(9)) > 0
      OR instr(json_extract(receipt.value, '$.actorKey'), char(10)) > 0
      OR instr(json_extract(receipt.value, '$.actorKey'), char(13)) > 0
      OR instr(json_extract(receipt.value, '$.actorKey'), ' ') > 0
    )
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow new command receipt identity is invalid');
END;
