-- Ensure clean databases have the runtime-created table before installing lifecycle guards.
CREATE TABLE IF NOT EXISTS ai_diagnosis_runs (
  id TEXT PRIMARY KEY NOT NULL,
  case_id TEXT NOT NULL,
  company TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  instruction_version TEXT NOT NULL,
  model TEXT NOT NULL,
  result_json TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ai_diagnosis_runs_case_idx
ON ai_diagnosis_runs (case_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS ai_diagnosis_runs_pending_case_idx
ON ai_diagnosis_runs (case_id) WHERE status = '생성중';

CREATE TRIGGER IF NOT EXISTS ai_diagnosis_runs_insert_envelope_guard
BEFORE INSERT ON ai_diagnosis_runs
WHEN typeof(NEW.id) <> 'text'
  OR NEW.id = ''
  OR trim(NEW.id) <> NEW.id
  OR typeof(NEW.case_id) <> 'text'
  OR NEW.case_id = ''
  OR trim(NEW.case_id) <> NEW.case_id
  OR typeof(NEW.company) <> 'text'
  OR NEW.company = ''
  OR trim(NEW.company) <> NEW.company
  OR NEW.stage <> 'Step 0'
  OR NEW.status <> '생성중'
  OR typeof(NEW.instruction_version) <> 'text'
  OR NEW.instruction_version = ''
  OR trim(NEW.instruction_version) <> NEW.instruction_version
  OR typeof(NEW.model) <> 'text'
  OR NEW.model = ''
  OR trim(NEW.model) <> NEW.model
  OR json_valid(NEW.result_json) <> 1
  OR COALESCE(json_type(NEW.result_json), '') <> 'object'
  OR NOT COALESCE((
    json_type(NEW.result_json, '$._requestFingerprint') = 'text'
    AND length(json_extract(NEW.result_json, '$._requestFingerprint')) = 64
    AND json_extract(NEW.result_json, '$._requestFingerprint') NOT GLOB '*[^0-9a-f]*'
  ), 0)
  OR typeof(NEW.input_tokens) <> 'integer'
  OR NEW.input_tokens <> 0
  OR typeof(NEW.output_tokens) <> 'integer'
  OR NEW.output_tokens <> 0
  OR typeof(NEW.created_by_user_id) <> 'text'
  OR NEW.created_by_user_id = ''
  OR trim(NEW.created_by_user_id) <> NEW.created_by_user_id
  OR typeof(NEW.created_at) <> 'text'
  OR length(NEW.created_at) <> 24
  OR substr(NEW.created_at, 5, 1) <> '-'
  OR substr(NEW.created_at, 8, 1) <> '-'
  OR substr(NEW.created_at, 11, 1) <> 'T'
  OR substr(NEW.created_at, 14, 1) <> ':'
  OR substr(NEW.created_at, 17, 1) <> ':'
  OR substr(NEW.created_at, 20, 1) <> '.'
  OR substr(NEW.created_at, 24, 1) <> 'Z'
  OR julianday(NEW.created_at) IS NULL
BEGIN
  SELECT RAISE(ABORT, 'AI diagnosis run insert envelope is invalid');
END;

CREATE TRIGGER IF NOT EXISTS ai_diagnosis_runs_identity_immutable
BEFORE UPDATE ON ai_diagnosis_runs
WHEN NEW.id IS NOT OLD.id
  OR NEW.case_id IS NOT OLD.case_id
  OR NEW.company IS NOT OLD.company
  OR NEW.stage IS NOT OLD.stage
  OR NEW.instruction_version IS NOT OLD.instruction_version
  OR NEW.model IS NOT OLD.model
  OR NEW.created_by_user_id IS NOT OLD.created_by_user_id
BEGIN
  SELECT RAISE(ABORT, 'AI diagnosis run identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS ai_diagnosis_runs_transition_guard
BEFORE UPDATE ON ai_diagnosis_runs
WHEN NEW.id IS OLD.id
  AND NEW.case_id IS OLD.case_id
  AND NEW.company IS OLD.company
  AND NEW.stage IS OLD.stage
  AND NEW.instruction_version IS OLD.instruction_version
  AND NEW.model IS OLD.model
  AND NEW.created_by_user_id IS OLD.created_by_user_id
  AND NOT (
    (
      OLD.status = '생성중'
      AND NEW.status = '생성실패'
      AND NEW.result_json IS OLD.result_json
      AND NEW.input_tokens IS OLD.input_tokens
      AND NEW.output_tokens IS OLD.output_tokens
      AND NEW.created_at IS OLD.created_at
    )
    OR COALESCE((
      OLD.status = '생성중'
      AND NEW.status = '대표 검토 대기'
      AND json_valid(NEW.result_json) = 1
      AND COALESCE(json_type(NEW.result_json), '') = 'object'
      AND json_type(NEW.result_json, '$._requestFingerprint') = 'text'
      AND length(json_extract(NEW.result_json, '$._requestFingerprint')) = 64
      AND json_extract(NEW.result_json, '$._requestFingerprint') NOT GLOB '*[^0-9a-f]*'
      AND json_type(NEW.result_json, '$.companyOverview') = 'text'
      AND trim(json_extract(NEW.result_json, '$.companyOverview')) <> ''
      AND json_type(NEW.result_json, '$.confirmedStrengths') = 'array'
      AND json_type(NEW.result_json, '$.mainRisks') = 'array'
      AND json_type(NEW.result_json, '$.solutionCandidates') = 'array'
      AND json_type(NEW.result_json, '$.verificationQuestions') = 'array'
      AND json_type(NEW.result_json, '$.missingDocuments') = 'array'
      AND json_type(NEW.result_json, '$.complianceNotes') = 'array'
      AND json_type(NEW.result_json, '$.nextAction') = 'text'
      AND trim(json_extract(NEW.result_json, '$.nextAction')) <> ''
      AND json_extract(NEW.result_json, '$._requestFingerprint') = json_extract(OLD.result_json, '$._requestFingerprint')
      AND typeof(NEW.input_tokens) = 'integer'
      AND NEW.input_tokens BETWEEN 0 AND 9007199254740991
      AND typeof(NEW.output_tokens) = 'integer'
      AND NEW.output_tokens BETWEEN 0 AND 9007199254740991
      AND typeof(NEW.created_at) = 'text'
      AND length(NEW.created_at) = 24
      AND substr(NEW.created_at, 5, 1) = '-'
      AND substr(NEW.created_at, 8, 1) = '-'
      AND substr(NEW.created_at, 11, 1) = 'T'
      AND substr(NEW.created_at, 14, 1) = ':'
      AND substr(NEW.created_at, 17, 1) = ':'
      AND substr(NEW.created_at, 20, 1) = '.'
      AND substr(NEW.created_at, 24, 1) = 'Z'
      AND julianday(NEW.created_at) IS NOT NULL
      AND NEW.created_at >= OLD.created_at
    ), 0)
  )
BEGIN
  SELECT RAISE(ABORT, 'AI diagnosis run transition is invalid');
END;

CREATE TRIGGER IF NOT EXISTS ai_diagnosis_runs_no_delete
BEFORE DELETE ON ai_diagnosis_runs
BEGIN
  SELECT RAISE(ABORT, 'AI diagnosis run is durable');
END;
