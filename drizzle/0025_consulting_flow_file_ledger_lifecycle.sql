-- FLOW file ownership and object evidence are append-only. Metadata preserves
-- every original fact and permits only source -> source_archived purpose change.
CREATE TRIGGER IF NOT EXISTS consulting_flow_file_owners_no_update
BEFORE UPDATE ON consulting_flow_file_owners
BEGIN
  SELECT RAISE(ABORT, 'consulting flow file owner is immutable');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flow_file_owners_no_delete
BEFORE DELETE ON consulting_flow_file_owners
BEGIN
  SELECT RAISE(ABORT, 'consulting flow file owner is durable');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flow_file_metadata_lifecycle_guard
BEFORE UPDATE ON consulting_flow_file_metadata
WHEN NEW.file_id <> OLD.file_id
  OR NEW.original_name <> OLD.original_name
  OR NEW.content_type <> OLD.content_type
  OR NEW.size_bytes <> OLD.size_bytes
  OR NEW.intake_file_id IS NOT OLD.intake_file_id
  OR NEW.intake_source_hash IS NOT OLD.intake_source_hash
  OR NEW.source_reviewed_at IS NOT OLD.source_reviewed_at
  OR NEW.source_reviewed_by IS NOT OLD.source_reviewed_by
  OR NOT (
    NEW.purpose = OLD.purpose
    OR (OLD.purpose = 'source' AND NEW.purpose = 'source_archived')
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow file metadata transition is invalid');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flow_file_metadata_no_delete
BEFORE DELETE ON consulting_flow_file_metadata
BEGIN
  SELECT RAISE(ABORT, 'consulting flow file metadata is durable');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flow_file_object_integrity_no_update
BEFORE UPDATE ON consulting_flow_file_object_integrity
BEGIN
  SELECT RAISE(ABORT, 'consulting flow file object integrity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS consulting_flow_file_object_integrity_no_delete
BEFORE DELETE ON consulting_flow_file_object_integrity
BEGIN
  SELECT RAISE(ABORT, 'consulting flow file object integrity is durable');
END;
