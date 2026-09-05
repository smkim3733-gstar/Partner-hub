DROP TRIGGER IF EXISTS ai_diagnosis_runs_result_envelope_guard;

CREATE TRIGGER ai_diagnosis_runs_result_envelope_guard
BEFORE UPDATE ON ai_diagnosis_runs
WHEN NEW.status = '대표 검토 대기'
  AND NOT COALESCE((
    json_valid(NEW.result_json) = 1
    AND json_type(NEW.result_json) = 'object'
    AND length(CAST(NEW.result_json AS BLOB)) <= 320000
    AND (SELECT COUNT(*) FROM json_each(NEW.result_json)) = 10
    AND NOT EXISTS (
      SELECT 1 FROM json_each(NEW.result_json) AS root
      WHERE root.key NOT IN (
        '_requestFingerprint', '_providerRequestId', 'companyOverview',
        'confirmedStrengths', 'mainRisks', 'solutionCandidates',
        'verificationQuestions', 'missingDocuments', 'complianceNotes',
        'nextAction'
      )
    )
    AND json_type(NEW.result_json, '$._requestFingerprint') = 'text'
    AND length(json_extract(NEW.result_json, '$._requestFingerprint')) = 64
    AND json_extract(NEW.result_json, '$._requestFingerprint') NOT GLOB '*[^0-9a-f]*'
    AND json_type(NEW.result_json, '$._providerRequestId') = 'text'
    AND trim(json_extract(NEW.result_json, '$._providerRequestId')) <> ''
    AND json_extract(NEW.result_json, '$._providerRequestId') = trim(json_extract(NEW.result_json, '$._providerRequestId'))
    AND length(json_extract(NEW.result_json, '$._providerRequestId')) <= 200
    AND json_type(NEW.result_json, '$.companyOverview') = 'text'
    AND trim(json_extract(NEW.result_json, '$.companyOverview')) <> ''
    AND json_extract(NEW.result_json, '$.companyOverview') = trim(json_extract(NEW.result_json, '$.companyOverview'))
    AND length(json_extract(NEW.result_json, '$.companyOverview')) <= 12000
    AND json_type(NEW.result_json, '$.confirmedStrengths') = 'array'
    AND json_array_length(NEW.result_json, '$.confirmedStrengths') <= 20
    AND NOT EXISTS (
      SELECT 1 FROM json_each(NEW.result_json, '$.confirmedStrengths') AS item
      WHERE item.type <> 'text' OR trim(item.value) = ''
        OR item.value <> trim(item.value) OR length(item.value) > 4000
    )
    AND json_type(NEW.result_json, '$.mainRisks') = 'array'
    AND json_array_length(NEW.result_json, '$.mainRisks') <= 20
    AND NOT EXISTS (
      SELECT 1 FROM json_each(NEW.result_json, '$.mainRisks') AS item
      WHERE item.type <> 'text' OR trim(item.value) = ''
        OR item.value <> trim(item.value) OR length(item.value) > 4000
    )
    AND json_type(NEW.result_json, '$.verificationQuestions') = 'array'
    AND json_array_length(NEW.result_json, '$.verificationQuestions') <= 20
    AND NOT EXISTS (
      SELECT 1 FROM json_each(NEW.result_json, '$.verificationQuestions') AS item
      WHERE item.type <> 'text' OR trim(item.value) = ''
        OR item.value <> trim(item.value) OR length(item.value) > 4000
    )
    AND json_type(NEW.result_json, '$.missingDocuments') = 'array'
    AND json_array_length(NEW.result_json, '$.missingDocuments') <= 20
    AND NOT EXISTS (
      SELECT 1 FROM json_each(NEW.result_json, '$.missingDocuments') AS item
      WHERE item.type <> 'text' OR trim(item.value) = ''
        OR item.value <> trim(item.value) OR length(item.value) > 4000
    )
    AND json_type(NEW.result_json, '$.complianceNotes') = 'array'
    AND json_array_length(NEW.result_json, '$.complianceNotes') <= 20
    AND NOT EXISTS (
      SELECT 1 FROM json_each(NEW.result_json, '$.complianceNotes') AS item
      WHERE item.type <> 'text' OR trim(item.value) = ''
        OR item.value <> trim(item.value) OR length(item.value) > 4000
    )
    AND json_type(NEW.result_json, '$.solutionCandidates') = 'array'
    AND json_array_length(NEW.result_json, '$.solutionCandidates') <= 10
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(NEW.result_json, '$.solutionCandidates') AS candidate
      WHERE candidate.type <> 'object'
        OR (SELECT COUNT(*) FROM json_each(candidate.value)) <> 3
        OR EXISTS (
          SELECT 1 FROM json_each(candidate.value) AS field
          WHERE field.key NOT IN ('solution', 'basis', 'condition')
        )
        OR NOT COALESCE((
          json_type(candidate.value, '$.solution') = 'text'
          AND trim(json_extract(candidate.value, '$.solution')) <> ''
          AND json_extract(candidate.value, '$.solution') = trim(json_extract(candidate.value, '$.solution'))
          AND length(json_extract(candidate.value, '$.solution')) <= 4000
          AND json_type(candidate.value, '$.basis') = 'text'
          AND trim(json_extract(candidate.value, '$.basis')) <> ''
          AND json_extract(candidate.value, '$.basis') = trim(json_extract(candidate.value, '$.basis'))
          AND length(json_extract(candidate.value, '$.basis')) <= 4000
          AND json_type(candidate.value, '$.condition') = 'text'
          AND json_extract(candidate.value, '$.condition') = trim(json_extract(candidate.value, '$.condition'))
          AND length(json_extract(candidate.value, '$.condition')) <= 4000
        ), 0)
    )
    AND json_type(NEW.result_json, '$.nextAction') = 'text'
    AND trim(json_extract(NEW.result_json, '$.nextAction')) <> ''
    AND json_extract(NEW.result_json, '$.nextAction') = trim(json_extract(NEW.result_json, '$.nextAction'))
    AND length(json_extract(NEW.result_json, '$.nextAction')) <= 12000
  ), 0)
BEGIN
  SELECT RAISE(ABORT, 'AI diagnosis run result envelope is invalid');
END;
