CREATE TRIGGER IF NOT EXISTS consulting_flows_job_insert_origin_guard
BEFORE INSERT ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.jobs') AS job
  WHERE json_extract(job.value, '$.createdAt') IS NOT NEW.updated_at
    OR (json_extract(job.value, '$.stage') = 1 AND
      (json_type(job.value, '$.sourceRecordingId') IS NOT NULL OR
        json_type(job.value, '$.sourceReportId') IS NOT NULL))
    OR (json_extract(job.value, '$.stage') = 4 AND
      (COALESCE(json_type(job.value, '$.sourceRecordingId'), '') <> 'text' OR
        json_extract(job.value, '$.sourceRecordingId') IS NOT
          (SELECT json_extract(recording.value, '$.id')
          FROM json_each(NEW.payload, '$.recordings') AS recording
          ORDER BY CAST(recording.key AS INTEGER) DESC LIMIT 1) OR
        COALESCE(json_type(job.value, '$.sourceReportId'), '') <> 'text' OR
        json_extract(job.value, '$.sourceReportId') IS NOT
          (SELECT json_extract(report.value, '$.id')
          FROM json_each(NEW.payload, '$.reports') AS report
          WHERE json_extract(report.value, '$.stage') = 1
          ORDER BY CAST(report.key AS INTEGER) DESC LIMIT 1)))
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial job origin is invalid');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_job_creation_origin_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.jobs') AS job
  WHERE NOT EXISTS (
    SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
    WHERE json_extract(previous.value, '$.id') IS json_extract(job.value, '$.id')
  ) AND (
    json_extract(job.value, '$.createdAt') IS NOT NEW.updated_at
    OR (json_extract(job.value, '$.stage') = 1 AND
      (json_type(job.value, '$.sourceRecordingId') IS NOT NULL OR
        json_type(job.value, '$.sourceReportId') IS NOT NULL))
    OR (json_extract(job.value, '$.stage') = 4 AND
      (COALESCE(json_type(job.value, '$.sourceRecordingId'), '') <> 'text' OR
        json_extract(job.value, '$.sourceRecordingId') IS NOT
          (SELECT json_extract(recording.value, '$.id')
          FROM json_each(NEW.payload, '$.recordings') AS recording
          ORDER BY CAST(recording.key AS INTEGER) DESC LIMIT 1) OR
        COALESCE(json_type(job.value, '$.sourceReportId'), '') <> 'text' OR
        json_extract(job.value, '$.sourceReportId') IS NOT
          (SELECT json_extract(report.value, '$.id')
          FROM json_each(NEW.payload, '$.reports') AS report
          WHERE json_extract(report.value, '$.stage') = 1
          ORDER BY CAST(report.key AS INTEGER) DESC LIMIT 1)))
    OR (SELECT count(*) FROM json_each(NEW.payload, '$.jobs') AS added
      WHERE NOT EXISTS (
        SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
        WHERE json_extract(previous.value, '$.id') IS json_extract(added.value, '$.id')
      ) AND json_extract(added.value, '$.stage') = 1) IS NOT
      (SELECT count(*) FROM json_each(NEW.payload, '$.audit') AS audit
      WHERE audit.key >= json_array_length(OLD.payload, '$.audit')
        AND json_extract(audit.value, '$.at') = NEW.updated_at
        AND json_extract(audit.value, '$.action') = 'queue_report1')
    OR (SELECT count(*) FROM json_each(NEW.payload, '$.jobs') AS added
      WHERE NOT EXISTS (
        SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
        WHERE json_extract(previous.value, '$.id') IS json_extract(added.value, '$.id')
      ) AND json_extract(added.value, '$.stage') = 4) IS NOT
      (SELECT count(*) FROM json_each(NEW.payload, '$.audit') AS audit
      WHERE audit.key >= json_array_length(OLD.payload, '$.audit')
        AND json_extract(audit.value, '$.at') = NEW.updated_at
        AND json_extract(audit.value, '$.action') = 'save_recording')
  )
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow job creation origin is invalid');
END;
