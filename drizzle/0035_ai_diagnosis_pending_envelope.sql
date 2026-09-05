CREATE TRIGGER IF NOT EXISTS ai_diagnosis_runs_pending_envelope_guard
BEFORE INSERT ON ai_diagnosis_runs
WHEN NEW.status = '생성중'
  AND NOT COALESCE((
    json_valid(NEW.result_json) = 1
    AND json_type(NEW.result_json) = 'object'
    AND length(CAST(NEW.result_json AS BLOB)) <= 256
    AND (SELECT COUNT(*) FROM json_each(NEW.result_json)) = 1
    AND NOT EXISTS (
      SELECT 1 FROM json_each(NEW.result_json) AS root
      WHERE root.key <> '_requestFingerprint'
    )
    AND json_type(NEW.result_json, '$._requestFingerprint') = 'text'
    AND length(json_extract(NEW.result_json, '$._requestFingerprint')) = 64
    AND json_extract(NEW.result_json, '$._requestFingerprint') NOT GLOB '*[^0-9a-f]*'
  ), 0)
BEGIN
  SELECT RAISE(ABORT, 'AI diagnosis run pending envelope is invalid');
END;
