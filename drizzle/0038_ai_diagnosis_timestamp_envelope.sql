CREATE TRIGGER IF NOT EXISTS ai_diagnosis_runs_created_at_insert_guard
BEFORE INSERT ON ai_diagnosis_runs
WHEN typeof(NEW.created_at) <> 'text'
  OR length(NEW.created_at) <> 24
  OR strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at) IS NOT NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'AI diagnosis run timestamp envelope is invalid');
END;

CREATE TRIGGER IF NOT EXISTS ai_diagnosis_runs_created_at_update_guard
BEFORE UPDATE ON ai_diagnosis_runs
WHEN NEW.created_at IS NOT OLD.created_at
  AND (
    typeof(NEW.created_at) <> 'text'
    OR length(NEW.created_at) <> 24
    OR strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at) IS NOT NEW.created_at
  )
BEGIN
  SELECT RAISE(ABORT, 'AI diagnosis run timestamp envelope is invalid');
END;
