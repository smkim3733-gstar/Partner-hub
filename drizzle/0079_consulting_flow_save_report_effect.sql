CREATE TRIGGER IF NOT EXISTS consulting_flows_save_report_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(id, actor, action) AS (
      SELECT command.value,
        json_extract(receipt.value, '$.actor'),
        json_extract(receipt.value, '$.action')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), report(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.reports[' || json_array_length(OLD.payload, '$.reports') || ']'
      )
    ), new_file(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.files[' || json_array_length(OLD.payload, '$.files') || ']'
      )
    )
    SELECT 1
    FROM command
    CROSS JOIN report
    CROSS JOIN new_file
    WHERE command.action IS 'save_report'
      AND (
        json_array_length(NEW.payload, '$.reports') IS NOT
          json_array_length(OLD.payload, '$.reports') + 1
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.reports') AS previous
          WHERE json(json_extract(
              NEW.payload,
              '$.reports[' || previous.key || ']'
            )) IS NOT json(previous.value)
        )
        OR json_extract(report.value, '$.id') IS NOT
          (command.id || '-report')
        OR json_type(report.value, '$.stage') IS NOT 'integer'
        OR json_extract(report.value, '$.stage') NOT BETWEEN 1 AND 6
        OR json_extract(report.value, '$.version') IS NOT (
          SELECT count(*) + 1
          FROM json_each(OLD.payload, '$.reports') AS previous
          WHERE json_extract(previous.value, '$.stage') IS
            json_extract(report.value, '$.stage')
        )
        OR json_extract(report.value, '$.title') IS NOT
          CASE json_extract(report.value, '$.stage')
            WHEN 1 THEN '1차 정밀진단보고서'
            WHEN 2 THEN '2차 대표 상담보고서'
            WHEN 3 THEN '3차 초회상담 PPT'
            WHEN 4 THEN '4차 심화보고서'
            WHEN 5 THEN '5차 견적서'
            WHEN 6 THEN '6차 경영자문용역계약서'
          END
        OR json_type(report.value, '$.body') IS NOT 'text'
        OR json_extract(report.value, '$.body') IS NOT
          trim(json_extract(report.value, '$.body'))
        OR (
          length(json_extract(report.value, '$.body')) < 80
          AND json_type(report.value, '$.fileId') IS NOT 'text'
        )
        OR (
          json_type(report.value, '$.fileId') IS NOT NULL
          AND json_type(report.value, '$.fileId') IS NOT 'text'
        )
        OR json_extract(report.value, '$.createdAt') IS NOT NEW.updated_at
        OR json_extract(report.value, '$.createdBy') IS NOT command.actor
        OR json_extract(report.value, '$.origin') IS NOT 'manual'
        OR CASE
          WHEN json_extract(report.value, '$.stage') = 1
          THEN json_type(report.value, '$.sourceReportId') IS NOT NULL
          ELSE json_type(report.value, '$.sourceReportId') IS NOT 'text'
            OR json_extract(report.value, '$.sourceReportId') IS NOT (
              SELECT json_extract(previous.value, '$.id')
              FROM json_each(OLD.payload, '$.reports') AS previous
              WHERE json_extract(previous.value, '$.stage') = 1
              ORDER BY CAST(previous.key AS INTEGER) DESC
              LIMIT 1
            )
        END
        OR CASE
          WHEN json_extract(report.value, '$.stage') = 4
          THEN json_type(report.value, '$.sourceRecordingId') IS NOT 'text'
            OR json_extract(report.value, '$.sourceRecordingId') IS NOT (
              SELECT json_extract(previous.value, '$.id')
              FROM json_each(OLD.payload, '$.recordings') AS previous
              ORDER BY CAST(previous.key AS INTEGER) DESC
              LIMIT 1
            )
          ELSE json_type(report.value, '$.sourceRecordingId') IS NOT NULL
        END
        OR CASE
          WHEN json_extract(report.value, '$.stage') >= 5
          THEN json_type(report.value, '$.decisionId') IS NOT 'text'
            OR json_extract(report.value, '$.decisionId') IS NOT
              json_extract(OLD.payload, '$.decision.id')
            OR json_type(report.value, '$.documentsKey') IS NOT 'text'
            OR json_extract(report.value, '$.documentsKey') IS NOT (
              SELECT json_group_array(json_array(
                json_extract(request.value, '$.id'),
                json_extract(request.value, '$.fileId'),
                json_extract(request.value, '$.verifiedAt')
              ))
              FROM json_each(OLD.payload, '$.requests') AS request
              WHERE json_extract(request.value, '$.required') IS 1
            )
          ELSE json_type(report.value, '$.decisionId') IS NOT NULL
            OR json_type(report.value, '$.documentsKey') IS NOT NULL
        END
        OR json_array_length(NEW.payload, '$.files') NOT IN (
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
        OR CASE
          WHEN json_array_length(NEW.payload, '$.files') =
              json_array_length(OLD.payload, '$.files') + 1
          THEN json_extract(new_file.value, '$.id') IS NOT
              json_extract(report.value, '$.fileId')
            OR json_extract(new_file.value, '$.purpose') IS NOT 'report'
            OR json_extract(new_file.value, '$.createdAt') IS NOT NEW.updated_at
            OR json_type(new_file.value, '$.intakeFileId') IS NOT NULL
            OR json_type(new_file.value, '$.intakeSourceHash') IS NOT NULL
            OR json_type(new_file.value, '$.sourceReviewedAt') IS NOT NULL
            OR json_type(new_file.value, '$.sourceReviewedBy') IS NOT NULL
          ELSE json_type(report.value, '$.fileId') = 'text'
            AND NOT EXISTS (
              SELECT 1 FROM json_each(OLD.payload, '$.files') AS previous
              WHERE json_extract(previous.value, '$.id') IS
                json_extract(report.value, '$.fileId')
            )
        END
        OR CASE
          WHEN json_extract(report.value, '$.stage') = 1
          THEN json(json_extract(NEW.payload, '$.analysis')) IS NOT
            json(json_object('reportId', command.id || '-report'))
          ELSE json(json_extract(NEW.payload, '$.analysis')) IS NOT
            json(json_extract(OLD.payload, '$.analysis'))
        END
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow save report effect is invalid');
END;
