DROP TRIGGER IF EXISTS consulting_flow_upload_completions_insert_guard;

CREATE TRIGGER IF NOT EXISTS consulting_flow_upload_completions_insert_guard
BEFORE INSERT ON consulting_flow_upload_completions
WHEN typeof(NEW.file_id) <> 'text'
  OR length(NEW.file_id) NOT BETWEEN 1 AND 200
  OR NEW.file_id GLOB '*[^A-Za-z0-9_-]*'
  OR typeof(NEW.command_id) <> 'text'
  OR length(NEW.command_id) NOT BETWEEN 8 AND 100
  OR NEW.command_id GLOB '*[^A-Za-z0-9_-]*'
  OR NOT EXISTS (
    SELECT 1
    FROM consulting_flow_upload_requests reservation,
      consulting_flows flow,
      json_each(flow.payload, '$.commandIds') command
    WHERE reservation.file_id = NEW.file_id
      AND reservation.status = 'pending'
      AND flow.case_id = reservation.case_id
      AND command.value = NEW.command_id
      AND json_type(
        flow.payload,
        '$.commandReceipts."' || NEW.command_id || '"'
      ) = 'object'
      AND json_extract(
        flow.payload,
        '$.commandReceipts."' || NEW.command_id || '".actorKey'
      ) = reservation.actor_key
      AND json_extract(
        flow.payload,
        '$.commandReceipts."' || NEW.command_id || '".fingerprint'
      ) = reservation.fingerprint
      AND (
        reservation.slot <> 'audio'
        OR EXISTS (
          SELECT 1
          FROM json_each(flow.payload, '$.recordings') recording
          WHERE json_extract(recording.value, '$.id') =
              NEW.command_id || '-recording'
            AND json_extract(recording.value, '$.audioFileId') =
              reservation.file_id
        )
      )
      AND (
        NOT EXISTS (
          SELECT 1
          FROM consulting_flow_upload_requests sibling
          WHERE sibling.case_id = reservation.case_id
            AND sibling.actor_key = reservation.actor_key
            AND sibling.command_id = reservation.command_id
            AND sibling.fingerprint = reservation.fingerprint
            AND sibling.slot <> reservation.slot
        )
        OR EXISTS (
          SELECT 1
          FROM json_each(flow.payload, '$.recordings') recording
          WHERE json_extract(recording.value, '$.id') =
              NEW.command_id || '-recording'
            AND json_extract(recording.value, '$.fileId') = (
              SELECT file_slot.file_id
              FROM consulting_flow_upload_requests file_slot
              WHERE file_slot.case_id = reservation.case_id
                AND file_slot.actor_key = reservation.actor_key
                AND file_slot.command_id = reservation.command_id
                AND file_slot.fingerprint = reservation.fingerprint
                AND file_slot.slot = 'file'
            )
            AND json_extract(recording.value, '$.audioFileId') = (
              SELECT audio_slot.file_id
              FROM consulting_flow_upload_requests audio_slot
              WHERE audio_slot.case_id = reservation.case_id
                AND audio_slot.actor_key = reservation.actor_key
                AND audio_slot.command_id = reservation.command_id
                AND audio_slot.fingerprint = reservation.fingerprint
                AND audio_slot.slot = 'audio'
            )
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow upload completion proof is invalid');
END;
