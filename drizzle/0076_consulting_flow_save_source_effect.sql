CREATE TRIGGER IF NOT EXISTS consulting_flows_save_source_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(action) AS (
      SELECT json_extract(receipt.value, '$.action')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), new_file(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.files[' || json_array_length(OLD.payload, '$.files') || ']'
      )
    )
    SELECT 1
    FROM command
    CROSS JOIN new_file
    WHERE command.action IS 'save_source'
      AND (
        json_array_length(NEW.payload, '$.files') NOT IN (
          json_array_length(OLD.payload, '$.files'),
          json_array_length(OLD.payload, '$.files') + 1
        )
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.files') AS previous
          WHERE json(json_extract(
              NEW.payload,
              '$.files[' || previous.key || ']'
            )) IS NOT json(previous.value)
        )
        OR (
          json_array_length(NEW.payload, '$.files') =
            json_array_length(OLD.payload, '$.files') + 1
          AND (
            json_extract(new_file.value, '$.purpose') IS NOT 'source'
            OR json_extract(new_file.value, '$.createdAt') IS NOT NEW.updated_at
            OR json_type(new_file.value, '$.intakeFileId') IS NOT NULL
          )
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow save source effect is invalid');
END;
