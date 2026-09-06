CREATE TRIGGER IF NOT EXISTS consulting_flows_start_aftercare_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(id, actor_key, action) AS (
      SELECT command.value,
        json_extract(receipt.value, '$.actorKey'),
        json_extract(receipt.value, '$.action')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), previous_paid(total) AS (
      SELECT COALESCE(SUM(json_extract(payment.value, '$.amountWon')), 0)
      FROM json_each(OLD.payload, '$.payments') AS payment
    )
    SELECT 1 FROM command
    WHERE command.action IS 'start_aftercare'
      AND (
        command.actor_key IS NOT 'admin:primary'
        OR json_type(OLD.payload, '$.contract') IS NOT 'object'
        OR json_type(OLD.payload, '$.executionStartedAt') IS NOT 'text'
        OR (SELECT total FROM previous_paid) < json_extract(
          OLD.payload, '$.contract.expectedDepositWon'
        )
        OR json_type(NEW.payload, '$.aftercare') IS NOT 'object'
        OR (
          SELECT count(*) FROM json_each(NEW.payload, '$.aftercare')
        ) IS NOT 4
        OR EXISTS (
          SELECT 1 FROM json_each(NEW.payload, '$.aftercare') AS field
          WHERE field.key NOT IN ('at', 'summary', 'nextDate', 'owner')
        )
        OR json_extract(NEW.payload, '$.aftercare.at') IS NOT NEW.updated_at
        OR json_type(NEW.payload, '$.aftercare.summary') IS NOT 'text'
        OR length(
          json_extract(NEW.payload, '$.aftercare.summary')
        ) NOT BETWEEN 1 AND 3000
        OR trim(
          json_extract(NEW.payload, '$.aftercare.summary'),
          char(9) || char(10) || char(11) || char(12) || char(13) ||
          char(32) || char(160) || char(5760) || char(8192) || char(8193) ||
          char(8194) || char(8195) || char(8196) || char(8197) || char(8198) ||
          char(8199) || char(8200) || char(8201) || char(8202) || char(8232) ||
          char(8233) || char(8239) || char(8287) || char(12288) || char(65279)
        ) IS NOT json_extract(NEW.payload, '$.aftercare.summary')
        OR json_type(NEW.payload, '$.aftercare.nextDate') IS NOT 'text'
        OR length(
          json_extract(NEW.payload, '$.aftercare.nextDate')
        ) IS NOT 10
        OR date(
          json_extract(NEW.payload, '$.aftercare.nextDate'), '+0 days'
        ) IS NOT json_extract(NEW.payload, '$.aftercare.nextDate')
        OR json_type(NEW.payload, '$.aftercare.owner') IS NOT 'text'
        OR length(
          json_extract(NEW.payload, '$.aftercare.owner')
        ) NOT BETWEEN 1 AND 100
        OR trim(
          json_extract(NEW.payload, '$.aftercare.owner'),
          char(9) || char(10) || char(11) || char(12) || char(13) ||
          char(32) || char(160) || char(5760) || char(8192) || char(8193) ||
          char(8194) || char(8195) || char(8196) || char(8197) || char(8198) ||
          char(8199) || char(8200) || char(8201) || char(8202) || char(8232) ||
          char(8233) || char(8239) || char(8287) || char(12288) || char(65279)
        ) IS NOT json_extract(NEW.payload, '$.aftercare.owner')
        OR (
          SELECT count(*)
          FROM json_each(NEW.payload, '$.audit') AS audit
          WHERE json_extract(audit.value, '$.id') IS command.id
            AND json_extract(audit.value, '$.at') IS NEW.updated_at
            AND json_extract(audit.value, '$.action') IS 'start_aftercare'
            AND json_extract(audit.value, '$.detail') IS
              '컨설팅 수행 결과 확인 · 사후관리 일정 등록'
        ) IS NOT 1
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow start aftercare effect is invalid');
END;
