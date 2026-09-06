CREATE UNIQUE INDEX IF NOT EXISTS consulting_flow_upload_requests_pending_fingerprint_slot_idx
ON consulting_flow_upload_requests (case_id, actor_key, fingerprint, slot)
WHERE status = 'pending';

PRAGMA optimize;

CREATE TABLE IF NOT EXISTS consulting_flow_upload_completions (
  file_id TEXT PRIMARY KEY NOT NULL,
  command_id TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS consulting_flow_upload_completions_insert_guard BEFORE INSERT ON consulting_flow_upload_completions WHEN typeof(NEW.file_id) <> 'text' OR length(NEW.file_id) NOT BETWEEN 1 AND 200 OR NEW.file_id GLOB '*[^A-Za-z0-9_-]*' OR typeof(NEW.command_id) <> 'text' OR length(NEW.command_id) NOT BETWEEN 8 AND 100 OR NEW.command_id GLOB '*[^A-Za-z0-9_-]*' OR NOT EXISTS (SELECT 1 FROM consulting_flow_upload_requests reservation, consulting_flows flow, json_each(flow.payload, '$.commandIds') command WHERE reservation.file_id = NEW.file_id AND reservation.status = 'pending' AND flow.case_id = reservation.case_id AND command.value = NEW.command_id AND json_type(flow.payload, '$.commandReceipts."' || NEW.command_id || '"') = 'object' AND json_extract(flow.payload, '$.commandReceipts."' || NEW.command_id || '".actorKey') = reservation.actor_key AND json_extract(flow.payload, '$.commandReceipts."' || NEW.command_id || '".fingerprint') = reservation.fingerprint) BEGIN SELECT RAISE(ABORT, 'consulting flow upload completion proof is invalid'); END;

CREATE TRIGGER IF NOT EXISTS consulting_flow_upload_completions_no_update BEFORE UPDATE ON consulting_flow_upload_completions BEGIN SELECT RAISE(ABORT, 'consulting flow upload completion is immutable'); END;

CREATE TRIGGER IF NOT EXISTS consulting_flow_upload_completions_no_delete BEFORE DELETE ON consulting_flow_upload_completions BEGIN SELECT RAISE(ABORT, 'consulting flow upload completion is durable'); END;

CREATE TRIGGER IF NOT EXISTS consulting_flow_upload_requests_completion_guard BEFORE UPDATE ON consulting_flow_upload_requests WHEN OLD.status = 'pending' AND NEW.status = 'ready' AND NOT EXISTS (SELECT 1 FROM consulting_flow_upload_completions completion WHERE completion.file_id = NEW.file_id) BEGIN SELECT RAISE(ABORT, 'consulting flow upload reservation completion is missing'); END;
