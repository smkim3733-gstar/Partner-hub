CREATE TRIGGER IF NOT EXISTS consulting_flows_command_insert_effect_guard
BEFORE INSERT ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) > 0
  AND (
    EXISTS (
      SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE COALESCE(json_extract(receipt.value, '$.action'), '') NOT IN ('import_intake_source', 'save_source', 'exclude_source', 'set_ai_policy', 'queue_report1', 'save_report', 'confirm_analysis', 'book_meeting', 'complete_meeting', 'cancel_meeting', 'save_recording', 'save_transcript', 'retry_job', 'confirm_solutions', 'request_document', 'mark_request_sent', 'receive_document', 'review_document', 'record_contract', 'confirm_payment', 'start_aftercare')
        OR CASE json_extract(receipt.value, '$.action')
          WHEN 'import_intake_source' THEN NOT (COALESCE(json_extract(NEW.payload, '$.files'), char(0)) IS NOT '[]')
          WHEN 'save_source' THEN NOT (COALESCE(json_extract(NEW.payload, '$.ai.sourceText'), char(0)) IS NOT '' OR COALESCE(json_extract(NEW.payload, '$.files'), char(0)) IS NOT '[]')
          WHEN 'exclude_source' THEN NOT (COALESCE(json_extract(NEW.payload, '$.files'), char(0)) IS NOT '[]')
          WHEN 'set_ai_policy' THEN NOT (COALESCE(json_extract(NEW.payload, '$.ai'), char(0)) IS NOT '{"enabled":false,"sourceText":""}')
          WHEN 'queue_report1' THEN NOT (COALESCE(json_extract(NEW.payload, '$.jobs'), char(0)) IS NOT '[]')
          WHEN 'save_report' THEN NOT (COALESCE(json_extract(NEW.payload, '$.reports'), char(0)) IS NOT '[]')
          WHEN 'confirm_analysis' THEN NOT (COALESCE(json_extract(NEW.payload, '$.analysis'), char(0)) IS NOT '{"reportId":""}')
          WHEN 'book_meeting' THEN NOT (COALESCE(json_extract(NEW.payload, '$.meetings'), char(0)) IS NOT '[]')
          WHEN 'complete_meeting' THEN NOT (COALESCE(json_extract(NEW.payload, '$.meetings'), char(0)) IS NOT '[]')
          WHEN 'cancel_meeting' THEN NOT (COALESCE(json_extract(NEW.payload, '$.meetings'), char(0)) IS NOT '[]')
          WHEN 'save_recording' THEN NOT (COALESCE(json_extract(NEW.payload, '$.recordings'), char(0)) IS NOT '[]')
          WHEN 'save_transcript' THEN NOT (COALESCE(json_extract(NEW.payload, '$.recordings'), char(0)) IS NOT '[]')
          WHEN 'retry_job' THEN NOT (COALESCE(json_extract(NEW.payload, '$.jobs'), char(0)) IS NOT '[]')
          WHEN 'confirm_solutions' THEN NOT (json_type(NEW.payload, '$.decision') IS NOT NULL)
          WHEN 'request_document' THEN NOT (COALESCE(json_extract(NEW.payload, '$.requests'), char(0)) IS NOT '[]')
          WHEN 'mark_request_sent' THEN NOT (COALESCE(json_extract(NEW.payload, '$.requests'), char(0)) IS NOT '[]')
          WHEN 'receive_document' THEN NOT (COALESCE(json_extract(NEW.payload, '$.requests'), char(0)) IS NOT '[]')
          WHEN 'review_document' THEN NOT (COALESCE(json_extract(NEW.payload, '$.requests'), char(0)) IS NOT '[]')
          WHEN 'record_contract' THEN NOT (json_type(NEW.payload, '$.contract') IS NOT NULL)
          WHEN 'confirm_payment' THEN NOT (COALESCE(json_extract(NEW.payload, '$.payments'), char(0)) IS NOT '[]')
          WHEN 'start_aftercare' THEN NOT (json_type(NEW.payload, '$.aftercare') IS NOT NULL)
          ELSE 1
        END
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial command effect is invalid');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_command_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) > COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND (
    EXISTS (
      SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
        AND (
          COALESCE(json_extract(receipt.value, '$.action'), '') NOT IN ('import_intake_source', 'save_source', 'exclude_source', 'set_ai_policy', 'queue_report1', 'save_report', 'confirm_analysis', 'book_meeting', 'complete_meeting', 'cancel_meeting', 'save_recording', 'save_transcript', 'retry_job', 'confirm_solutions', 'request_document', 'mark_request_sent', 'receive_document', 'review_document', 'record_contract', 'confirm_payment', 'start_aftercare')
          OR CASE json_extract(receipt.value, '$.action')
            WHEN 'import_intake_source' THEN NOT (json_extract(NEW.payload, '$.files') IS NOT json_extract(OLD.payload, '$.files'))
            WHEN 'save_source' THEN NOT (json_extract(NEW.payload, '$.ai.sourceText') IS NOT json_extract(OLD.payload, '$.ai.sourceText') OR json_extract(NEW.payload, '$.files') IS NOT json_extract(OLD.payload, '$.files'))
            WHEN 'exclude_source' THEN NOT (json_extract(NEW.payload, '$.files') IS NOT json_extract(OLD.payload, '$.files'))
            WHEN 'set_ai_policy' THEN NOT (json_extract(NEW.payload, '$.ai') IS NOT json_extract(OLD.payload, '$.ai'))
            WHEN 'queue_report1' THEN NOT (json_extract(NEW.payload, '$.jobs') IS NOT json_extract(OLD.payload, '$.jobs'))
            WHEN 'save_report' THEN NOT (json_extract(NEW.payload, '$.reports') IS NOT json_extract(OLD.payload, '$.reports'))
            WHEN 'confirm_analysis' THEN NOT (json_extract(NEW.payload, '$.analysis') IS NOT json_extract(OLD.payload, '$.analysis'))
            WHEN 'book_meeting' THEN NOT (json_extract(NEW.payload, '$.meetings') IS NOT json_extract(OLD.payload, '$.meetings'))
            WHEN 'complete_meeting' THEN NOT (json_extract(NEW.payload, '$.meetings') IS NOT json_extract(OLD.payload, '$.meetings'))
            WHEN 'cancel_meeting' THEN NOT (json_extract(NEW.payload, '$.meetings') IS NOT json_extract(OLD.payload, '$.meetings'))
            WHEN 'save_recording' THEN NOT (json_extract(NEW.payload, '$.recordings') IS NOT json_extract(OLD.payload, '$.recordings'))
            WHEN 'save_transcript' THEN NOT (json_extract(NEW.payload, '$.recordings') IS NOT json_extract(OLD.payload, '$.recordings'))
            WHEN 'retry_job' THEN NOT (json_extract(NEW.payload, '$.jobs') IS NOT json_extract(OLD.payload, '$.jobs'))
            WHEN 'confirm_solutions' THEN NOT (json_extract(NEW.payload, '$.decision') IS NOT json_extract(OLD.payload, '$.decision'))
            WHEN 'request_document' THEN NOT (json_extract(NEW.payload, '$.requests') IS NOT json_extract(OLD.payload, '$.requests'))
            WHEN 'mark_request_sent' THEN NOT (json_extract(NEW.payload, '$.requests') IS NOT json_extract(OLD.payload, '$.requests'))
            WHEN 'receive_document' THEN NOT (json_extract(NEW.payload, '$.requests') IS NOT json_extract(OLD.payload, '$.requests'))
            WHEN 'review_document' THEN NOT (json_extract(NEW.payload, '$.requests') IS NOT json_extract(OLD.payload, '$.requests'))
            WHEN 'record_contract' THEN NOT (json_extract(NEW.payload, '$.contract') IS NOT json_extract(OLD.payload, '$.contract'))
            WHEN 'confirm_payment' THEN NOT (json_extract(NEW.payload, '$.payments') IS NOT json_extract(OLD.payload, '$.payments'))
            WHEN 'start_aftercare' THEN NOT (json_extract(NEW.payload, '$.aftercare') IS NOT json_extract(OLD.payload, '$.aftercare'))
            ELSE 1
          END
        )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow command effect is invalid');
END;
