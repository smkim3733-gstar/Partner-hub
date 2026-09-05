CREATE TRIGGER IF NOT EXISTS consulting_flows_command_insert_scope_guard
BEFORE INSERT ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
    LEFT JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
      ON receipt.key IS command.value
    WHERE receipt.key IS NULL
  )
  AND EXISTS (
    WITH new_actions(action) AS (
      SELECT json_extract(receipt.value, '$.action')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
    ), allowed(action, path) AS (
      VALUES ('import_intake_source', '$.files'),
      ('save_source', '$.ai.sourceText'),
      ('save_source', '$.files'),
      ('exclude_source', '$.files'),
      ('set_ai_policy', '$.ai.enabled'),
      ('set_ai_policy', '$.ai.approvedAt'),
      ('set_ai_policy', '$.ai.approvedBy'),
      ('set_ai_policy', '$.jobs'),
      ('queue_report1', '$.jobs'),
      ('save_report', '$.reports'),
      ('save_report', '$.files'),
      ('save_report', '$.analysis'),
      ('confirm_analysis', '$.analysis'),
      ('book_meeting', '$.meetings'),
      ('complete_meeting', '$.meetings'),
      ('cancel_meeting', '$.meetings'),
      ('save_recording', '$.recordings'),
      ('save_recording', '$.jobs'),
      ('save_recording', '$.files'),
      ('save_transcript', '$.recordings'),
      ('save_transcript', '$.jobs'),
      ('save_transcript', '$.files'),
      ('retry_job', '$.jobs'),
      ('confirm_solutions', '$.decision'),
      ('request_document', '$.requests'),
      ('mark_request_sent', '$.requests'),
      ('receive_document', '$.requests'),
      ('receive_document', '$.files'),
      ('review_document', '$.requests'),
      ('record_contract', '$.contract'),
      ('record_contract', '$.meetings'),
      ('record_contract', '$.files'),
      ('confirm_payment', '$.payments'),
      ('confirm_payment', '$.executionStartedAt'),
      ('start_aftercare', '$.aftercare')
    ), changed(path) AS (
      SELECT value FROM json_each(json_array(
        CASE WHEN COALESCE(json_extract(NEW.payload, '$.reports'), char(0)) IS NOT '[]' THEN '$.reports' END,
        CASE WHEN COALESCE(json_extract(NEW.payload, '$.files'), char(0)) IS NOT '[]' THEN '$.files' END,
        CASE WHEN COALESCE(json_extract(NEW.payload, '$.analysis'), char(0)) IS NOT '{"reportId":""}' THEN '$.analysis' END,
        CASE WHEN COALESCE(json_extract(NEW.payload, '$.meetings'), char(0)) IS NOT '[]' THEN '$.meetings' END,
        CASE WHEN COALESCE(json_extract(NEW.payload, '$.recordings'), char(0)) IS NOT '[]' THEN '$.recordings' END,
        CASE WHEN COALESCE(json_extract(NEW.payload, '$.requests'), char(0)) IS NOT '[]' THEN '$.requests' END,
        CASE WHEN json_type(NEW.payload, '$.decision') IS NOT NULL THEN '$.decision' END,
        CASE WHEN json_type(NEW.payload, '$.contract') IS NOT NULL THEN '$.contract' END,
        CASE WHEN COALESCE(json_extract(NEW.payload, '$.payments'), char(0)) IS NOT '[]' THEN '$.payments' END,
        CASE WHEN json_type(NEW.payload, '$.executionStartedAt') IS NOT NULL THEN '$.executionStartedAt' END,
        CASE WHEN json_type(NEW.payload, '$.aftercare') IS NOT NULL THEN '$.aftercare' END,
        CASE WHEN COALESCE(json_extract(NEW.payload, '$.ai.enabled'), char(0)) IS NOT 0 THEN '$.ai.enabled' END,
        CASE WHEN json_type(NEW.payload, '$.ai.approvedAt') IS NOT NULL THEN '$.ai.approvedAt' END,
        CASE WHEN json_type(NEW.payload, '$.ai.approvedBy') IS NOT NULL THEN '$.ai.approvedBy' END,
        CASE WHEN COALESCE(json_extract(NEW.payload, '$.ai.sourceText'), char(0)) IS NOT '' THEN '$.ai.sourceText' END,
        CASE WHEN COALESCE(json_extract(NEW.payload, '$.jobs'), char(0)) IS NOT '[]' THEN '$.jobs' END
      )) WHERE value IS NOT NULL
    )
    SELECT 1 FROM changed
    WHERE NOT EXISTS (
      SELECT 1 FROM new_actions
      JOIN allowed ON allowed.action IS new_actions.action
      WHERE allowed.path IS changed.path
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial command scope is invalid');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_command_scope_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) > COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND NOT EXISTS (
    SELECT 1 FROM json_each(NEW.payload, '$.commandIds') AS command
    LEFT JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
      ON receipt.key IS command.value
    WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
      AND receipt.key IS NULL
  )
  AND (
    EXISTS (
      WITH new_actions(action) AS (
        SELECT json_extract(receipt.value, '$.action')
        FROM json_each(NEW.payload, '$.commandIds') AS command
        JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
          ON receipt.key IS command.value
        WHERE command.key >= json_array_length(OLD.payload, '$.commandIds')
      ), allowed(action, path) AS (
        VALUES ('import_intake_source', '$.files'),
      ('save_source', '$.ai.sourceText'),
      ('save_source', '$.files'),
      ('exclude_source', '$.files'),
      ('set_ai_policy', '$.ai.enabled'),
      ('set_ai_policy', '$.ai.approvedAt'),
      ('set_ai_policy', '$.ai.approvedBy'),
      ('set_ai_policy', '$.jobs'),
      ('queue_report1', '$.jobs'),
      ('save_report', '$.reports'),
      ('save_report', '$.files'),
      ('save_report', '$.analysis'),
      ('confirm_analysis', '$.analysis'),
      ('book_meeting', '$.meetings'),
      ('complete_meeting', '$.meetings'),
      ('cancel_meeting', '$.meetings'),
      ('save_recording', '$.recordings'),
      ('save_recording', '$.jobs'),
      ('save_recording', '$.files'),
      ('save_transcript', '$.recordings'),
      ('save_transcript', '$.jobs'),
      ('save_transcript', '$.files'),
      ('retry_job', '$.jobs'),
      ('confirm_solutions', '$.decision'),
      ('request_document', '$.requests'),
      ('mark_request_sent', '$.requests'),
      ('receive_document', '$.requests'),
      ('receive_document', '$.files'),
      ('review_document', '$.requests'),
      ('record_contract', '$.contract'),
      ('record_contract', '$.meetings'),
      ('record_contract', '$.files'),
      ('confirm_payment', '$.payments'),
      ('confirm_payment', '$.executionStartedAt'),
      ('start_aftercare', '$.aftercare')
      ), changed(path) AS (
        SELECT value FROM json_each(json_array(
          CASE WHEN json_extract(NEW.payload, '$.company') IS NOT json_extract(OLD.payload, '$.company') THEN '$.company' END,
          CASE WHEN json_extract(NEW.payload, '$.partnerName') IS NOT json_extract(OLD.payload, '$.partnerName') THEN '$.partnerName' END,
          CASE WHEN json_extract(NEW.payload, '$.reports') IS NOT json_extract(OLD.payload, '$.reports') THEN '$.reports' END,
          CASE WHEN json_extract(NEW.payload, '$.files') IS NOT json_extract(OLD.payload, '$.files') THEN '$.files' END,
          CASE WHEN json_extract(NEW.payload, '$.analysis') IS NOT json_extract(OLD.payload, '$.analysis') THEN '$.analysis' END,
          CASE WHEN json_extract(NEW.payload, '$.meetings') IS NOT json_extract(OLD.payload, '$.meetings') THEN '$.meetings' END,
          CASE WHEN json_extract(NEW.payload, '$.recordings') IS NOT json_extract(OLD.payload, '$.recordings') THEN '$.recordings' END,
          CASE WHEN json_extract(NEW.payload, '$.requests') IS NOT json_extract(OLD.payload, '$.requests') THEN '$.requests' END,
          CASE WHEN json_extract(NEW.payload, '$.decision') IS NOT json_extract(OLD.payload, '$.decision') THEN '$.decision' END,
          CASE WHEN json_extract(NEW.payload, '$.contract') IS NOT json_extract(OLD.payload, '$.contract') THEN '$.contract' END,
          CASE WHEN json_extract(NEW.payload, '$.payments') IS NOT json_extract(OLD.payload, '$.payments') THEN '$.payments' END,
          CASE WHEN json_extract(NEW.payload, '$.executionStartedAt') IS NOT json_extract(OLD.payload, '$.executionStartedAt') THEN '$.executionStartedAt' END,
          CASE WHEN json_extract(NEW.payload, '$.aftercare') IS NOT json_extract(OLD.payload, '$.aftercare') THEN '$.aftercare' END,
          CASE WHEN json_extract(NEW.payload, '$.ai.enabled') IS NOT json_extract(OLD.payload, '$.ai.enabled') THEN '$.ai.enabled' END,
          CASE WHEN json_extract(NEW.payload, '$.ai.approvedAt') IS NOT json_extract(OLD.payload, '$.ai.approvedAt') THEN '$.ai.approvedAt' END,
          CASE WHEN json_extract(NEW.payload, '$.ai.approvedBy') IS NOT json_extract(OLD.payload, '$.ai.approvedBy') THEN '$.ai.approvedBy' END,
          CASE WHEN json_extract(NEW.payload, '$.ai.sourceText') IS NOT json_extract(OLD.payload, '$.ai.sourceText') THEN '$.ai.sourceText' END,
          CASE WHEN json_extract(NEW.payload, '$.jobs') IS NOT json_extract(OLD.payload, '$.jobs') THEN '$.jobs' END
        )) WHERE value IS NOT NULL
      )
      SELECT 1 FROM changed
      WHERE NOT EXISTS (
        SELECT 1 FROM new_actions
        JOIN allowed ON allowed.action IS new_actions.action
        WHERE allowed.path IS changed.path
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow command scope is invalid');
END;
