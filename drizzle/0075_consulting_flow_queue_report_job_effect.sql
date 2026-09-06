CREATE TRIGGER IF NOT EXISTS consulting_flows_queue_report_job_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(id, action) AS (
      SELECT command.value, json_extract(receipt.value, '$.action')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), new_job(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.jobs[' || json_array_length(OLD.payload, '$.jobs') || ']'
      )
    ), expected(reason) AS (
      SELECT CASE WHEN json_extract(NEW.payload, '$.ai.enabled') IS 0
        THEN '김성민 대표의 외부 AI 자동생성 승인이 필요합니다.'
        ELSE ''
      END
    )
    SELECT 1
    FROM command
    CROSS JOIN new_job
    CROSS JOIN expected
    WHERE command.action IS 'queue_report1'
      AND (
        json_array_length(NEW.payload, '$.jobs') IS NOT
          json_array_length(OLD.payload, '$.jobs') + 1
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.jobs') AS previous
          WHERE json(json_extract(
              NEW.payload,
              '$.jobs[' || previous.key || ']'
            )) IS NOT json(previous.value)
        )
        OR json(new_job.value) IS NOT json(json_object(
          'id', command.id || '-job',
          'stage', 1,
          'status', CASE WHEN expected.reason = '' THEN 'queued' ELSE 'blocked' END,
          'reason', expected.reason,
          'createdAt', NEW.updated_at
        ))
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow queue report job effect is invalid');
END;
