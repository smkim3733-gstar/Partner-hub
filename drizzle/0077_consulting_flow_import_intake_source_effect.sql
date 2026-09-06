CREATE TRIGGER IF NOT EXISTS consulting_flows_import_intake_source_effect_guard
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
    WHERE command.action IS 'import_intake_source'
      AND (
        json_array_length(NEW.payload, '$.files') IS NOT
          json_array_length(OLD.payload, '$.files') + 1
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.files') AS previous
          WHERE json(json_extract(
              NEW.payload,
              '$.files[' || previous.key || ']'
            )) IS NOT json(previous.value)
        )
        OR json_extract(new_file.value, '$.purpose') IS NOT 'source'
        OR json_extract(new_file.value, '$.createdAt') IS NOT NEW.updated_at
        OR json_type(new_file.value, '$.intakeFileId') IS NOT 'text'
        OR trim(json_extract(new_file.value, '$.intakeFileId')) = ''
        OR json_type(new_file.value, '$.intakeSourceHash') IS NOT 'text'
        OR length(json_extract(new_file.value, '$.intakeSourceHash')) <> 64
        OR json_extract(new_file.value, '$.intakeSourceHash') GLOB '*[^0-9a-f]*'
        OR json_extract(new_file.value, '$.sourceReviewedAt') IS NOT NEW.updated_at
        OR json_type(new_file.value, '$.sourceReviewedBy') IS NOT 'text'
        OR trim(json_extract(new_file.value, '$.sourceReviewedBy')) = ''
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow intake source effect is invalid');
END;
