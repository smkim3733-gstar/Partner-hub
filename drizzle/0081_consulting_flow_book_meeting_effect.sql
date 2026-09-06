CREATE TRIGGER IF NOT EXISTS consulting_flows_book_meeting_effect_guard
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
    ), meeting(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.meetings[' || json_array_length(OLD.payload, '$.meetings') || ']'
      )
    )
    SELECT 1
    FROM command
    CROSS JOIN meeting
    WHERE command.action IS 'book_meeting'
      AND (
        json_array_length(NEW.payload, '$.meetings') IS NOT
          json_array_length(OLD.payload, '$.meetings') + 1
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.meetings') AS previous
          WHERE json(json_extract(
              NEW.payload,
              '$.meetings[' || previous.key || ']'
            )) IS NOT json(previous.value)
        )
        OR json_type(meeting.value) IS NOT 'object'
        OR (SELECT count(*) FROM json_each(meeting.value)) IS NOT 9
        OR EXISTS (
          SELECT 1 FROM json_each(meeting.value) AS field
          WHERE field.key NOT IN (
            'id', 'kind', 'startsAt', 'endsAt', 'attendance', 'location',
            'status', 'note', 'createdBy'
          )
        )
        OR json_extract(meeting.value, '$.id') IS NOT
          (command.id || '-meeting')
        OR json_type(meeting.value, '$.kind') IS NOT 'text'
        OR json_extract(meeting.value, '$.kind') NOT IN (
          'first', 'followup', 'contract'
        )
        OR json_type(meeting.value, '$.startsAt') IS NOT 'text'
        OR json_extract(meeting.value, '$.startsAt') IS NOT strftime(
          '%Y-%m-%dT%H:%M:%fZ', json_extract(meeting.value, '$.startsAt')
        )
        OR json_type(meeting.value, '$.endsAt') IS NOT 'text'
        OR json_extract(meeting.value, '$.endsAt') IS NOT strftime(
          '%Y-%m-%dT%H:%M:%fZ', json_extract(meeting.value, '$.endsAt')
        )
        OR json_extract(meeting.value, '$.endsAt') <=
          json_extract(meeting.value, '$.startsAt')
        OR json_type(meeting.value, '$.attendance') IS NOT 'text'
        OR json_extract(meeting.value, '$.attendance') NOT IN (
          'both', 'partner', 'admin'
        )
        OR json_type(meeting.value, '$.location') IS NOT 'text'
        OR json_extract(meeting.value, '$.location') IS NOT
          trim(json_extract(meeting.value, '$.location'))
        OR length(json_extract(meeting.value, '$.location')) NOT BETWEEN 1 AND 200
        OR json_extract(meeting.value, '$.status') IS NOT 'scheduled'
        OR json_type(meeting.value, '$.note') IS NOT 'text'
        OR json_extract(meeting.value, '$.note') IS NOT
          trim(json_extract(meeting.value, '$.note'))
        OR length(json_extract(meeting.value, '$.note')) > 1000
        OR json_extract(meeting.value, '$.createdBy') IS NOT CASE
          WHEN command.actor_key IS 'admin:primary' THEN 'admin:primary'
          WHEN command.actor_key IS
              ('member:' || json_extract(OLD.payload, '$.partnerId'))
          THEN json_extract(OLD.payload, '$.partnerId')
          ELSE NULL
        END
        OR json_type(meeting.value, '$.completedAt') IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.meetings') AS previous
          WHERE json_extract(previous.value, '$.status') IS 'scheduled'
            AND json_extract(meeting.value, '$.startsAt') <
              json_extract(previous.value, '$.endsAt')
            AND json_extract(meeting.value, '$.endsAt') >
              json_extract(previous.value, '$.startsAt')
        )
        OR CASE json_extract(meeting.value, '$.kind')
          WHEN 'first' THEN
            json_extract(meeting.value, '$.attendance') IS NOT 'both'
            OR json_extract(OLD.payload, '$.analysis.reportId') IS NOT (
              SELECT json_extract(report.value, '$.id')
              FROM json_each(OLD.payload, '$.reports') AS report
              WHERE json_extract(report.value, '$.stage') = 1
              ORDER BY CAST(report.key AS INTEGER) DESC
              LIMIT 1
            )
            OR json_type(OLD.payload, '$.analysis.adminAt') IS NOT 'text'
            OR json_type(OLD.payload, '$.analysis.partnerAt') IS NOT 'text'
            OR EXISTS (
              SELECT 1 FROM json_each(OLD.payload, '$.meetings') AS previous
              WHERE json_extract(previous.value, '$.kind') IS 'first'
                AND json_extract(previous.value, '$.status') IS NOT 'cancelled'
            )
          WHEN 'followup' THEN NOT EXISTS (
            SELECT 1 FROM json_each(OLD.payload, '$.meetings') AS previous
            WHERE json_extract(previous.value, '$.kind') IS 'first'
              AND json_extract(previous.value, '$.status') IS NOT 'cancelled'
              AND json_extract(previous.value, '$.status') IS 'completed'
            ORDER BY CAST(previous.key AS INTEGER)
            LIMIT 1
          )
          WHEN 'contract' THEN
            json_type(OLD.payload, '$.contract') IS NOT NULL
            OR json_type(OLD.payload, '$.decision') IS NOT 'object'
            OR NOT EXISTS (
              WITH latest_report(id) AS (
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
                  (SELECT id FROM latest_report)
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
              SELECT 1 FROM (
                SELECT report.value
                FROM json_each(OLD.payload, '$.reports') AS report
                WHERE json_extract(report.value, '$.stage') = 6
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
          ELSE 1
        END
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow book meeting effect is invalid');
END;
