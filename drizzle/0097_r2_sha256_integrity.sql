-- Bind new R2 objects to immutable SHA-256 proof. Existing files remain explicit legacy ETag/metadata rows.
CREATE TABLE IF NOT EXISTS company_file_object_checksums (
  file_id TEXT PRIMARY KEY NOT NULL REFERENCES company_file_objects(id) ON DELETE CASCADE,
  sha256 TEXT NOT NULL CHECK (
    length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'
  )
);

CREATE TRIGGER IF NOT EXISTS company_file_object_checksums_no_update
BEFORE UPDATE ON company_file_object_checksums
BEGIN SELECT RAISE(ABORT, 'company file object checksum is immutable'); END;

CREATE TRIGGER IF NOT EXISTS company_file_object_checksums_no_direct_delete
BEFORE DELETE ON company_file_object_checksums
WHEN EXISTS (SELECT 1 FROM company_file_objects WHERE id = OLD.file_id)
BEGIN SELECT RAISE(ABORT, 'company file object checksum requires parent deletion'); END;

CREATE TABLE IF NOT EXISTS consulting_flow_file_object_checksums (
  file_id TEXT PRIMARY KEY NOT NULL,
  sha256 TEXT NOT NULL CHECK (
    length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'
  )
);

CREATE TRIGGER IF NOT EXISTS consulting_flow_file_object_checksums_no_update
BEFORE UPDATE ON consulting_flow_file_object_checksums
BEGIN SELECT RAISE(ABORT, 'consulting flow file object checksum is immutable'); END;

CREATE TRIGGER IF NOT EXISTS consulting_flow_file_object_checksums_no_delete
BEFORE DELETE ON consulting_flow_file_object_checksums
BEGIN SELECT RAISE(ABORT, 'consulting flow file object checksum is durable'); END;

DROP TRIGGER IF EXISTS consulting_flow_upload_requests_ready_guard;

CREATE TRIGGER IF NOT EXISTS consulting_flow_upload_requests_ready_guard BEFORE UPDATE ON consulting_flow_upload_requests WHEN OLD.status = 'pending' AND NEW.status = 'ready' AND (NOT EXISTS (SELECT 1 FROM consulting_flow_file_owners owner JOIN consulting_flow_file_metadata metadata ON metadata.file_id = owner.file_id JOIN consulting_flow_file_object_integrity integrity ON integrity.file_id = owner.file_id JOIN consulting_flow_file_object_checksums checksum ON checksum.file_id = owner.file_id WHERE owner.file_id = NEW.file_id AND owner.case_id = NEW.case_id AND owner.storage_key = NEW.storage_key AND metadata.original_name = NEW.original_name AND metadata.content_type = NEW.content_type AND metadata.size_bytes = NEW.size_bytes AND metadata.purpose = NEW.purpose AND metadata.intake_file_id IS NEW.intake_file_id AND metadata.intake_source_hash IS NEW.intake_source_hash AND metadata.source_reviewed_at IS NEW.source_reviewed_at AND metadata.source_reviewed_by IS NEW.source_reviewed_by AND integrity.validation_mode = 'etag' AND integrity.r2_content_type = NEW.content_type AND length(checksum.sha256) = 64 AND checksum.sha256 NOT GLOB '*[^0-9a-f]*') OR NOT EXISTS (SELECT 1 FROM consulting_flows flow, json_each(flow.payload, '$.files') file WHERE flow.case_id = NEW.case_id AND json_extract(file.value, '$.id') = NEW.file_id AND json_extract(file.value, '$.key') = NEW.storage_key AND json_extract(file.value, '$.name') = NEW.original_name AND json_extract(file.value, '$.contentType') = NEW.content_type AND json_extract(file.value, '$.size') = NEW.size_bytes AND json_extract(file.value, '$.purpose') = NEW.purpose AND json_extract(file.value, '$.intakeFileId') IS NEW.intake_file_id AND json_extract(file.value, '$.intakeSourceHash') IS NEW.intake_source_hash AND json_extract(file.value, '$.sourceReviewedAt') IS NEW.source_reviewed_at AND json_extract(file.value, '$.sourceReviewedBy') IS NEW.source_reviewed_by)) BEGIN SELECT RAISE(ABORT, 'consulting flow upload reservation is not committed'); END;
