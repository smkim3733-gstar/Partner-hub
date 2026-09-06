CREATE TRIGGER IF NOT EXISTS consulting_flows_confirm_payment_effect_guard
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
    ), new_payment(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.payments[' || json_array_length(OLD.payload, '$.payments') || ']'
      )
    ), previous_paid(total) AS (
      SELECT COALESCE(SUM(json_extract(payment.value, '$.amountWon')), 0)
      FROM json_each(OLD.payload, '$.payments') AS payment
    )
    SELECT 1 FROM command
    WHERE command.action IS 'confirm_payment'
      AND (
        command.actor_key IS NOT 'admin:primary'
        OR json_type(OLD.payload, '$.contract') IS NOT 'object'
        OR json_array_length(NEW.payload, '$.payments') IS NOT
          json_array_length(OLD.payload, '$.payments') + 1
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.payments') AS previous
          WHERE previous.value IS NOT json_extract(
            NEW.payload, '$.payments[' || previous.key || ']'
          )
        )
        OR json_type((SELECT value FROM new_payment)) IS NOT 'object'
        OR (SELECT count(*) FROM json_each(
          (SELECT value FROM new_payment)
        )) IS NOT 6
        OR EXISTS (
          SELECT 1 FROM json_each((SELECT value FROM new_payment)) AS field
          WHERE field.key NOT IN (
            'id', 'amountWon', 'receivedAt', 'reference', 'confirmedBy',
            'recordedAt'
          )
        )
        OR json_extract(
          (SELECT value FROM new_payment), '$.id'
        ) IS NOT (command.id || '-payment')
        OR json_type(
          (SELECT value FROM new_payment), '$.amountWon'
        ) IS NOT 'integer'
        OR json_extract(
          (SELECT value FROM new_payment), '$.amountWon'
        ) NOT BETWEEN 1 AND 1000000000000
        OR json_type(
          (SELECT value FROM new_payment), '$.receivedAt'
        ) IS NOT 'text'
        OR length(json_extract(
          (SELECT value FROM new_payment), '$.receivedAt'
        )) IS NOT 10
        OR date(json_extract(
          (SELECT value FROM new_payment), '$.receivedAt'
        ), '+0 days') IS NOT json_extract(
          (SELECT value FROM new_payment), '$.receivedAt'
        )
        OR json_extract(
          (SELECT value FROM new_payment), '$.receivedAt'
        ) > date(NEW.updated_at, '+9 hours')
        OR json_type(
          (SELECT value FROM new_payment), '$.reference'
        ) IS NOT 'text'
        OR length(json_extract(
          (SELECT value FROM new_payment), '$.reference'
        )) NOT BETWEEN 1 AND 200
        OR trim(
          json_extract((SELECT value FROM new_payment), '$.reference'),
          char(9) || char(10) || char(11) || char(12) || char(13) ||
          char(32) || char(160) || char(5760) || char(8192) || char(8193) ||
          char(8194) || char(8195) || char(8196) || char(8197) || char(8198) ||
          char(8199) || char(8200) || char(8201) || char(8202) || char(8232) ||
          char(8233) || char(8239) || char(8287) || char(12288) || char(65279)
        ) IS NOT json_extract(
          (SELECT value FROM new_payment), '$.reference'
        )
        OR json_extract(
          (SELECT value FROM new_payment), '$.confirmedBy'
        ) IS NOT '김성민 대표'
        OR json_extract(
          (SELECT value FROM new_payment), '$.recordedAt'
        ) IS NOT NEW.updated_at
        OR CASE
          WHEN json_type(
            OLD.payload, '$.executionStartedAt'
          ) IS 'text' THEN
            json_extract(NEW.payload, '$.executionStartedAt') IS NOT
              json_extract(OLD.payload, '$.executionStartedAt')
          WHEN (
            (SELECT total FROM previous_paid) + json_extract(
              (SELECT value FROM new_payment), '$.amountWon'
            )
          ) >= json_extract(
            OLD.payload, '$.contract.expectedDepositWon'
          ) THEN
            json_extract(NEW.payload, '$.executionStartedAt') IS NOT
              NEW.updated_at
          ELSE json_type(
            NEW.payload, '$.executionStartedAt'
          ) IS NOT NULL
        END
        OR (
          SELECT count(*)
          FROM json_each(NEW.payload, '$.audit') AS audit
          WHERE json_extract(audit.value, '$.id') IS command.id
            AND json_extract(audit.value, '$.at') IS NEW.updated_at
            AND json_extract(audit.value, '$.action') IS 'confirm_payment'
            AND json_extract(audit.value, '$.detail') IS CASE
              WHEN (
                (SELECT total FROM previous_paid) + json_extract(
                  (SELECT value FROM new_payment), '$.amountWon'
                )
              ) >= json_extract(
                OLD.payload, '$.contract.expectedDepositWon'
              ) THEN '약정 계약금 입금 확인 완료 · 컨설팅 수행 시작'
              ELSE '계약금 일부 입금 확인 · 잔액 대기'
            END
        ) IS NOT 1
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow confirm payment effect is invalid');
END;
