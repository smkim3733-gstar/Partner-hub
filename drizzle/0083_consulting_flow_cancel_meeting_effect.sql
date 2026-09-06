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
        'complete_meeting', 'cancel_meeting'
      ) THEN
        json_type(receipt.value, '$.targetId') IS NOT 'text'
        OR length(json_extract(receipt.value, '$.targetId')) NOT BETWEEN 1 AND 200
      ELSE json_type(receipt.value, '$.targetId') IS NOT NULL
    END
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow new command receipt target is invalid');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_cancel_meeting_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(actor_key, action, target_id) AS (
      SELECT json_extract(receipt.value, '$.actorKey'),
        json_extract(receipt.value, '$.action'),
        json_extract(receipt.value, '$.targetId')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), target(position, previous_value, next_value) AS (
      SELECT previous.key,
        previous.value,
        json_extract(
          NEW.payload,
          '$.meetings[' || previous.key || ']'
        )
      FROM json_each(OLD.payload, '$.meetings') AS previous
      CROSS JOIN command
      WHERE json_extract(previous.value, '$.id') IS command.target_id
    )
    SELECT 1 FROM command
    WHERE command.action IS 'cancel_meeting'
      AND (
        (SELECT count(*) FROM target) IS NOT 1
        OR json_array_length(NEW.payload, '$.meetings') IS NOT
          json_array_length(OLD.payload, '$.meetings')
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.meetings') AS previous
          WHERE json_extract(previous.value, '$.id') IS NOT command.target_id
            AND json(json_extract(
              NEW.payload,
              '$.meetings[' || previous.key || ']'
            )) IS NOT json(previous.value)
        )
        OR EXISTS (
          SELECT 1 FROM target
          WHERE json_extract(previous_value, '$.status') IS NOT 'scheduled'
            OR json_type(previous_value, '$.completedAt') IS NOT NULL
            OR json_extract(next_value, '$.status') IS NOT 'cancelled'
            OR json_type(next_value, '$.completedAt') IS NOT NULL
            OR json_remove(
              json(next_value), '$.status', '$.note'
            ) IS NOT json_remove(
              json(previous_value), '$.status', '$.note'
            )
            OR json_type(next_value, '$.note') IS NOT 'text'
            OR length(json_extract(next_value, '$.note')) > 1500
            OR (
              json_extract(next_value, '$.note') IS NOT
                json_extract(previous_value, '$.note')
              AND (
                length(json_extract(next_value, '$.note')) = 0
                OR json_extract(next_value, '$.note') IS NOT
                  trim(json_extract(next_value, '$.note'))
              )
            )
            OR NOT (
              command.actor_key IS 'admin:primary'
              OR (
                command.actor_key IS
                  ('member:' || json_extract(OLD.payload, '$.partnerId'))
                AND json_extract(previous_value, '$.attendance') IN (
                  'both', 'partner'
                )
              )
            )
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow cancel meeting effect is invalid');
END;
