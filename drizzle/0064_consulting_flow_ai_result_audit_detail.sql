CREATE TRIGGER IF NOT EXISTS consulting_flows_ai_result_audit_detail_guard
BEFORE UPDATE ON consulting_flows
WHEN EXISTS (
  SELECT 1
  FROM json_each(OLD.payload, '$.jobs') AS previous
  JOIN json_each(NEW.payload, '$.jobs') AS next
    ON json_extract(next.value, '$.id') IS json_extract(previous.value, '$.id')
  WHERE json_extract(previous.value, '$.status') IS 'processing'
    AND json_extract(next.value, '$.status') IN ('blocked', 'failed', 'complete')
    AND EXISTS (
      SELECT 1 FROM json_each(NEW.payload, '$.audit') AS audit
      WHERE audit.key >= json_array_length(OLD.payload, '$.audit')
        AND json_extract(audit.value, '$.id') IS
          (json_extract(next.value, '$.id') || '-' || NEW.updated_at)
        AND json_extract(audit.value, '$.at') IS NEW.updated_at
        AND json_extract(audit.value, '$.actor') IS '보고서 자동생성'
        AND json_extract(audit.value, '$.action') IS 'ai_result'
    )
    AND (
      SELECT count(*) FROM json_each(NEW.payload, '$.audit') AS audit
      WHERE audit.key >= json_array_length(OLD.payload, '$.audit')
        AND json_extract(audit.value, '$.id') IS
          (json_extract(next.value, '$.id') || '-' || NEW.updated_at)
        AND json_extract(audit.value, '$.at') IS NEW.updated_at
        AND json_extract(audit.value, '$.actor') IS '보고서 자동생성'
        AND json_extract(audit.value, '$.action') IS 'ai_result'
        AND json_extract(audit.value, '$.detail') IS
          CASE json_extract(next.value, '$.status')
            WHEN 'complete' THEN
              CASE json_extract(next.value, '$.stage')
                WHEN 1 THEN '1차 정밀진단보고서 자동 저장 · 담당 파트너 공유'
                WHEN 4 THEN '4차 심화보고서 자동 저장 · 담당 파트너 공유'
              END
            WHEN 'blocked' THEN
              CASE json_extract(next.value, '$.stage')
                WHEN 1 THEN '1차 정밀진단보고서 보류 · '
                WHEN 4 THEN '4차 심화보고서 보류 · '
              END || json_extract(next.value, '$.reason')
            WHEN 'failed' THEN
              CASE json_extract(next.value, '$.stage')
                WHEN 1 THEN '1차 정밀진단보고서 실패 · '
                WHEN 4 THEN '4차 심화보고서 실패 · '
              END || json_extract(next.value, '$.reason')
          END
    ) <> 1
)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow AI result audit detail is invalid');
END;
