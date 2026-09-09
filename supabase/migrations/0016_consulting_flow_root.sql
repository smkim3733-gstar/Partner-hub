begin;

-- Bind the previously staged validators to the actual root. Authentication is
-- still server-owned: these receipt checks bind durable evidence to the fixed
-- admin identity or assigned partner; they are not a replacement for sessions.
create function partner_hub.flow_new_receipt_actor_valid(previous json, proposed json)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare command_id text; receipt json; old_count integer;
begin
  old_count := json_array_length(previous -> 'commandIds');
  if old_count = json_array_length(proposed -> 'commandIds') then return true; end if;
  command_id := proposed -> 'commandIds' ->> old_count;
  receipt := proposed -> 'commandReceipts' -> command_id;
  return coalesce(receipt ->> 'fingerprint' ~ '^[0-9a-f]{64}$'
    and length(receipt ->> 'actorKey') between 8 and 500
    and receipt ->> 'actorKey' !~ E'[ \t\r\n]'
    and ((receipt ->> 'actorKey' = 'admin:primary' and receipt ->> 'actor' = '김성민 대표')
      or (receipt ->> 'actorKey' = 'member:' || (proposed ->> 'partnerId')
        and receipt ->> 'actor' = proposed ->> 'partnerName')), false);
exception when data_exception then return false;
end;
$$;

create function partner_hub.flow_internal_effect_valid(previous json, proposed json)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare position integer; changed integer := 0; old_job json; new_job json;
  item json; next_item json; field_name text; completed boolean; result_write boolean;
  report json; report_id text; title text; detail text; allowed text[]; current_job boolean;
