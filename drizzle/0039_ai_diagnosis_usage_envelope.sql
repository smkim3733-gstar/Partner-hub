CREATE TRIGGER IF NOT EXISTS ai_diagnosis_runs_usage_envelope_guard
BEFORE UPDATE ON ai_diagnosis_runs
WHEN NEW.status = '대표 검토 대기'
  AND (
    typeof(NEW.input_tokens) <> 'integer'
    OR NEW.input_tokens NOT BETWEEN 1 AND 9007199254740991
    OR typeof(NEW.output_tokens) <> 'integer'
    OR NEW.output_tokens NOT BETWEEN 1 AND 4000
  )
BEGIN
  SELECT RAISE(ABORT, 'AI diagnosis run usage envelope is invalid');
END;
