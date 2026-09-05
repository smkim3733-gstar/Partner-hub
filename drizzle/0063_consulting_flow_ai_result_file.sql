CREATE TRIGGER IF NOT EXISTS consulting_flows_ai_result_file_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) =
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
    WHERE json_extract(previous.value, '$.status') IS 'processing'
      AND json_extract(
        NEW.payload,
        '$.jobs[' || previous.key || '].status'
      ) IS 'complete'
  )
  AND (
    json_extract(NEW.payload, '$.files') IS NOT
      json_extract(OLD.payload, '$.files')
    OR EXISTS (
      SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
      WHERE json_extract(previous.value, '$.status') IS 'processing'
        AND json_extract(
          NEW.payload,
          '$.jobs[' || previous.key || '].status'
        ) IS 'complete'
        AND EXISTS (
          SELECT 1 FROM json_each(NEW.payload, '$.reports') AS report
          WHERE json_extract(report.value, '$.id') IS
              (json_extract(previous.value, '$.id') || '-result')
            AND json_type(report.value, '$.fileId') IS NOT NULL
        )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow AI result file is invalid');
END;
