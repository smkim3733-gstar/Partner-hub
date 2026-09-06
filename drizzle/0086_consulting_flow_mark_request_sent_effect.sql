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
        'complete_meeting', 'cancel_meeting', 'mark_request_sent'
      ) THEN
        json_type(receipt.value, '$.targetId') IS NOT 'text'
        OR length(json_extract(receipt.value, '$.targetId')) NOT BETWEEN 1 AND 200
      ELSE json_type(receipt.value, '$.targetId') IS NOT NULL
    END
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow new command receipt target is invalid');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_mark_request_sent_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(id, actor_key, action, target_id) AS (
      SELECT command.value,
        json_extract(receipt.value, '$.actorKey'),
        json_extract(receipt.value, '$.action'),
        json_extract(receipt.value, '$.targetId')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), previous_request(key, value) AS (
      SELECT request.key, request.value
      FROM command, json_each(OLD.payload, '$.requests') AS request
      WHERE json_extract(request.value, '$.id') IS command.target_id
    ), current_request(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.requests[' || previous_request.key || ']'
      )
      FROM previous_request
    )
    SELECT 1 FROM command
    WHERE command.action IS 'mark_request_sent'
      AND (
        NOT (
          command.actor_key IS 'admin:primary'
          OR command.actor_key IS
            ('member:' || json_extract(OLD.payload, '$.partnerId'))
        )
        OR typeof(command.target_id) <> 'text'
        OR length(command.target_id) NOT BETWEEN 1 AND 200
        OR (SELECT count(*) FROM previous_request) IS NOT 1
        OR json_array_length(NEW.payload, '$.requests') IS NOT
          json_array_length(OLD.payload, '$.requests')
        OR (
          SELECT count(*)
          FROM json_each(OLD.payload, '$.requests') AS previous
          WHERE previous.value IS NOT json_extract(
            NEW.payload,
            '$.requests[' || previous.key || ']'
          )
        ) IS NOT 1
        OR EXISTS (
          SELECT 1
          FROM json_each(OLD.payload, '$.requests') AS previous
          WHERE previous.value IS NOT json_extract(
            NEW.payload,
            '$.requests[' || previous.key || ']'
          )
            AND json_extract(previous.value, '$.id') IS NOT command.target_id
        )
        OR json_extract(
          (SELECT value FROM current_request), '$.id'
        ) IS NOT command.target_id
        OR json_remove(
          (SELECT value FROM previous_request), '$.sentAt'
        ) IS NOT json_remove(
          (SELECT value FROM current_request), '$.sentAt'
        )
        OR json_extract(
          (SELECT value FROM current_request), '$.sentAt'
        ) IS NOT NEW.updated_at
        OR (
          SELECT count(*)
          FROM json_each(NEW.payload, '$.audit') AS audit
          WHERE json_extract(audit.value, '$.id') IS command.id
            AND json_extract(audit.value, '$.at') IS NEW.updated_at
            AND json_extract(audit.value, '$.action') IS 'mark_request_sent'
            AND json_extract(audit.value, '$.detail') IS (
              json_extract(
                (SELECT value FROM previous_request), '$.channel'
              ) || ' 서류요청 실제 발송 기록'
            )
        ) IS NOT 1
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow mark request sent effect is invalid');
END;
