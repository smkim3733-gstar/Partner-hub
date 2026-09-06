CREATE TRIGGER IF NOT EXISTS consulting_flows_save_transcript_jobs_guard
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
    WHERE command.action IS 'save_transcript'
      AND (
        json_array_length(NEW.payload, '$.jobs') IS NOT
          json_array_length(OLD.payload, '$.jobs')
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
          WHERE json(json_extract(
              NEW.payload,
              '$.jobs[' || previous.key || ']'
            )) IS NOT json(
              CASE
                WHEN previous.key IS (
                    SELECT target.key
                    FROM json_each(OLD.payload, '$.jobs') AS target
                    WHERE json_type(target.value, '$.sourceRecordingId') = 'text'
                      AND json_extract(target.value, '$.sourceRecordingId') IS (
                        SELECT json_extract(recording.value, '$.id')
                        FROM json_each(NEW.payload, '$.recordings') AS recording
                        ORDER BY CAST(recording.key AS INTEGER) DESC
                        LIMIT 1
                      )
                    ORDER BY CAST(target.key AS INTEGER) DESC
                    LIMIT 1
                  )
                  AND NOT (
                    json_extract(previous.value, '$.status') IS 'failed'
                    AND json_extract(NEW.payload, '$.ai.enabled') IS 0
                  )
                THEN json_set(
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
                  '$.status',
                    CASE WHEN json_extract(NEW.payload, '$.ai.enabled') IS 1
                      THEN 'queued' ELSE 'blocked' END,
                  '$.reason',
                    CASE WHEN json_extract(NEW.payload, '$.ai.enabled') IS 1
                      THEN '' ELSE '대표의 AI 자동생성 승인이 필요합니다.' END
                )
                ELSE previous.value
              END
            )
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow save transcript jobs are invalid');
END;