begin
  if json_array_length(previous -> 'commandIds') <> json_array_length(proposed -> 'commandIds') then return true; end if;
  if json_array_length(previous -> 'jobs') <> json_array_length(proposed -> 'jobs') then return false; end if;
  for position in 0..json_array_length(previous -> 'jobs') - 1 loop
    item := previous -> 'jobs' -> position; next_item := proposed -> 'jobs' -> position;
    if item ->> 'id' is distinct from next_item ->> 'id' then return false; end if;
    if partner_hub.flow_json_compact(item) is distinct from partner_hub.flow_json_compact(next_item) then
      changed := changed + 1; old_job := item; new_job := next_item;
    end if;
  end loop;
  if changed > 1 then return false; end if;
  allowed := array['revision','updatedAt'];
  if changed = 1 then
    -- Retry is an explicit user command, never an internal automatic retry.
    if not ((old_job ->> 'status' = 'queued' and new_job ->> 'status' in ('processing','blocked'))
      or (old_job ->> 'status' = 'processing' and new_job ->> 'status' in ('blocked','failed','complete'))) then return false; end if;
    completed := old_job ->> 'status' = 'processing' and new_job ->> 'status' = 'complete';
    current_job := previous #>> '{ai,enabled}' = 'true' and previous -> 'contract' is null
      and case when old_job ->> 'stage' = '1' then not exists (
        select 1 from json_array_elements(previous -> 'meetings') meeting
        where meeting.value ->> 'kind' = 'first' and meeting.value ->> 'status' = 'completed')
      else old_job ->> 'sourceRecordingId' = previous -> 'recordings' -> -1 ->> 'id'
        and old_job ->> 'sourceReportId' = (select entry.value ->> 'id'
          from json_array_elements(previous -> 'reports') with ordinality entry(value,ordinal)
          where entry.value ->> 'stage' = '1' order by entry.ordinal desc limit 1) end;
    if new_job ->> 'status' in ('processing','complete') and current_job is distinct from true then return false; end if;
    result_write := old_job ->> 'status' = 'processing';
    allowed := allowed || array['jobs'];
    if result_write then allowed := allowed || array['audit']; end if;
    if completed then allowed := allowed || array['reports','analysis']; end if;
    if json_array_length(proposed -> 'audit') <> json_array_length(previous -> 'audit') + (case when result_write then 1 else 0 end) then return false; end if;
    if result_write then
      title := case when new_job ->> 'stage' = '1' then '1차 정밀진단보고서' else '4차 심화보고서' end;
      detail := title || case new_job ->> 'status'
        when 'complete' then ' 자동 저장 · 담당 파트너 공유'
        when 'blocked' then ' 보류 · ' || (new_job ->> 'reason')
        when 'failed' then ' 실패 · ' || (new_job ->> 'reason') end;
      item := proposed -> 'audit' -> json_array_length(previous -> 'audit');
      if item ->> 'id' is distinct from (new_job ->> 'id') || '-' || (proposed ->> 'updatedAt')
        or item ->> 'at' is distinct from proposed ->> 'updatedAt'
        or item ->> 'actor' is distinct from '보고서 자동생성'
        or item ->> 'action' is distinct from 'ai_result' or item ->> 'detail' is distinct from detail then return false; end if;
    end if;
    if completed then
      report_id := (new_job ->> 'id') || '-result';
      report := proposed -> 'reports' -> json_array_length(previous -> 'reports');
      if json_array_length(proposed -> 'reports') <> json_array_length(previous -> 'reports') + 1
        or not partner_hub.flow_json_array_prefix(previous -> 'reports', proposed -> 'reports')
        or report ->> 'id' is distinct from report_id or new_job ->> 'reportId' is distinct from report_id
        or report ->> 'stage' is distinct from new_job ->> 'stage'
        or (report ->> 'version')::bigint <> (select count(*) + 1 from json_array_elements(previous -> 'reports') entry where entry.value ->> 'stage' = new_job ->> 'stage')
        or report ->> 'title' is distinct from title or report ->> 'createdAt' is distinct from proposed ->> 'updatedAt'
        or report ->> 'createdBy' is distinct from 'Claude · 대표 검토 전' or report ->> 'origin' is distinct from 'ai'
        or report -> 'fileId' is not null or report -> 'decisionId' is not null or report -> 'documentsKey' is not null then return false; end if;
      if new_job ->> 'stage' = '1' then
        if report -> 'sourceReportId' is not null or report -> 'sourceRecordingId' is not null
          or proposed #>> '{analysis,reportId}' is distinct from report_id
          or (select count(*) from json_each(proposed -> 'analysis')) <> 1 then return false; end if;
      else
        if report ->> 'sourceReportId' is distinct from new_job ->> 'sourceReportId'
          or report ->> 'sourceRecordingId' is distinct from new_job ->> 'sourceRecordingId'
          or not partner_hub.flow_json_field_equal(previous, proposed, 'analysis') then return false; end if;
      end if;
    end if;
  end if;
  -- Also close zero-job/no-command rewrites. Only a revision/time-only no-op is
  -- permitted; business changes require one of the 21 explicit commands.
  for field_name in select json_object_keys(previous) union select json_object_keys(proposed) loop
    if not (field_name = any(allowed))
      and not partner_hub.flow_json_field_equal(previous, proposed, field_name) then return false; end if;
  end loop;
  return true;
exception when data_exception then return false;
end;
$$;

create function partner_hub.flow_root_transition_valid(previous_payload text, proposed_payload text,
  row_case_id text, row_partner_id text, row_revision bigint, row_updated_at text)
returns boolean language plpgsql stable set search_path=pg_catalog as $$
declare previous json; proposed json; field_name text;
begin
  if proposed_payload is null or octet_length(proposed_payload) > 1800000 then return false; end if;
  proposed := proposed_payload::json;
  if not partner_hub.flow_domain_valid(proposed)
    or not partner_hub.flow_command_effect_transition_valid(previous_payload,proposed_payload,row_case_id,row_partner_id,row_revision,row_updated_at) then return false; end if;
  if previous_payload is null then
    -- Application first command inserts its empty revision-zero baseline and
    -- performs a guarded update in the same transaction; no history seeding.
    if row_revision <> 0 then return false; end if;
    foreach field_name in array array['reports','files','meetings','recordings','requests','payments'] loop
      if json_array_length(proposed -> field_name) <> 0 then return false; end if;
    end loop;
    if proposed -> 'decision' is not null or proposed -> 'contract' is not null or proposed -> 'aftercare' is not null
      or proposed -> 'executionStartedAt' is not null or (proposed -> 'analysis')::jsonb <> '{"reportId":""}'::jsonb
      or (proposed -> 'ai')::jsonb <> '{"enabled":false,"sourceText":""}'::jsonb then return false; end if;
    return proposed ->> 'updatedAt' = '' or partner_hub.flow_shape_time(proposed -> 'updatedAt') is not null;
  end if;
  previous := previous_payload::json;
  if not partner_hub.flow_domain_valid(previous) or partner_hub.flow_shape_time(proposed -> 'updatedAt') is null then return false; end if;
  return partner_hub.flow_new_receipt_actor_valid(previous,proposed)
    and partner_hub.flow_internal_effect_valid(previous,proposed);
