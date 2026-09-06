CREATE TRIGGER IF NOT EXISTS consulting_flows_retry_job_effect_guard
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
    )
    SELECT 1 FROM command
    WHERE command.action IS 'retry_job'
      AND (
        json_array_length(NEW.payload, '$.jobs') IS NOT
          json_array_length(OLD.payload, '$.jobs')
        OR (SELECT count(*)
          FROM json_each(OLD.payload, '$.jobs') AS previous
          WHERE json_extract(previous.value, '$.status') IN (
              'blocked', 'failed', 'processing'
            )
            AND json(json_extract(
                NEW.payload,
                '$.jobs[' || previous.key || ']'
              )) IS json(
                json_set(
                  json_remove(
                    CASE
                      WHEN json_type(previous.value, '$.failureEvidence') = 'object'
                      THEN json_set(
                        previous.value,
                        '$.failureEvidenceHistory',
                        json_insert(
                          COALESCE(
                            json(json_extract(
                              previous.value,
                              '$.failureEvidenceHistory'
                            )),
                            json('[]')
                          ),
                          '$[#]',
                          json(json_extract(previous.value, '$.failureEvidence'))
                        )
                      )
                      ELSE previous.value
                    END,
                    '$.failureEvidence',
                    '$.startedAt'
                  ),
                  '$.status', 'queued',
                  '$.reason', ''
                )
              )) IS NOT 1
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
          WHERE json(json_extract(
              NEW.payload,
              '$.jobs[' || previous.key || ']'
            )) IS NOT json(previous.value)
            AND NOT (
              json_extract(previous.value, '$.status') IN (
                'blocked', 'failed', 'processing'
              )
              AND json(json_extract(
                  NEW.payload,
                  '$.jobs[' || previous.key || ']'
                )) IS json(
                  json_set(
                    json_remove(
                      CASE
                        WHEN json_type(previous.value, '$.failureEvidence') = 'object'
                        THEN json_set(
                          previous.value,
                          '$.failureEvidenceHistory',
                          json_insert(
                            COALESCE(
                              json(json_extract(
                                previous.value,
                                '$.failureEvidenceHistory'
                              )),
                              json('[]')
                            ),
                            '$[#]',
                            json(json_extract(previous.value, '$.failureEvidence'))
                          )
                        )
                        ELSE previous.value
                      END,
                      '$.failureEvidence',
                      '$.startedAt'
                    ),
                    '$.status', 'queued',
                    '$.reason', ''
                  )
                )
            )
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow retry job effect is invalid');
END;
