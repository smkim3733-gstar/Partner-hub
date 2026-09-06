CREATE TRIGGER IF NOT EXISTS consulting_flows_confirm_analysis_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(actor_key, action) AS (
      SELECT json_extract(receipt.value, '$.actorKey'),
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
    )
    SELECT 1
    FROM command
    WHERE command.action IS 'confirm_analysis'
      AND (
        NOT EXISTS (SELECT 1 FROM latest_report)
        OR CASE
          WHEN command.actor_key IS 'admin:primary'
          THEN json(json_extract(NEW.payload, '$.analysis')) IS NOT json(
            CASE
              WHEN json_extract(OLD.payload, '$.analysis.reportId') IS
                  (SELECT id FROM latest_report)
              THEN json_set(
                json(json_extract(OLD.payload, '$.analysis')),
                '$.adminAt', NEW.updated_at
              )
              ELSE json_object(
                'reportId', (SELECT id FROM latest_report),
                'adminAt', NEW.updated_at
              )
            END
          )
          WHEN command.actor_key IS
              ('member:' || json_extract(OLD.payload, '$.partnerId'))
          THEN json(json_extract(NEW.payload, '$.analysis')) IS NOT json(
            CASE
              WHEN json_extract(OLD.payload, '$.analysis.reportId') IS
                  (SELECT id FROM latest_report)
              THEN json_set(
                json(json_extract(OLD.payload, '$.analysis')),
                '$.partnerAt', NEW.updated_at
              )
              ELSE json_object(
                'reportId', (SELECT id FROM latest_report),
                'partnerAt', NEW.updated_at
              )
            END
          )
          ELSE 1
        END
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow confirm analysis effect is invalid');
END;
