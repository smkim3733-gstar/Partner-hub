DROP TRIGGER IF EXISTS consulting_flows_import_intake_source_effect_guard;

CREATE TRIGGER IF NOT EXISTS consulting_flows_import_intake_source_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(action) AS (
      SELECT json_extract(receipt.value, '$.action')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), new_file(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.files[' || json_array_length(OLD.payload, '$.files') || ']'
      )
    )
    SELECT 1
    FROM command
    CROSS JOIN new_file
    WHERE command.action IS 'import_intake_source'
      AND (
        json_array_length(NEW.payload, '$.files') IS NOT
          json_array_length(OLD.payload, '$.files') + 1
        OR EXISTS (
          SELECT 1 FROM json_each(OLD.payload, '$.files') AS previous
          WHERE json(json_extract(
              NEW.payload,
              '$.files[' || previous.key || ']'
            )) IS NOT json(previous.value)
        )
        OR json_extract(new_file.value, '$.purpose') IS NOT 'source'
        OR json_extract(new_file.value, '$.createdAt') IS NOT NEW.updated_at
        OR json_type(new_file.value, '$.intakeFileId') IS NOT 'text'
        OR trim(json_extract(new_file.value, '$.intakeFileId')) = ''
        OR json_type(new_file.value, '$.intakeSourceHash') IS NOT 'text'
        OR length(json_extract(new_file.value, '$.intakeSourceHash')) <> 64
        OR json_extract(new_file.value, '$.intakeSourceHash') GLOB '*[^0-9a-f]*'
        OR json_extract(new_file.value, '$.sourceReviewedAt') IS NOT NEW.updated_at
        OR json_type(new_file.value, '$.sourceReviewedBy') IS NOT 'text'
        OR trim(json_extract(new_file.value, '$.sourceReviewedBy')) = ''
        OR NOT EXISTS (
          SELECT 1
          FROM company_file_objects AS source
          LEFT JOIN company_file_assignments AS assignment
            ON assignment.file_id = source.id
          LEFT JOIN company_file_case_links AS case_link
            ON case_link.file_id = source.id
          WHERE source.id = json_extract(new_file.value, '$.intakeFileId')
            AND source.company = json_extract(OLD.payload, '$.company')
            AND (
              case_link.case_id IS NULL
              OR case_link.case_id = OLD.case_id
            )
            AND (
              (
                assignment.partner_member_id IS NOT NULL
                AND length(assignment.partner_member_id) > 0
                AND assignment.partner_member_id =
                  json_extract(OLD.payload, '$.partnerId')
              )
              OR (
                assignment.partner_member_id IS NULL
                AND source.assigned_trainee =
                  json_extract(OLD.payload, '$.partnerName')
              )
            )
            AND NOT EXISTS (
              SELECT 1 FROM company_file_upload_requests AS upload
              WHERE upload.file_id = source.id AND upload.status = 'deleted'
            )
            AND EXISTS (
              SELECT 1 FROM company_file_storage_keys AS object_key
              WHERE object_key.file_id = source.id
                AND object_key.storage_key = source.storage_key
            )
            AND EXISTS (
              SELECT 1 FROM company_file_metadata AS metadata
              WHERE metadata.file_id = source.id
                AND (
                  metadata.original_name, metadata.company, metadata.category,
                  metadata.title, metadata.assigned_trainee,
                  metadata.uploaded_by_user_id, metadata.uploaded_by_email,
                  metadata.content_type, metadata.size_bytes, metadata.created_at
                ) = (
                  source.original_name, source.company, source.category,
                  source.title, source.assigned_trainee,
                  source.uploaded_by_user_id, source.uploaded_by_email,
                  source.content_type, source.size_bytes, source.created_at
                )
            )
            AND EXISTS (
              SELECT 1 FROM company_file_object_integrity AS integrity
              WHERE integrity.file_id = source.id
                AND integrity.r2_content_type = source.content_type
                AND (
                  (
                    integrity.validation_mode = 'metadata'
                    AND integrity.r2_etag IS NULL
                  )
                  OR (
                    integrity.validation_mode = 'etag'
                    AND length(integrity.r2_etag) BETWEEN 1 AND 256
                  )
                )
            )
            AND (
              case_link.case_id IS NULL
              OR case_link.case_id NOT LIKE 'case-draft-%'
              OR NOT EXISTS (
                SELECT 1 FROM company_file_upload_requests AS upload
                WHERE upload.file_id = source.id
              )
              OR EXISTS (
                SELECT 1
                FROM portal_state AS portal,
                  json_each(portal.payload, '$.companyDocuments') AS document
                WHERE portal.id = 'keve-partner-hub'
                  AND json_extract(document.value, '$.storageFileId') = source.id
                  AND json_extract(document.value, '$.caseId') =
                    case_link.case_id
              )
            )
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow intake source effect is invalid');
END;
