CREATE TRIGGER IF NOT EXISTS consulting_flows_command_insert_receipt_target_guard
BEFORE INSERT ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandReceipts') AS receipt
  WHERE json_type(receipt.value, '$.targetId') IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial command receipt target is invalid');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_new_command_receipt_target_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
    ON receipt.key IS command.value
  WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
    AND CASE json_extract(receipt.value, '$.action')
      WHEN 'complete_meeting' THEN
        json_type(receipt.value, '$.targetId') IS NOT 'text'
        OR length(json_extract(receipt.value, '$.targetId')) NOT BETWEEN 1 AND 200
      ELSE json_type(receipt.value, '$.targetId') IS NOT NULL
    END
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow new command receipt target is invalid');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_command_receipt_target_history_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(OLD.payload, '$.commandReceipts') AS previous
  JOIN json_each(NEW.payload, '$.commandReceipts') AS current
    ON current.key IS previous.key
  WHERE json_type(current.value, '$.targetId') IS NOT
      json_type(previous.value, '$.targetId')
    OR json_extract(current.value, '$.targetId') IS NOT
      json_extract(previous.value, '$.targetId')
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow command receipt target is immutable');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_complete_meeting_effect_guard
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
    WHERE command.action IS 'complete_meeting'
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
            OR json_extract(next_value, '$.status') IS NOT 'completed'
            OR json_extract(next_value, '$.completedAt') IS NOT NEW.updated_at
            OR json_remove(
              json(next_value), '$.status', '$.completedAt', '$.note'
            ) IS NOT json_remove(
              json(previous_value), '$.status', '$.completedAt', '$.note'
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
            OR json_extract(previous_value, '$.startsAt') > NEW.updated_at
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
            OR (
              json_extract(previous_value, '$.kind') IS 'first'
              AND (
                json_extract(OLD.payload, '$.analysis.reportId') IS NOT (
                  SELECT json_extract(report.value, '$.id')
                  FROM json_each(OLD.payload, '$.reports') AS report
                  WHERE json_extract(report.value, '$.stage') = 1
                  ORDER BY CAST(report.key AS INTEGER) DESC
                  LIMIT 1
                )
                OR json_type(OLD.payload, '$.analysis.adminAt') IS NOT 'text'
                OR json_type(OLD.payload, '$.analysis.partnerAt') IS NOT 'text'
                OR (
                  SELECT json_extract(report.value, '$.sourceReportId')
                  FROM json_each(OLD.payload, '$.reports') AS report
                  WHERE json_extract(report.value, '$.stage') = 2
                  ORDER BY CAST(report.key AS INTEGER) DESC
                  LIMIT 1
                ) IS NOT (
                  SELECT json_extract(report.value, '$.id')
                  FROM json_each(OLD.payload, '$.reports') AS report
                  WHERE json_extract(report.value, '$.stage') = 1
                  ORDER BY CAST(report.key AS INTEGER) DESC
                  LIMIT 1
                )
                OR (
                  SELECT json_extract(report.value, '$.sourceReportId')
                  FROM json_each(OLD.payload, '$.reports') AS report
                  WHERE json_extract(report.value, '$.stage') = 3
                  ORDER BY CAST(report.key AS INTEGER) DESC
                  LIMIT 1
                ) IS NOT (
                  SELECT json_extract(report.value, '$.id')
                  FROM json_each(OLD.payload, '$.reports') AS report
                  WHERE json_extract(report.value, '$.stage') = 1
                  ORDER BY CAST(report.key AS INTEGER) DESC
                  LIMIT 1
                )
                OR EXISTS (
                  SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS job
                  WHERE json_extract(job.value, '$.stage') = 1
                    AND json_extract(job.value, '$.status') IN (
                      'queued', 'processing'
                    )
                )
              )
            )
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow complete meeting effect is invalid');
END;
