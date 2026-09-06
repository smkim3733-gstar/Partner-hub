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
        'receive_document'
      ) THEN
        json_type(receipt.value, '$.targetId') IS NOT 'text'
        OR length(json_extract(receipt.value, '$.targetId')) NOT BETWEEN 1 AND 200
      ELSE json_type(receipt.value, '$.targetId') IS NOT NULL
    END
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow new command receipt target is invalid');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_receive_document_effect_guard
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
    ), previous_file(value) AS (
      SELECT file.value
      FROM current_request, json_each(OLD.payload, '$.files') AS file
      WHERE json_extract(file.value, '$.id') IS
        json_extract(current_request.value, '$.fileId')
    ), current_file(value) AS (
      SELECT file.value
      FROM current_request, json_each(NEW.payload, '$.files') AS file
      WHERE json_extract(file.value, '$.id') IS
        json_extract(current_request.value, '$.fileId')
    ), new_file(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.files[' || json_array_length(OLD.payload, '$.files') || ']'
      )
    )
    SELECT 1 FROM command
    WHERE command.action IS 'receive_document'
      AND (
        NOT (
          command.actor_key IS 'admin:primary'
          OR command.actor_key IS
            ('member:' || json_extract(OLD.payload, '$.partnerId'))
        )
        OR typeof(command.target_id) <> 'text'
        OR length(command.target_id) NOT BETWEEN 1 AND 200
        OR json_type(OLD.payload, '$.contract') IS NOT NULL
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
          (SELECT value FROM previous_request),
          '$.fileId', '$.status', '$.receivedAt', '$.reviewedAt',
          '$.verifiedAt', '$.note'
        ) IS NOT json_remove(
          (SELECT value FROM current_request),
          '$.fileId', '$.status', '$.receivedAt', '$.reviewedAt',
          '$.verifiedAt', '$.note'
        )
        OR json_extract(
          (SELECT value FROM current_request), '$.status'
        ) IS NOT 'received'
        OR json_type(
          (SELECT value FROM current_request), '$.fileId'
        ) IS NOT 'text'
        OR length(json_extract(
          (SELECT value FROM current_request), '$.fileId'
        )) NOT BETWEEN 1 AND 200
        OR json_type(
          (SELECT value FROM current_request), '$.note'
        ) IS NOT 'text'
        OR length(json_extract(
          (SELECT value FROM current_request), '$.note'
        )) > 1000
        OR trim(
          json_extract((SELECT value FROM current_request), '$.note'),
          char(9) || char(10) || char(11) || char(12) || char(13) ||
          char(32) || char(160) || char(5760) || char(8192) || char(8193) ||
          char(8194) || char(8195) || char(8196) || char(8197) || char(8198) ||
          char(8199) || char(8200) || char(8201) || char(8202) || char(8232) ||
          char(8233) || char(8239) || char(8287) || char(12288) || char(65279)
        ) IS NOT json_extract(
          (SELECT value FROM current_request), '$.note'
        )
        OR CASE
          WHEN json_extract(
            (SELECT value FROM previous_request), '$.fileId'
          ) IS NOT json_extract(
            (SELECT value FROM current_request), '$.fileId'
          ) OR json_extract(
            (SELECT value FROM previous_request), '$.status'
          ) IS NOT 'received'
          THEN
            json_extract(
              (SELECT value FROM current_request), '$.receivedAt'
            ) IS NOT NEW.updated_at
            OR json_type(
              (SELECT value FROM current_request), '$.reviewedAt'
            ) IS NOT NULL
            OR json_type(
              (SELECT value FROM current_request), '$.verifiedAt'
            ) IS NOT NULL
          ELSE
            json_extract(
              (SELECT value FROM current_request), '$.receivedAt'
            ) IS NOT json_extract(
              (SELECT value FROM previous_request), '$.receivedAt'
            )
            OR json_extract(
              (SELECT value FROM current_request), '$.reviewedAt'
            ) IS NOT json_extract(
              (SELECT value FROM previous_request), '$.reviewedAt'
            )
            OR json_extract(
              (SELECT value FROM current_request), '$.verifiedAt'
            ) IS NOT json_extract(
              (SELECT value FROM previous_request), '$.verifiedAt'
            )
        END
        OR (SELECT count(*) FROM current_file) IS NOT 1
        OR json_extract(
          (SELECT value FROM current_file), '$.purpose'
        ) IS NOT 'requested_document'
        OR (SELECT count(*) FROM previous_file) NOT IN (0, 1)
        OR CASE
          WHEN (SELECT count(*) FROM previous_file) = 1 THEN
            json_array_length(NEW.payload, '$.files') IS NOT
              json_array_length(OLD.payload, '$.files')
            OR EXISTS (
              SELECT 1
              FROM json_each(OLD.payload, '$.files') AS previous
              WHERE previous.value IS NOT json_extract(
                NEW.payload,
                '$.files[' || previous.key || ']'
              )
            )
          ELSE
            json_array_length(NEW.payload, '$.files') IS NOT
              json_array_length(OLD.payload, '$.files') + 1
            OR EXISTS (
              SELECT 1
              FROM json_each(OLD.payload, '$.files') AS previous
              WHERE previous.value IS NOT json_extract(
                NEW.payload,
                '$.files[' || previous.key || ']'
              )
            )
            OR json_extract(
              (SELECT value FROM new_file), '$.id'
            ) IS NOT json_extract(
              (SELECT value FROM current_request), '$.fileId'
            )
            OR json_extract(
              (SELECT value FROM new_file), '$.purpose'
            ) IS NOT 'requested_document'
            OR json_extract(
              (SELECT value FROM new_file), '$.createdAt'
            ) IS NOT NEW.updated_at
            OR json_type(
              (SELECT value FROM new_file), '$.intakeFileId'
            ) IS NOT NULL
            OR json_type(
              (SELECT value FROM new_file), '$.intakeSourceHash'
            ) IS NOT NULL
            OR json_type(
              (SELECT value FROM new_file), '$.sourceReviewedAt'
            ) IS NOT NULL
            OR json_type(
              (SELECT value FROM new_file), '$.sourceReviewedBy'
            ) IS NOT NULL
        END
        OR (
          SELECT count(*)
          FROM json_each(NEW.payload, '$.audit') AS audit
          WHERE json_extract(audit.value, '$.id') IS command.id
            AND json_extract(audit.value, '$.at') IS NEW.updated_at
            AND json_extract(audit.value, '$.action') IS 'receive_document'
            AND json_extract(audit.value, '$.detail') IS
              '요청 서류 수령 · 대표 검토 대기'
        ) IS NOT 1
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow receive document effect is invalid');
END;
