CREATE TRIGGER IF NOT EXISTS consulting_flows_job_identity_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1
  FROM json_each(OLD.payload, '$.jobs') AS previous
  JOIN json_each(NEW.payload, '$.jobs') AS next
    ON json_extract(next.value, '$.id') IS json_extract(previous.value, '$.id')
  WHERE json_extract(next.value, '$.stage') IS NOT json_extract(previous.value, '$.stage')
    OR json_extract(next.value, '$.sourceRecordingId') IS NOT json_extract(previous.value, '$.sourceRecordingId')
    OR json_extract(next.value, '$.sourceReportId') IS NOT json_extract(previous.value, '$.sourceReportId')
    OR json_extract(next.value, '$.createdAt') IS NOT json_extract(previous.value, '$.createdAt')
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow job identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_job_status_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1
  FROM json_each(OLD.payload, '$.jobs') AS previous
  JOIN json_each(NEW.payload, '$.jobs') AS next
    ON json_extract(next.value, '$.id') IS json_extract(previous.value, '$.id')
  WHERE NOT (
    json_extract(next.value, '$.status') IS json_extract(previous.value, '$.status')
    OR (json_extract(previous.value, '$.status') = 'queued' AND json_extract(next.value, '$.status') IN ('processing', 'blocked'))
    OR (json_extract(previous.value, '$.status') IN ('blocked', 'failed') AND json_extract(next.value, '$.status') = 'queued')
    OR (json_extract(previous.value, '$.status') = 'processing' AND json_extract(next.value, '$.status') IN ('queued', 'blocked', 'failed', 'complete'))
  )
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow job status transition is invalid');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_job_lifecycle_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1
  FROM json_each(OLD.payload, '$.jobs') AS previous
  JOIN json_each(NEW.payload, '$.jobs') AS next
    ON json_extract(next.value, '$.id') IS json_extract(previous.value, '$.id')
  WHERE NOT CASE
    WHEN json_extract(previous.value, '$.status') IS json_extract(next.value, '$.status') THEN
      CASE WHEN json_extract(previous.value, '$.status') = 'blocked' THEN
        (json_extract(next.value, '$.startedAt') IS json_extract(previous.value, '$.startedAt') OR json_type(next.value, '$.startedAt') IS NULL)
        AND json_type(next.value, '$.completedAt') IS NULL
        AND json_type(next.value, '$.reportId') IS NULL
        AND json_type(next.value, '$.evidence') IS NULL
        AND json_type(next.value, '$.failureEvidence') IS NULL
      ELSE
        json_extract(next.value, '$.reason') IS json_extract(previous.value, '$.reason')
        AND json_extract(next.value, '$.startedAt') IS json_extract(previous.value, '$.startedAt')
        AND json_extract(next.value, '$.completedAt') IS json_extract(previous.value, '$.completedAt')
        AND json_extract(next.value, '$.reportId') IS json_extract(previous.value, '$.reportId')
        AND json_extract(next.value, '$.evidence') IS json_extract(previous.value, '$.evidence')
        AND json_extract(next.value, '$.failureEvidence') IS json_extract(previous.value, '$.failureEvidence')
      END
    WHEN json_extract(previous.value, '$.status') = 'queued' AND json_extract(next.value, '$.status') = 'processing' THEN
      json_extract(next.value, '$.reason') = ''
      AND json_type(next.value, '$.startedAt') = 'text'
      AND json_type(next.value, '$.completedAt') IS NULL
      AND json_type(next.value, '$.reportId') IS NULL
      AND json_type(next.value, '$.evidence') IS NULL
      AND json_type(next.value, '$.failureEvidence') IS NULL
    WHEN json_extract(previous.value, '$.status') = 'queued' AND json_extract(next.value, '$.status') = 'blocked' THEN
      COALESCE(json_extract(next.value, '$.reason'), '') <> ''
      AND json_type(next.value, '$.startedAt') IS NULL
      AND json_type(next.value, '$.completedAt') IS NULL
      AND json_type(next.value, '$.reportId') IS NULL
      AND json_type(next.value, '$.evidence') IS NULL
      AND json_type(next.value, '$.failureEvidence') IS NULL
    WHEN json_extract(previous.value, '$.status') IN ('blocked', 'failed', 'processing') AND json_extract(next.value, '$.status') = 'queued' THEN
      json_extract(next.value, '$.reason') = ''
      AND json_type(next.value, '$.startedAt') IS NULL
      AND json_type(next.value, '$.completedAt') IS NULL
      AND json_type(next.value, '$.reportId') IS NULL
      AND json_type(next.value, '$.evidence') IS NULL
      AND json_type(next.value, '$.failureEvidence') IS NULL
    WHEN json_extract(previous.value, '$.status') = 'processing' AND json_extract(next.value, '$.status') = 'blocked' THEN
      COALESCE(json_extract(next.value, '$.reason'), '') <> ''
      AND json_extract(next.value, '$.startedAt') IS json_extract(previous.value, '$.startedAt')
      AND json_type(next.value, '$.completedAt') IS NULL
      AND json_type(next.value, '$.reportId') IS NULL
      AND json_type(next.value, '$.evidence') IS NULL
      AND json_type(next.value, '$.failureEvidence') IS NULL
    WHEN json_extract(previous.value, '$.status') = 'processing' AND json_extract(next.value, '$.status') = 'failed' THEN
      COALESCE(json_extract(next.value, '$.reason'), '') <> ''
      AND json_extract(next.value, '$.startedAt') IS json_extract(previous.value, '$.startedAt')
      AND json_type(next.value, '$.completedAt') IS NULL
      AND json_type(next.value, '$.reportId') IS NULL
      AND json_type(next.value, '$.evidence') IS NULL
    WHEN json_extract(previous.value, '$.status') = 'processing' AND json_extract(next.value, '$.status') = 'complete' THEN
      json_extract(next.value, '$.reason') = ''
      AND json_extract(next.value, '$.startedAt') IS json_extract(previous.value, '$.startedAt')
      AND json_type(next.value, '$.completedAt') = 'text'
      AND json_type(next.value, '$.reportId') = 'text'
      AND json_type(next.value, '$.evidence') = 'object'
      AND json_type(next.value, '$.failureEvidence') IS NULL
    ELSE 0
  END
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow job lifecycle transition is invalid');
END;
