DROP TRIGGER IF EXISTS consulting_flows_new_command_receipt_target_guard;

CREATE TRIGGER IF NOT EXISTS consulting_flows_new_command_receipt_target_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
    ON receipt.key IS command.value
  WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
    AND CASE
      WHEN json_extract(receipt.value, '$.action') IN (
        'complete_meeting', 'cancel_meeting', 'mark_request_sent',
        'receive_document', 'review_document', 'record_contract',
        'save_transcript'
      ) THEN
        json_type(receipt.value, '$.targetId') IS NOT 'text'
        OR length(json_extract(receipt.value, '$.targetId')) NOT BETWEEN 1 AND 200
      ELSE json_type(receipt.value, '$.targetId') IS NOT NULL
    END
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow new command receipt target is invalid');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_save_transcript_target_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(action, target_id) AS (
      SELECT json_extract(receipt.value, '$.action'),
        json_extract(receipt.value, '$.targetId')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    )
    SELECT 1 FROM command
    WHERE command.action IS 'save_transcript'
      AND (
        typeof(command.target_id) <> 'text'
        OR length(command.target_id) NOT BETWEEN 1 AND 200
        OR command.target_id IS NOT json_extract(
          OLD.payload,
          '$.recordings[' ||
            (json_array_length(OLD.payload, '$.recordings') - 1) || '].id'
        )
        OR command.target_id IS NOT json_extract(
          NEW.payload,
          '$.recordings[' ||
            (json_array_length(NEW.payload, '$.recordings') - 1) || '].id'
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow save transcript target is invalid');
END;
