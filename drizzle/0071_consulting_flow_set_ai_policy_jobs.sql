CREATE TRIGGER IF NOT EXISTS consulting_flows_set_ai_policy_jobs_guard
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
    WHERE command.action IS 'set_ai_policy'
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
                WHEN json_extract(NEW.payload, '$.ai.enabled') IS 0
                  AND json_extract(previous.value, '$.status') IS 'queued'
                THEN json_set(
                  previous.value,
                  '$.status', 'blocked',
                  '$.reason', '대표가 자동생성을 중지했습니다.'
                )
                ELSE previous.value
              END
            )
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow set AI policy jobs are invalid');
END;
