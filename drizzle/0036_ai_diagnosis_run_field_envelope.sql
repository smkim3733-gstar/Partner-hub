CREATE TRIGGER IF NOT EXISTS ai_diagnosis_runs_field_envelope_guard
BEFORE INSERT ON ai_diagnosis_runs
WHEN length(NEW.id) NOT BETWEEN 16 AND 100
  OR NEW.id GLOB '*[^A-Za-z0-9_-]*'
  OR length(NEW.case_id) NOT BETWEEN 1 AND 120
  OR length(NEW.company) NOT BETWEEN 1 AND 100
  OR length(NEW.instruction_version) NOT BETWEEN 1 AND 100
  OR length(NEW.model) NOT BETWEEN 1 AND 200
  OR length(NEW.created_by_user_id) NOT BETWEEN 1 AND 256
BEGIN
  SELECT RAISE(ABORT, 'AI diagnosis run field envelope is invalid');
END;
