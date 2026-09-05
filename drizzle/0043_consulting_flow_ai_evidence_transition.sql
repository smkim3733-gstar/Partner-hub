CREATE TRIGGER IF NOT EXISTS consulting_flows_audit_append_only
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1
  FROM json_each(OLD.payload, '$.audit') AS previous
  LEFT JOIN json_each(NEW.payload, '$.audit') AS next ON next.key = previous.key
  WHERE next.key IS NULL OR json(next.value) IS NOT json(previous.value)
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow audit is append-only');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_jobs_transition_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
  WHERE NOT EXISTS (
    SELECT 1 FROM json_each(NEW.payload, '$.jobs') AS next
    WHERE json_extract(next.value, '$.id') IS json_extract(previous.value, '$.id')
  )
) OR EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.jobs') AS next
  WHERE NOT EXISTS (
    SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
    WHERE json_extract(previous.value, '$.id') IS json_extract(next.value, '$.id')
  ) AND (
    COALESCE(json_extract(next.value, '$.status'), '') NOT IN ('queued', 'blocked')
    OR json_type(next.value, '$.startedAt') IS NOT NULL
    OR json_type(next.value, '$.completedAt') IS NOT NULL
    OR json_type(next.value, '$.reportId') IS NOT NULL
    OR json_type(next.value, '$.evidence') IS NOT NULL
    OR json_type(next.value, '$.failureEvidence') IS NOT NULL
    OR json_type(next.value, '$.failureEvidenceHistory') IS NOT NULL
  )
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow job transition is invalid');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_success_evidence_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1
  FROM json_each(OLD.payload, '$.jobs') AS previous
  JOIN json_each(NEW.payload, '$.jobs') AS next
    ON json_extract(next.value, '$.id') IS json_extract(previous.value, '$.id')
  WHERE (
    json_type(previous.value, '$.evidence') = 'object'
    AND (
      json_type(next.value, '$.evidence') IS NOT 'object'
      OR json_extract(next.value, '$.evidence') IS NOT json_extract(previous.value, '$.evidence')
    )
  ) OR (
    json_type(previous.value, '$.evidence') IS NULL
    AND json_type(next.value, '$.evidence') = 'object'
    AND NOT (
      json_extract(previous.value, '$.status') = 'processing'
      AND json_extract(next.value, '$.status') = 'complete'
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow success evidence transition is invalid');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_failure_history_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1
  FROM json_each(OLD.payload, '$.jobs') AS previous_job
  JOIN json_each(NEW.payload, '$.jobs') AS next_job
    ON json_extract(next_job.value, '$.id') IS json_extract(previous_job.value, '$.id')
  WHERE EXISTS (
    SELECT 1
    FROM json_each(previous_job.value, '$.failureEvidenceHistory') AS previous
    LEFT JOIN json_each(next_job.value, '$.failureEvidenceHistory') AS next
      ON next.key = previous.key
    WHERE next.key IS NULL OR json(next.value) IS NOT json(previous.value)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow failure history is immutable');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_failure_evidence_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1
  FROM json_each(OLD.payload, '$.jobs') AS previous
  JOIN json_each(NEW.payload, '$.jobs') AS next
    ON json_extract(next.value, '$.id') IS json_extract(previous.value, '$.id')
  WHERE CASE
    WHEN json_type(previous.value, '$.failureEvidence') = 'object' THEN NOT (
      (
        json_type(next.value, '$.failureEvidence') = 'object'
        AND json_extract(next.value, '$.failureEvidence') IS json_extract(previous.value, '$.failureEvidence')
        AND COALESCE(json_array_length(next.value, '$.failureEvidenceHistory'), 0)
          = COALESCE(json_array_length(previous.value, '$.failureEvidenceHistory'), 0)
      ) OR (
        json_type(next.value, '$.failureEvidence') IS NULL
        AND COALESCE(json_array_length(next.value, '$.failureEvidenceHistory'), 0)
          = COALESCE(json_array_length(previous.value, '$.failureEvidenceHistory'), 0) + 1
        AND json_extract(
          next.value,
          '$.failureEvidenceHistory[' || COALESCE(json_array_length(previous.value, '$.failureEvidenceHistory'), 0) || ']'
        ) IS json_extract(previous.value, '$.failureEvidence')
      )
    )
    ELSE
      COALESCE(json_array_length(next.value, '$.failureEvidenceHistory'), 0)
        <> COALESCE(json_array_length(previous.value, '$.failureEvidenceHistory'), 0)
      OR (
        json_type(next.value, '$.failureEvidence') = 'object'
        AND NOT (
          json_extract(previous.value, '$.status') = 'processing'
          AND json_extract(next.value, '$.status') = 'failed'
        )
      )
  END
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow failure evidence transition is invalid');
END;
