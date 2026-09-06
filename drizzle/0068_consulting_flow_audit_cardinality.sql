CREATE TRIGGER IF NOT EXISTS consulting_flows_audit_insert_cardinality_guard
BEFORE INSERT ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.audit'), -1) <>
  COALESCE(json_array_length(NEW.payload, '$.commandIds'), -1)
BEGIN
  SELECT RAISE(ABORT, 'consulting flow initial audit cardinality is invalid');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flows_audit_cardinality_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.audit'), -1) <>
  COALESCE(json_array_length(OLD.payload, '$.audit'), -1) +
  COALESCE(json_array_length(NEW.payload, '$.commandIds'), -1) -
  COALESCE(json_array_length(OLD.payload, '$.commandIds'), -1) +
  (SELECT count(*)
    FROM json_each(OLD.payload, '$.jobs') AS previous
    JOIN json_each(NEW.payload, '$.jobs') AS next
      ON json_extract(next.value, '$.id') IS json_extract(previous.value, '$.id')
    WHERE json_extract(previous.value, '$.status') IS 'processing'
      AND json_extract(next.value, '$.status') IN ('blocked', 'failed', 'complete'))
BEGIN
  SELECT RAISE(ABORT, 'consulting flow audit cardinality is invalid');
END;
