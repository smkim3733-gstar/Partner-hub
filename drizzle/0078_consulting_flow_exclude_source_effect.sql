CREATE TRIGGER IF NOT EXISTS consulting_flows_exclude_source_effect_guard
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
    ), compared(previous, current) AS (
      SELECT previous.value, json_extract(
        NEW.payload,
        '$.files[' || previous.key || ']'
      )
      FROM json_each(OLD.payload, '$.files') AS previous
    )
    SELECT 1
    FROM command
    WHERE command.action IS 'exclude_source'
      AND (
        json_array_length(NEW.payload, '$.files') IS NOT
          json_array_length(OLD.payload, '$.files')
        OR (SELECT count(*) FROM compared
          WHERE json(current) IS NOT json(previous)) IS NOT 1
        OR EXISTS (
          SELECT 1 FROM compared
          WHERE json(current) IS NOT json(previous)
            AND (
              json_extract(previous, '$.purpose') IS NOT 'source'
              OR json(current) IS NOT json(json_set(
                json(previous), '$.purpose', 'source_archived'
              ))
            )
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow exclude source effect is invalid');
END;
