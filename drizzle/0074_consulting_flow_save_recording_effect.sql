CREATE TRIGGER IF NOT EXISTS consulting_flows_save_recording_effect_guard
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
    ), recording(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.recordings[' ||
          json_array_length(OLD.payload, '$.recordings') || ']'
      )
    ), new_job(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.jobs[' || json_array_length(OLD.payload, '$.jobs') || ']'
      )
    ), expected(reason) AS (
      SELECT CASE
        WHEN COALESCE(json_extract(recording.value, '$.transcript'), '') = ''
        THEN '전사문 대기: Word·TXT를 첨부하거나 본문을 입력해 주세요. 음성은 보관만 하며 자동전사는 미연결입니다.'
        WHEN json_extract(NEW.payload, '$.ai.enabled') IS 0
        THEN '김성민 대표의 외부 AI 자동생성 승인이 필요합니다.'
        ELSE ''
      END
      FROM recording
    )
    SELECT 1
    FROM command
    CROSS JOIN recording
    CROSS JOIN new_job
    CROSS JOIN expected
    WHERE command.action IS 'save_recording'
      AND (
        json_array_length(NEW.payload, '$.recordings') IS NOT
          json_array_length(OLD.payload, '$.recordings') + 1
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.recordings') AS previous
          WHERE json(json_extract(
              NEW.payload,
              '$.recordings[' || previous.key || ']'
            )) IS NOT json(previous.value)
        )
        OR json_extract(recording.value, '$.id') IS NOT
          (command.id || '-recording')
        OR json_extract(recording.value, '$.createdAt') IS NOT NEW.updated_at
        OR json_extract(recording.value, '$.consentAt') IS NOT NEW.updated_at
        OR json_extract(recording.value, '$.transcript') IS NOT
          trim(json_extract(recording.value, '$.transcript'))
        OR NOT EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.meetings') AS meeting
          WHERE json_extract(meeting.value, '$.id') IS
              json_extract(recording.value, '$.meetingId')
            AND json_extract(meeting.value, '$.status') IS 'completed'
        )
        OR CASE
          WHEN COALESCE(json_extract(recording.value, '$.transcript'), '') <> ''
          THEN json_extract(recording.value, '$.transcriptReviewedAt') IS NOT
              NEW.updated_at
            OR COALESCE(
              trim(json_extract(recording.value, '$.transcriptReviewedBy')),
              ''
            ) = ''
          ELSE json_type(recording.value, '$.transcriptReviewedAt') IS NOT NULL
            OR json_type(recording.value, '$.transcriptReviewedBy') IS NOT NULL
        END
        OR json_array_length(NEW.payload, '$.files') IS NOT
          json_array_length(OLD.payload, '$.files') +
          CASE WHEN json_type(recording.value, '$.fileId') = 'text'
            THEN 1 ELSE 0 END +
          CASE WHEN json_type(recording.value, '$.audioFileId') = 'text'
              AND json_extract(recording.value, '$.audioFileId') IS NOT
                json_extract(recording.value, '$.fileId')
            THEN 1 ELSE 0 END
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.files') AS previous
          WHERE json(json_extract(
              NEW.payload,
              '$.files[' || previous.key || ']'
            )) IS NOT json(previous.value)
        )
        OR EXISTS (
          SELECT 1 FROM json_each(NEW.payload, '$.files') AS file
          WHERE CAST(file.key AS INTEGER) >=
              json_array_length(OLD.payload, '$.files')
            AND (
              json_extract(file.value, '$.purpose') IS NOT 'recording'
              OR json_extract(file.value, '$.createdAt') IS NOT NEW.updated_at
              OR (
                json_extract(file.value, '$.id') IS NOT
                  json_extract(recording.value, '$.fileId')
                AND json_extract(file.value, '$.id') IS NOT
                  json_extract(recording.value, '$.audioFileId')
              )
            )
        )
        OR (
          json_type(recording.value, '$.fileId') = 'text'
          AND json_extract(
            NEW.payload,
            '$.files[' || json_array_length(OLD.payload, '$.files') || '].id'
          ) IS NOT json_extract(recording.value, '$.fileId')
        )
        OR (
          json_type(recording.value, '$.audioFileId') = 'text'
          AND json_extract(recording.value, '$.audioFileId') IS NOT
            json_extract(recording.value, '$.fileId')
          AND json_extract(
            NEW.payload,
            '$.files[' ||
              (json_array_length(OLD.payload, '$.files') +
                CASE WHEN json_type(recording.value, '$.fileId') = 'text'
                  THEN 1 ELSE 0 END) || '].id'
          ) IS NOT json_extract(recording.value, '$.audioFileId')
        )
        OR (
          json_type(recording.value, '$.fileId') = 'text'
          AND (
            lower(json_extract(
              NEW.payload,
              '$.files[' || json_array_length(OLD.payload, '$.files') || '].name'
            )) GLOB '*.docx'
            OR lower(json_extract(
              NEW.payload,
              '$.files[' || json_array_length(OLD.payload, '$.files') || '].name'
            )) GLOB '*.txt'
          )
          AND json_extract(recording.value, '$.transcriptFileId') IS NOT
            json_extract(recording.value, '$.fileId')
        )
        OR (
          (
            json_type(recording.value, '$.fileId') IS NOT 'text'
            OR NOT (
              lower(json_extract(
                NEW.payload,
                '$.files[' || json_array_length(OLD.payload, '$.files') || '].name'
              )) GLOB '*.docx'
              OR lower(json_extract(
                NEW.payload,
                '$.files[' || json_array_length(OLD.payload, '$.files') || '].name'
              )) GLOB '*.txt'
            )
          )
          AND json_type(recording.value, '$.transcriptFileId') IS NOT NULL
        )
        OR (
          json_type(recording.value, '$.fileId') = 'text'
          AND (
            lower(json_extract(
              NEW.payload,
              '$.files[' || json_array_length(OLD.payload, '$.files') || '].name'
            )) GLOB '*.mp3'
            OR lower(json_extract(
              NEW.payload,
              '$.files[' || json_array_length(OLD.payload, '$.files') || '].name'
            )) GLOB '*.m4a'
            OR lower(json_extract(
              NEW.payload,
              '$.files[' || json_array_length(OLD.payload, '$.files') || '].name'
            )) GLOB '*.wav'
          )
          AND json_extract(recording.value, '$.audioFileId') IS NOT
            json_extract(recording.value, '$.fileId')
        )
        OR (
          json_type(recording.value, '$.fileId') = 'text'
          AND NOT (
            lower(json_extract(
              NEW.payload,
              '$.files[' || json_array_length(OLD.payload, '$.files') || '].name'
            )) GLOB '*.mp3'
            OR lower(json_extract(
              NEW.payload,
              '$.files[' || json_array_length(OLD.payload, '$.files') || '].name'
            )) GLOB '*.m4a'
            OR lower(json_extract(
              NEW.payload,
              '$.files[' || json_array_length(OLD.payload, '$.files') || '].name'
            )) GLOB '*.wav'
          )
          AND json_extract(recording.value, '$.audioFileId') IS
            json_extract(recording.value, '$.fileId')
        )
        OR (
          json_type(recording.value, '$.audioFileId') = 'text'
          AND NOT EXISTS (
            SELECT 1 FROM json_each(NEW.payload, '$.files') AS audio
            WHERE CAST(audio.key AS INTEGER) >=
                json_array_length(OLD.payload, '$.files')
              AND json_extract(audio.value, '$.id') IS
                json_extract(recording.value, '$.audioFileId')
              AND (
                lower(json_extract(audio.value, '$.name')) GLOB '*.mp3'
                OR lower(json_extract(audio.value, '$.name')) GLOB '*.m4a'
                OR lower(json_extract(audio.value, '$.name')) GLOB '*.wav'
              )
          )
        )
        OR json_array_length(NEW.payload, '$.jobs') IS NOT
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
          'stage', 4,
          'sourceRecordingId', command.id || '-recording',
          'sourceReportId', (
            SELECT json_extract(report.value, '$.id')
            FROM json_each(NEW.payload, '$.reports') AS report
            WHERE json_extract(report.value, '$.stage') = 1
            ORDER BY CAST(report.key AS INTEGER) DESC
            LIMIT 1
          ),
          'status', CASE WHEN expected.reason = '' THEN 'queued' ELSE 'blocked' END,
          'reason', expected.reason,
          'createdAt', NEW.updated_at
        ))
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow save recording effect is invalid');
END;
