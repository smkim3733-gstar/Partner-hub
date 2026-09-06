DROP TRIGGER IF EXISTS consulting_flows_new_command_receipt_target_guard;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS consulting_flows_new_command_receipt_target_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
  JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
    ON receipt.key IS command.value
  WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
    AND CASE
      WHEN json_extract(receipt.value, '$.action') IN (
        'complete_meeting', 'cancel_meeting', 'mark_request_sent',
        'receive_document', 'review_document', 'record_contract'
      ) THEN
        json_type(receipt.value, '$.targetId') IS NOT 'text'
        OR length(json_extract(receipt.value, '$.targetId')) NOT BETWEEN 1 AND 200
      ELSE json_type(receipt.value, '$.targetId') IS NOT NULL
    END
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow new command receipt target is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS consulting_flows_record_contract_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(id, actor_key, action, target_id) AS (
      SELECT command.value,
        json_extract(receipt.value, '$.actorKey'),
        json_extract(receipt.value, '$.action'),
        json_extract(receipt.value, '$.targetId')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), previous_meeting(key, value) AS (
      SELECT meeting.key, meeting.value
      FROM command, json_each(OLD.payload, '$.meetings') AS meeting
      WHERE json_extract(meeting.value, '$.id') IS command.target_id
    ), current_meeting(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.meetings[' || previous_meeting.key || ']'
      )
      FROM previous_meeting
    ), latest_report(value) AS (
      SELECT report.value
      FROM json_each(OLD.payload, '$.reports') AS report
      WHERE json_extract(report.value, '$.stage') = 6
      ORDER BY CAST(report.key AS INTEGER) DESC
      LIMIT 1
    )
    SELECT 1 FROM command
    WHERE command.action IS 'record_contract'
      AND (
        typeof(command.target_id) <> 'text'
        OR length(command.target_id) NOT BETWEEN 1 AND 200
        OR json_type(OLD.payload, '$.contract') IS NOT NULL
        OR (SELECT count(*) FROM previous_meeting) IS NOT 1
        OR json_extract(
          (SELECT value FROM previous_meeting), '$.kind'
        ) IS NOT 'contract'
        OR json_extract(
          (SELECT value FROM previous_meeting), '$.status'
        ) NOT IN ('scheduled', 'completed')
        OR json_extract(
          (SELECT value FROM previous_meeting), '$.startsAt'
        ) > NEW.updated_at
        OR NOT (
          command.actor_key IS 'admin:primary'
          OR (
            command.actor_key IS
              ('member:' || json_extract(OLD.payload, '$.partnerId'))
            AND json_extract(
              (SELECT value FROM previous_meeting), '$.attendance'
            ) IN ('both', 'partner')
          )
        )
        OR json_array_length(NEW.payload, '$.meetings') IS NOT
          json_array_length(OLD.payload, '$.meetings')
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.meetings') AS previous
          WHERE json_extract(previous.value, '$.id') IS NOT command.target_id
            AND previous.value IS NOT json_extract(
              NEW.payload, '$.meetings[' || previous.key || ']'
            )
        )
        OR CASE json_extract(
          (SELECT value FROM previous_meeting), '$.status'
        )
          WHEN 'scheduled' THEN json(
            (SELECT value FROM current_meeting)
          ) IS NOT json(json_set(
            (SELECT value FROM previous_meeting),
            '$.status', 'completed', '$.completedAt', NEW.updated_at
          ))
          WHEN 'completed' THEN json(
            (SELECT value FROM current_meeting)
          ) IS NOT json((SELECT value FROM previous_meeting))
          ELSE 1
        END
        OR json_type(OLD.payload, '$.decision') IS NOT 'object'
        OR NOT EXISTS (
          WITH latest_source_report(id) AS (
            SELECT json_extract(report.value, '$.id')
            FROM json_each(OLD.payload, '$.reports') AS report
            WHERE json_extract(report.value, '$.stage') = 1
            ORDER BY CAST(report.key AS INTEGER) DESC
            LIMIT 1
          ), latest_recording(id) AS (
            SELECT json_extract(recording.value, '$.id')
            FROM json_each(OLD.payload, '$.recordings') AS recording
            ORDER BY CAST(recording.key AS INTEGER) DESC
            LIMIT 1
          )
          SELECT 1 FROM json_each(OLD.payload, '$.reports') AS report
          WHERE json_extract(report.value, '$.stage') = 4
            AND json_extract(report.value, '$.id') IS
              json_extract(OLD.payload, '$.decision.reportId')
            AND json_extract(report.value, '$.sourceReportId') IS
              (SELECT id FROM latest_source_report)
            AND json_extract(report.value, '$.sourceRecordingId') IS
              (SELECT id FROM latest_recording)
          ORDER BY CAST(report.key AS INTEGER) DESC
          LIMIT 1
        )
        OR (
          json_extract(OLD.payload, '$.decision.documentsNeeded') IS 1
          AND NOT EXISTS (
            SELECT 1 FROM json_each(OLD.payload, '$.requests') AS request
            WHERE json_extract(request.value, '$.required') IS 1
          )
        )
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.requests') AS request
          WHERE json_extract(request.value, '$.required') IS 1
            AND json_extract(request.value, '$.status') IS NOT 'verified'
        )
        OR NOT EXISTS (
          SELECT 1 FROM (
            SELECT report.value
            FROM json_each(OLD.payload, '$.reports') AS report
            WHERE json_extract(report.value, '$.stage') = 5
            ORDER BY CAST(report.key AS INTEGER) DESC
            LIMIT 1
          ) AS report
          WHERE json_extract(report.value, '$.decisionId') IS
              json_extract(OLD.payload, '$.decision.id')
            AND json_extract(report.value, '$.documentsKey') IS (
              SELECT json_group_array(json_array(
                json_extract(request.value, '$.id'),
                json_extract(request.value, '$.fileId'),
                json_extract(request.value, '$.verifiedAt')
              ))
              FROM json_each(OLD.payload, '$.requests') AS request
              WHERE json_extract(request.value, '$.required') IS 1
            )
        )
        OR NOT EXISTS (
          SELECT 1 FROM latest_report AS report
          WHERE json_extract(report.value, '$.decisionId') IS
              json_extract(OLD.payload, '$.decision.id')
            AND json_extract(report.value, '$.documentsKey') IS (
              SELECT json_group_array(json_array(
                json_extract(request.value, '$.id'),
                json_extract(request.value, '$.fileId'),
                json_extract(request.value, '$.verifiedAt')
              ))
              FROM json_each(OLD.payload, '$.requests') AS request
              WHERE json_extract(request.value, '$.required') IS 1
            )
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow record contract effect is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS consulting_flows_record_contract_evidence_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(id, actor_key, action, target_id) AS (
      SELECT command.value,
        json_extract(receipt.value, '$.actorKey'),
        json_extract(receipt.value, '$.action'),
        json_extract(receipt.value, '$.targetId')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), latest_report(value) AS (
      SELECT report.value
      FROM json_each(OLD.payload, '$.reports') AS report
      WHERE json_extract(report.value, '$.stage') = 6
      ORDER BY CAST(report.key AS INTEGER) DESC
      LIMIT 1
    ), new_file(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.files[' || json_array_length(OLD.payload, '$.files') || ']'
      )
    )
    SELECT 1 FROM command
    WHERE command.action IS 'record_contract'
      AND (
        json_type(NEW.payload, '$.contract') IS NOT 'object'
        OR (SELECT count(*) FROM json_each(
          NEW.payload, '$.contract'
        )) IS NOT 6
        OR EXISTS (
          SELECT 1 FROM json_each(NEW.payload, '$.contract') AS field
          WHERE field.key NOT IN (
            'meetingId', 'reportId', 'signedFileId', 'signedAt',
            'expectedDepositWon', 'recordedBy'
          )
        )
        OR json_extract(NEW.payload, '$.contract.meetingId') IS NOT
          command.target_id
        OR json_extract(NEW.payload, '$.contract.reportId') IS NOT
          json_extract((SELECT value FROM latest_report), '$.id')
        OR json_extract(NEW.payload, '$.contract.signedFileId') IS NOT
          json_extract((SELECT value FROM new_file), '$.id')
        OR json_type(NEW.payload, '$.contract.signedAt') IS NOT 'text'
        OR length(json_extract(
          NEW.payload, '$.contract.signedAt'
        )) IS NOT 10
        OR date(
          json_extract(NEW.payload, '$.contract.signedAt'), '+0 days'
        ) IS NOT json_extract(NEW.payload, '$.contract.signedAt')
        OR json_extract(NEW.payload, '$.contract.signedAt') >
          date(NEW.updated_at, '+9 hours')
        OR json_type(
          NEW.payload, '$.contract.expectedDepositWon'
        ) IS NOT 'integer'
        OR json_extract(
          NEW.payload, '$.contract.expectedDepositWon'
        ) NOT BETWEEN 1 AND 1000000000000
        OR json_extract(NEW.payload, '$.contract.recordedBy') IS NOT CASE
          WHEN command.actor_key IS 'admin:primary' THEN '김성민 대표'
          WHEN command.actor_key IS
              ('member:' || json_extract(OLD.payload, '$.partnerId'))
          THEN json_extract(OLD.payload, '$.partnerName')
          ELSE NULL
        END
        OR json_array_length(NEW.payload, '$.files') IS NOT
          json_array_length(OLD.payload, '$.files') + 1
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.files') AS previous
          WHERE previous.value IS NOT json_extract(
            NEW.payload, '$.files[' || previous.key || ']'
          )
        )
        OR json_type((SELECT value FROM new_file)) IS NOT 'object'
        OR (SELECT count(*) FROM json_each(
          (SELECT value FROM new_file)
        )) IS NOT 7
        OR EXISTS (
          SELECT 1 FROM json_each((SELECT value FROM new_file)) AS field
          WHERE field.key NOT IN (
            'id', 'name', 'contentType', 'size', 'key', 'createdAt', 'purpose'
          )
        )
        OR json_extract(
          (SELECT value FROM new_file), '$.purpose'
        ) IS NOT 'signed_contract'
        OR json_extract(
          (SELECT value FROM new_file), '$.createdAt'
        ) IS NOT NEW.updated_at
        OR json_type(
          (SELECT value FROM new_file), '$.intakeFileId'
        ) IS NOT NULL
        OR json_type(
          (SELECT value FROM new_file), '$.intakeSourceHash'
        ) IS NOT NULL
        OR json_type(
          (SELECT value FROM new_file), '$.sourceReviewedAt'
        ) IS NOT NULL
        OR json_type(
          (SELECT value FROM new_file), '$.sourceReviewedBy'
        ) IS NOT NULL
        OR (
          SELECT count(*)
          FROM json_each(NEW.payload, '$.audit') AS audit
          WHERE json_extract(audit.value, '$.id') IS command.id
            AND json_extract(audit.value, '$.at') IS NEW.updated_at
            AND json_extract(audit.value, '$.action') IS 'record_contract'
            AND json_extract(audit.value, '$.detail') IS
              '서명본과 약정 계약금 등록 · 입금 확인 대기'
        ) IS NOT 1
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow record contract effect is invalid');
END;
