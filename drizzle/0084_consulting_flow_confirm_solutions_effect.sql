CREATE TRIGGER IF NOT EXISTS consulting_flows_confirm_solutions_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(id, actor_key, action) AS (
      SELECT command.value,
        json_extract(receipt.value, '$.actorKey'),
        json_extract(receipt.value, '$.action')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), latest_report(id) AS (
      SELECT json_extract(report.value, '$.id')
      FROM json_each(OLD.payload, '$.reports') AS report
      WHERE json_extract(report.value, '$.stage') = 1
      ORDER BY CAST(report.key AS INTEGER) DESC
      LIMIT 1
    ), latest_recording(id) AS (
      SELECT json_extract(recording.value, '$.id')
      FROM json_each(OLD.payload, '$.recordings') AS recording
      ORDER BY CAST(recording.key AS INTEGER) DESC
      LIMIT 1
    ), deep_report(id) AS (
      SELECT json_extract(report.value, '$.id')
      FROM json_each(OLD.payload, '$.reports') AS report
      WHERE json_extract(report.value, '$.stage') = 4
        AND json_extract(report.value, '$.sourceReportId') IS
          (SELECT id FROM latest_report)
        AND json_extract(report.value, '$.sourceRecordingId') IS
          (SELECT id FROM latest_recording)
      ORDER BY CAST(report.key AS INTEGER) DESC
      LIMIT 1
    )
    SELECT 1 FROM command
    WHERE command.action IS 'confirm_solutions'
      AND (
        command.actor_key IS NOT 'admin:primary'
        OR json_type(OLD.payload, '$.contract') IS NOT NULL
        OR NOT EXISTS (SELECT 1 FROM deep_report)
        OR json_type(NEW.payload, '$.decision') IS NOT 'object'
        OR (SELECT count(*) FROM json_each(
          NEW.payload, '$.decision'
        )) IS NOT 6
        OR EXISTS (
          SELECT 1 FROM json_each(NEW.payload, '$.decision') AS field
          WHERE field.key NOT IN (
            'id', 'reportId', 'solutions', 'note', 'documentsNeeded', 'at'
          )
        )
        OR json_extract(NEW.payload, '$.decision.id') IS NOT
          (command.id || '-decision')
        OR json_extract(NEW.payload, '$.decision.reportId') IS NOT
          (SELECT id FROM deep_report)
        OR json_type(NEW.payload, '$.decision.solutions') IS NOT 'array'
        OR json_array_length(
          NEW.payload, '$.decision.solutions'
        ) NOT BETWEEN 1 AND 12
        OR EXISTS (
          SELECT 1
          FROM json_each(NEW.payload, '$.decision.solutions') AS solution
          WHERE solution.type IS NOT 'text'
            OR length(trim(solution.value)) = 0
            OR solution.value IS NOT trim(solution.value)
            OR length(solution.value) > 80
        )
        OR EXISTS (
          SELECT 1
          FROM json_each(NEW.payload, '$.decision.solutions') AS solution
          GROUP BY solution.value
          HAVING count(*) > 1
        )
        OR json_type(
          NEW.payload, '$.decision.documentsNeeded'
        ) NOT IN ('true', 'false')
        OR json_type(NEW.payload, '$.decision.note') IS NOT 'text'
        OR json_extract(NEW.payload, '$.decision.note') IS NOT
          trim(json_extract(NEW.payload, '$.decision.note'))
        OR length(json_extract(NEW.payload, '$.decision.note')) > 2000
        OR json_extract(NEW.payload, '$.decision.at') IS NOT NEW.updated_at
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow confirm solutions effect is invalid');
END;
