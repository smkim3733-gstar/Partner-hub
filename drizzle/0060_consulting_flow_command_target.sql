CREATE TRIGGER IF NOT EXISTS consulting_flows_command_insert_target_guard
BEFORE INSERT ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
    LEFT JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
      ON receipt.key IS command.value
    WHERE receipt.key IS NULL
  )
  AND (
    (
      json_array_length(NEW.payload, '$.commandIds') <> 1
      AND EXISTS (
        SELECT 1 FROM json_each(NEW.payload, '$.commandReceipts') AS receipt
        WHERE json_extract(receipt.value, '$.action') IN ('save_report', 'book_meeting', 'complete_meeting', 'cancel_meeting', 'save_recording', 'save_transcript', 'request_document', 'mark_request_sent', 'receive_document', 'review_document', 'record_contract', 'confirm_payment')
      )
    )
    OR EXISTS (
      WITH command(id, action) AS (
        SELECT command.value, json_extract(receipt.value, '$.action')
        FROM json_each(NEW.payload, '$.commandIds') AS command
        JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
          ON receipt.key IS command.value
        LIMIT 1
      ), collections(name) AS (
        VALUES ('reports'), ('meetings'), ('recordings'), ('requests'), ('payments')
      ), append_rules(action, collection_name, id_suffix) AS (
        VALUES ('save_report', 'reports', 'report'),
      ('book_meeting', 'meetings', 'meeting'),
      ('save_recording', 'recordings', 'recording'),
      ('request_document', 'requests', 'request'),
      ('confirm_payment', 'payments', 'payment')
      )
      SELECT 1 FROM collections
      CROSS JOIN command
      LEFT JOIN append_rules AS rule
        ON rule.action IS command.action
        AND rule.collection_name IS collections.name
      WHERE (
        rule.id_suffix IS NULL
        AND json_array_length(NEW.payload, '$.' || collections.name) <> 0
      ) OR (
        rule.id_suffix IS NOT NULL
        AND (
          json_array_length(NEW.payload, '$.' || collections.name) <> 1
          OR json_extract(
            NEW.payload,
            '$.' || collections.name || '[0].id'
          ) IS NOT (command.id || '-' || rule.id_suffix)
        )
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial command target is invalid');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_command_target_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND NOT EXISTS (
    SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
    LEFT JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
      ON receipt.key IS command.value
    WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
      AND receipt.key IS NULL
  )
  AND (
    (
      json_array_length(NEW.payload, '$.commandIds') -
        json_array_length(OLD.payload, '$.commandIds') <> 1
      AND EXISTS (
        SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
        JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
          ON receipt.key IS command.value
        WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
          AND json_extract(receipt.value, '$.action') IN ('save_report', 'book_meeting', 'complete_meeting', 'cancel_meeting', 'save_recording', 'save_transcript', 'request_document', 'mark_request_sent', 'receive_document', 'review_document', 'record_contract', 'confirm_payment')
      )
    )
    OR EXISTS (
      WITH command(id, action) AS (
        SELECT command.value, json_extract(receipt.value, '$.action')
        FROM json_each(NEW.payload, '$.commandIds') AS command
        JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
          ON receipt.key IS command.value
        WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
      ), collections(name) AS (
        VALUES ('reports'), ('meetings'), ('recordings'), ('requests'), ('payments')
      ), rules(action, collection_name, kind, id_suffix, fields, minimum, maximum) AS (
        VALUES ('save_report', 'reports', 'append', 'report', NULL, 1, 1),
      ('book_meeting', 'meetings', 'append', 'meeting', NULL, 1, 1),
      ('complete_meeting', 'meetings', 'update', NULL, '["status","completedAt","note"]', 1, 1),
      ('cancel_meeting', 'meetings', 'update', NULL, '["status","note"]', 1, 1),
      ('save_recording', 'recordings', 'append', 'recording', NULL, 1, 1),
      ('save_transcript', 'recordings', 'update', NULL, '["transcript","transcriptFileId","transcriptReviewedAt","transcriptReviewedBy"]', 1, 1),
      ('request_document', 'requests', 'append', 'request', NULL, 1, 1),
      ('mark_request_sent', 'requests', 'update', NULL, '["sentAt"]', 1, 1),
      ('receive_document', 'requests', 'update', NULL, '["fileId","status","receivedAt","reviewedAt","verifiedAt","note"]', 1, 1),
      ('review_document', 'requests', 'update', NULL, '["status","note","reviewedAt","verifiedAt"]', 1, 1),
      ('record_contract', 'meetings', 'update', NULL, '["status","completedAt"]', 0, 1),
      ('confirm_payment', 'payments', 'append', 'payment', NULL, 1, 1)
      )
      SELECT 1 FROM collections
      CROSS JOIN command
      LEFT JOIN rules AS rule
        ON rule.action IS command.action
        AND rule.collection_name IS collections.name
      WHERE (
        rule.kind IS NULL
        AND json_extract(NEW.payload, '$.' || collections.name) IS NOT
          json_extract(OLD.payload, '$.' || collections.name)
      ) OR (
        rule.kind IS 'append'
        AND (
          json_array_length(NEW.payload, '$.' || collections.name) <>
            json_array_length(OLD.payload, '$.' || collections.name) + 1
          OR EXISTS (
            SELECT 1 FROM json_each(
              OLD.payload,
              '$.' || collections.name
            ) AS previous
            WHERE previous.value IS NOT json_extract(
              NEW.payload,
              '$.' || collections.name || '[' || previous.key || ']'
            )
          )
          OR json_extract(
            NEW.payload,
            '$.' || collections.name || '[' ||
              json_array_length(OLD.payload, '$.' || collections.name) || '].id'
          ) IS NOT (command.id || '-' || rule.id_suffix)
        )
      ) OR (
        rule.kind IS 'update'
        AND (
          json_array_length(NEW.payload, '$.' || collections.name) <>
            json_array_length(OLD.payload, '$.' || collections.name)
          OR (
            SELECT COUNT(*) FROM json_each(
              OLD.payload,
              '$.' || collections.name
            ) AS previous
            WHERE previous.value IS NOT json_extract(
              NEW.payload,
              '$.' || collections.name || '[' || previous.key || ']'
            )
          ) NOT BETWEEN rule.minimum AND rule.maximum
          OR EXISTS (
            SELECT 1 FROM json_each(
              OLD.payload,
              '$.' || collections.name
            ) AS previous
            WHERE previous.value IS NOT json_extract(
              NEW.payload,
              '$.' || collections.name || '[' || previous.key || ']'
            )
              AND (
                EXISTS (
                  SELECT 1 FROM (
                    SELECT key FROM json_each(previous.value)
                    UNION
                    SELECT key FROM json_each(json_extract(
                      NEW.payload,
                      '$.' || collections.name || '[' || previous.key || ']'
                    ))
                  ) AS property
                  WHERE NOT EXISTS (
                    SELECT 1 FROM json_each(rule.fields) AS allowed
                    WHERE allowed.value IS property.key
                  )
                    AND (
                      json_type(previous.value, '$.' || property.key) IS NOT
                        json_type(json_extract(
                          NEW.payload,
                          '$.' || collections.name || '[' || previous.key || ']'
                        ), '$.' || property.key)
                      OR json_extract(previous.value, '$.' || property.key) IS NOT
                        json_extract(json_extract(
                          NEW.payload,
                          '$.' || collections.name || '[' || previous.key || ']'
                        ), '$.' || property.key)
                    )
                )
                OR CASE command.action
                  WHEN 'complete_meeting' THEN
                    json_extract(json_extract(
                      NEW.payload,
                      '$.' || collections.name || '[' || previous.key || ']'
                    ), '$.status') IS NOT 'completed'
                    OR json_extract(json_extract(
                      NEW.payload,
                      '$.' || collections.name || '[' || previous.key || ']'
                    ), '$.completedAt') IS NOT NEW.updated_at
                  WHEN 'cancel_meeting' THEN
                    json_extract(json_extract(
                      NEW.payload,
                      '$.' || collections.name || '[' || previous.key || ']'
                    ), '$.status') IS NOT 'cancelled'
                  WHEN 'save_transcript' THEN
                    json_extract(json_extract(
                      NEW.payload,
                      '$.' || collections.name || '[' || previous.key || ']'
                    ), '$.id') IS NOT json_extract(
                      NEW.payload,
                      '$.recordings[' ||
                        (json_array_length(NEW.payload, '$.recordings') - 1) || '].id'
                    )
                    OR json_extract(json_extract(
                      NEW.payload,
                      '$.' || collections.name || '[' || previous.key || ']'
                    ), '$.transcriptReviewedAt') IS NOT NEW.updated_at
                  WHEN 'mark_request_sent' THEN
                    json_extract(json_extract(
                      NEW.payload,
                      '$.' || collections.name || '[' || previous.key || ']'
                    ), '$.sentAt') IS NOT NEW.updated_at
                  WHEN 'receive_document' THEN
                    json_extract(json_extract(
                      NEW.payload,
                      '$.' || collections.name || '[' || previous.key || ']'
                    ), '$.status') IS NOT 'received'
                  WHEN 'review_document' THEN
                    json_extract(json_extract(
                      NEW.payload,
                      '$.' || collections.name || '[' || previous.key || ']'
                    ), '$.status') NOT IN ('verified', 'needs_fix')
                    OR json_extract(json_extract(
                      NEW.payload,
                      '$.' || collections.name || '[' || previous.key || ']'
                    ), '$.reviewedAt') IS NOT NEW.updated_at
                  WHEN 'record_contract' THEN
                    json_extract(json_extract(
                      NEW.payload,
                      '$.' || collections.name || '[' || previous.key || ']'
                    ), '$.id') IS NOT json_extract(NEW.payload, '$.contract.meetingId')
                    OR json_extract(json_extract(
                      NEW.payload,
                      '$.' || collections.name || '[' || previous.key || ']'
                    ), '$.status') IS NOT 'completed'
                  ELSE 0
                END
              )
          )
        )
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow command target is invalid');
END;