exception when data_exception then return false;
end;
$$;

-- Legacy metadata-only objects retain their existing allowance. New app writes
-- supply ETag + SHA-256 through the immutable ledger in the same transaction.
create function partner_hub.flow_file_ledgers_valid(flow_payload json)
returns boolean language plpgsql stable set search_path=pg_catalog as $$
begin
  if not partner_hub.flow_domain_valid(flow_payload) then return false; end if;
  return not exists (
    select 1 from json_array_elements(flow_payload -> 'files') file
    left join partner_hub.consulting_flow_file_owners owner on owner.file_id = file.value ->> 'id'
    left join partner_hub.consulting_flow_file_metadata metadata on metadata.file_id = owner.file_id
    left join partner_hub.consulting_flow_file_object_integrity integrity on integrity.file_id = owner.file_id
    left join partner_hub.consulting_flow_file_object_checksums checksum on checksum.file_id = owner.file_id
    where owner.file_id is null or owner.case_id is distinct from flow_payload ->> 'caseId'
      or owner.storage_key is distinct from file.value ->> 'key' or owner.created_at is distinct from file.value ->> 'createdAt'
      or metadata.file_id is null or metadata.original_name is distinct from file.value ->> 'name'
      or metadata.content_type is distinct from file.value ->> 'contentType'
      or metadata.size_bytes is distinct from (file.value ->> 'size')::bigint or metadata.purpose is distinct from file.value ->> 'purpose'
      or metadata.intake_file_id is distinct from file.value ->> 'intakeFileId'
      or metadata.intake_source_hash is distinct from file.value ->> 'intakeSourceHash'
      or metadata.source_reviewed_at is distinct from file.value ->> 'sourceReviewedAt'
      or metadata.source_reviewed_by is distinct from file.value ->> 'sourceReviewedBy'
      or integrity.file_id is null or integrity.r2_content_type is distinct from metadata.content_type
      or integrity.validation_mode not in ('metadata','etag')
      or (integrity.validation_mode = 'metadata' and (integrity.r2_etag is not null or checksum.file_id is not null))
      or (integrity.validation_mode = 'etag' and (integrity.r2_etag is null or length(trim(integrity.r2_etag)) not between 1 and 256))
      or (checksum.file_id is not null and checksum.sha256 !~ '^[0-9a-f]{64}$')
  );
exception when data_exception then return false;
end;
$$;

create table partner_hub.consulting_flows (
  case_id text primary key, partner_id text not null, revision bigint not null,
  payload text not null, updated_at text not null
);
create function partner_hub.guard_flow_root()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if TG_OP = 'DELETE' then raise exception 'FLOW root is durable' using errcode='23514'; end if;
  if TG_OP = 'UPDATE' and (NEW.case_id is distinct from OLD.case_id or NEW.partner_id is distinct from OLD.partner_id) then
    raise exception 'FLOW identity is immutable' using errcode='23514';
  end if;
  if not partner_hub.flow_root_transition_valid(case when TG_OP = 'UPDATE' then OLD.payload else null end,
    NEW.payload,NEW.case_id,NEW.partner_id,NEW.revision,NEW.updated_at) then
    raise exception 'FLOW root transition is invalid' using errcode='23514';
  end if;
  return NEW;
end;
$$;
create trigger consulting_flows_guard before insert or update or delete on partner_hub.consulting_flows
  for each row execute function partner_hub.guard_flow_root();

