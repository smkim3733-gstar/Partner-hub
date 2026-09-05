CREATE TRIGGER IF NOT EXISTS ai_diagnosis_runs_field_text_guard
BEFORE INSERT ON ai_diagnosis_runs
WHEN EXISTS (
  SELECT 1
  FROM json_each(json_array(
    NEW.id, NEW.case_id, NEW.company, NEW.instruction_version,
    NEW.model, NEW.created_by_user_id
  )) AS field
  WHERE EXISTS (
    WITH RECURSIVE character_positions(position) AS (
      VALUES(1)
      UNION ALL
      SELECT position + 1 FROM character_positions
      WHERE position < length(field.value)
    )
    SELECT 1 FROM character_positions
    WHERE unicode(substr(field.value, position, 1)) BETWEEN 0 AND 8
      OR unicode(substr(field.value, position, 1)) BETWEEN 11 AND 12
      OR unicode(substr(field.value, position, 1)) BETWEEN 14 AND 31
      OR unicode(substr(field.value, position, 1)) BETWEEN 127 AND 159
      OR unicode(substr(field.value, position, 1)) = 65533
  )
)
BEGIN
  SELECT RAISE(ABORT, 'AI diagnosis run text envelope is invalid');
END;

CREATE TRIGGER IF NOT EXISTS ai_diagnosis_runs_result_text_guard
BEFORE UPDATE ON ai_diagnosis_runs
WHEN NEW.status = '대표 검토 대기'
  AND EXISTS (
    SELECT 1 FROM json_tree(NEW.result_json) AS field
    WHERE field.type = 'text'
      AND EXISTS (
        WITH RECURSIVE character_positions(position) AS (
          VALUES(1)
          UNION ALL
          SELECT position + 1 FROM character_positions
          WHERE position < length(field.value)
        )
        SELECT 1 FROM character_positions
        WHERE unicode(substr(field.value, position, 1)) BETWEEN 0 AND 8
          OR unicode(substr(field.value, position, 1)) BETWEEN 11 AND 12
          OR unicode(substr(field.value, position, 1)) BETWEEN 14 AND 31
          OR unicode(substr(field.value, position, 1)) BETWEEN 127 AND 159
          OR unicode(substr(field.value, position, 1)) = 65533
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'AI diagnosis run text envelope is invalid');
END;
