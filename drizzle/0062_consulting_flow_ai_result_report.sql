CREATE TRIGGER IF NOT EXISTS consulting_flows_ai_result_report_guard
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
    (
      SELECT count(*) FROM json_each(OLD.payload, '$.jobs') AS previous
      WHERE json_extract(previous.value, '$.status') IS 'processing'
        AND json_extract(
          NEW.payload,
          '$.jobs[' || previous.key || '].status'
        ) IS 'complete'
    ) <> 1
    OR json_array_length(NEW.payload, '$.reports') <>
      json_array_length(OLD.payload, '$.reports') + 1
    OR EXISTS (
      SELECT 1 FROM json_each(OLD.payload, '$.reports') AS previous
      WHERE previous.value IS NOT json_extract(
        NEW.payload,
        '$.reports[' || previous.key || ']'
      )
    )
    OR EXISTS (
      SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
      WHERE json_extract(previous.value, '$.status') IS 'processing'
        AND json_extract(
          NEW.payload,
          '$.jobs[' || previous.key || '].status'
        ) IS 'complete'
        AND (
          json_extract(
            NEW.payload,
            '$.jobs[' || previous.key || '].reportId'
          ) IS NOT (json_extract(previous.value, '$.id') || '-result')
          OR json_extract(
            NEW.payload,
            '$.reports[' || json_array_length(OLD.payload, '$.reports') || '].id'
          ) IS NOT (json_extract(previous.value, '$.id') || '-result')
          OR json_extract(
            NEW.payload,
            '$.reports[' || json_array_length(OLD.payload, '$.reports') || '].stage'
          ) IS NOT json_extract(previous.value, '$.stage')
          OR json_extract(
            NEW.payload,
            '$.reports[' || json_array_length(OLD.payload, '$.reports') || '].version'
          ) IS NOT (
            SELECT count(*) + 1 FROM json_each(OLD.payload, '$.reports') AS report
            WHERE json_extract(report.value, '$.stage') IS
              json_extract(previous.value, '$.stage')
          )
          OR json_extract(
            NEW.payload,
            '$.reports[' || json_array_length(OLD.payload, '$.reports') || '].title'
          ) IS NOT CASE json_extract(previous.value, '$.stage')
            WHEN 1 THEN '1차 정밀진단보고서'
            WHEN 4 THEN '4차 심화보고서'
          END
          OR json_extract(
            NEW.payload,
            '$.reports[' || json_array_length(OLD.payload, '$.reports') || '].createdAt'
          ) IS NOT NEW.updated_at
          OR json_extract(
            NEW.payload,
            '$.reports[' || json_array_length(OLD.payload, '$.reports') || '].createdBy'
          ) IS NOT 'Claude · 대표 검토 전'
          OR json_extract(
            NEW.payload,
            '$.reports[' || json_array_length(OLD.payload, '$.reports') || '].origin'
          ) IS NOT 'ai'
          OR json_type(
            NEW.payload,
            '$.reports[' || json_array_length(OLD.payload, '$.reports') || '].decisionId'
          ) IS NOT NULL
          OR json_type(
            NEW.payload,
            '$.reports[' || json_array_length(OLD.payload, '$.reports') || '].documentsKey'
          ) IS NOT NULL
          OR CASE json_extract(previous.value, '$.stage')
            WHEN 1 THEN
              json_type(
                NEW.payload,
                '$.reports[' || json_array_length(OLD.payload, '$.reports') || '].sourceReportId'
              ) IS NOT NULL
              OR json_type(
                NEW.payload,
                '$.reports[' || json_array_length(OLD.payload, '$.reports') || '].sourceRecordingId'
              ) IS NOT NULL
              OR json_extract(NEW.payload, '$.analysis.reportId') IS NOT
                (json_extract(previous.value, '$.id') || '-result')
              OR (
                SELECT count(*) FROM json_each(NEW.payload, '$.analysis')
              ) <> 1
            WHEN 4 THEN
              json_extract(
                NEW.payload,
                '$.reports[' || json_array_length(OLD.payload, '$.reports') || '].sourceReportId'
              ) IS NOT json_extract(previous.value, '$.sourceReportId')
              OR json_extract(
                NEW.payload,
                '$.reports[' || json_array_length(OLD.payload, '$.reports') || '].sourceRecordingId'
              ) IS NOT json_extract(previous.value, '$.sourceRecordingId')
              OR json_extract(NEW.payload, '$.analysis') IS NOT
                json_extract(OLD.payload, '$.analysis')
            ELSE 1
          END
        )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow AI result report is invalid');
END;