-- Check the FINAL root, not an intermediate insert baseline, after all file
-- owner/metadata/checksum claims or source archival updates in the batch.
create function partner_hub.guard_flow_root_file_commit()
returns trigger language plpgsql set search_path=pg_catalog as $$
declare final_payload json;
begin
  select payload::json into final_payload from partner_hub.consulting_flows where case_id=NEW.case_id;
  if not found or (final_payload ->> 'revision')::bigint < 1
    or partner_hub.flow_shape_time(final_payload -> 'updatedAt') is null
    or not partner_hub.flow_file_ledgers_valid(final_payload) then
    raise exception 'FLOW file ledger commit is invalid' using errcode='23514';
  end if;
  return null;
end;
$$;
create constraint trigger consulting_flows_file_commit after insert or update on partner_hub.consulting_flows
  deferrable initially deferred for each row execute function partner_hub.guard_flow_root_file_commit();

-- Dashboard projection occurs inside PostgreSQL. No report bodies, transcripts,
-- storage keys, AI sources, jobs, command fingerprints or audit text leave DB.
create function partner_hub.flow_dashboard_payload(flow_payload json)
returns text language plpgsql immutable set search_path=pg_catalog as $$
declare projected jsonb;
begin
  if not partner_hub.flow_domain_valid(flow_payload) then return null; end if;
  projected := flow_payload::jsonb - array['files','audit','commandIds','commandReceipts','jobs'];
  projected := jsonb_set(projected,'{ai}',(projected -> 'ai') - 'sourceText');
  projected := jsonb_set(projected,'{reports}',coalesce((select jsonb_agg(jsonb_build_object(
    'id',entry.value -> 'id','stage',entry.value -> 'stage','sourceReportId',entry.value -> 'sourceReportId',
    'sourceRecordingId',entry.value -> 'sourceRecordingId','decisionId',entry.value -> 'decisionId',
    'documentsKey',entry.value -> 'documentsKey') order by entry.ordinal)
    from json_array_elements(flow_payload -> 'reports') with ordinality entry(value,ordinal)),'[]'::jsonb));
  projected := jsonb_set(projected,'{recordings}',coalesce((select jsonb_agg(jsonb_build_object('id',entry.value -> 'id') order by entry.ordinal)
    from json_array_elements(flow_payload -> 'recordings') with ordinality entry(value,ordinal)),'[]'::jsonb));
  return projected::text;
exception when data_exception then return null;
end;
$$;

alter table partner_hub.consulting_flows enable row level security;
revoke all on partner_hub.consulting_flows from public,anon,authenticated;
grant select,insert,update on partner_hub.consulting_flows to service_role;
create function partner_hub.assert_consulting_flow_schema()
returns integer language plpgsql set search_path=pg_catalog as $$
begin
  perform partner_hub.assert_flow_file_ledger_schema();
  if not exists(select 1 from pg_class c where c.oid='partner_hub.consulting_flows'::regclass and c.relrowsecurity)
    or (select count(*) from pg_trigger where tgrelid='partner_hub.consulting_flows'::regclass and tgenabled='O'
      and ((tgname='consulting_flows_guard' and tgfoid='partner_hub.guard_flow_root()'::regprocedure)
        or (tgname='consulting_flows_file_commit' and tgfoid='partner_hub.guard_flow_root_file_commit()'::regprocedure and tgdeferrable and tginitdeferred))) <> 2 then
    raise exception 'SUPABASE_FLOW_SCHEMA_NOT_READY';
  end if;
  return 1;
end;
$$;
revoke all on function partner_hub.flow_new_receipt_actor_valid(json,json),partner_hub.flow_internal_effect_valid(json,json),
  partner_hub.flow_root_transition_valid(text,text,text,text,bigint,text),partner_hub.flow_file_ledgers_valid(json),
  partner_hub.guard_flow_root(),partner_hub.guard_flow_root_file_commit(),partner_hub.flow_dashboard_payload(json),
  partner_hub.assert_consulting_flow_schema() from public,anon,authenticated;
grant execute on function partner_hub.flow_new_receipt_actor_valid(json,json),partner_hub.flow_internal_effect_valid(json,json),
  partner_hub.flow_root_transition_valid(text,text,text,text,bigint,text),partner_hub.flow_file_ledgers_valid(json),
  partner_hub.flow_dashboard_payload(json),partner_hub.assert_consulting_flow_schema() to service_role;

commit;
