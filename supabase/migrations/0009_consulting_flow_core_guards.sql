begin;

-- Staged, pure validation functions ONLY. This migration deliberately creates no
-- consulting_flows table, write API or readiness assertion. Command-specific
-- effects, domain/evidence semantics, file ledgers and authoritative actor checks
-- must all be ported before a later migration binds the complete root guard.

-- Match SQLite json(): remove whitespace outside strings without normalizing
-- object key order, escape spelling or number spelling. jsonb equality is NOT
-- suitable for immutable audit/evidence history.
create function partner_hub.flow_json_compact(value json)
returns text language sql immutable strict set search_path = pg_catalog as $fn$
  select string_agg(token[1], '' order by ordinal)
  from regexp_matches(value::text, '("(?:[^"\\]|\\.)*"|[^"\t\r\n ]+)', 'g')
    with ordinality as tokens(token, ordinal);
$fn$;

create function partner_hub.flow_json_unique_keys(value json)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
begin
  if value is null then return false; end if;
  -- Validate decoded Unicode before any ->> extraction; json alone accepts
  -- escaped NUL and unpaired surrogates that PostgreSQL text cannot represent.
  perform value::jsonb;
  return not exists (
    with recursive nodes(item) as (
      select value
      union all
      select child.value from nodes parent cross join lateral (
        select member.value from json_each(case when json_typeof(parent.item) = 'object' then parent.item else '{}'::json end) member
        union all
        select element.value from json_array_elements(case when json_typeof(parent.item) = 'array' then parent.item else '[]'::json end) element
      ) child
    )
    select 1 from nodes where json_typeof(item) = 'object'
      and (select count(*) <> count(distinct key) from json_each(item))
  );
exception when data_exception then return false;
end;
$$;

-- JSON scalar equality after extraction (missing and JSON null collapse), but
-- nested objects/arrays retain SQLite's exact compact textual representation.
create function partner_hub.flow_json_field_equal(previous json, proposed json, field_name text)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select case when json_typeof(previous -> field_name) in ('object', 'array')
      or json_typeof(proposed -> field_name) in ('object', 'array') then
    partner_hub.flow_json_compact(previous -> field_name)
      is not distinct from partner_hub.flow_json_compact(proposed -> field_name)
  else nullif((previous -> field_name)::jsonb, 'null'::jsonb)
    is not distinct from nullif((proposed -> field_name)::jsonb, 'null'::jsonb) end;
$$;

create function partner_hub.flow_json_array_prefix(previous json, proposed json)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
begin
  if json_typeof(previous) is distinct from 'array' or json_typeof(proposed) is distinct from 'array' then return false; end if;
  return json_array_length(proposed) >= json_array_length(previous) and not exists (
    select 1 from json_array_elements(previous) with ordinality as old_item(value, ordinal)
    where partner_hub.flow_json_compact(old_item.value)
      is distinct from partner_hub.flow_json_compact(proposed -> (old_item.ordinal::integer - 1))
  );
end;
$$;

-- Structural prerequisites only for the collections used by the core guard.
-- Full report/file/payment/AI evidence schemas remain a separate required layer.
create function partner_hub.flow_core_shape_valid(value json)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare field_name text; item json; receipt record;
begin
  if json_typeof(value) is distinct from 'object' or not partner_hub.flow_json_unique_keys(value) then return false; end if;
  foreach field_name in array array['audit', 'commandIds', 'jobs'] loop
    if json_typeof(value -> field_name) is distinct from 'array' then return false; end if;
    if json_array_length(value -> field_name) > (case when field_name = 'audit' then 4000 else 2000 end) then return false; end if;
  end loop;
  if value -> 'commandReceipts' is not null then
    if json_typeof(value -> 'commandReceipts') is distinct from 'object' then return false; end if;
    if (select count(*) from json_each(value -> 'commandReceipts')) > 2000 then return false; end if;
  end if;
  if exists (select 1 from json_array_elements(value -> 'commandIds') item
    where json_typeof(item.value) is distinct from 'string' or length(item.value #>> '{}') not between 1 and 200)
    or (select count(*) <> count(distinct item.value #>> '{}') from json_array_elements(value -> 'commandIds') item) then return false; end if;
  foreach field_name in array array['audit', 'jobs'] loop
    if exists (select 1 from json_array_elements(value -> field_name) item
      where json_typeof(item.value) is distinct from 'object' or json_typeof(item.value -> 'id') is distinct from 'string'
        or length(item.value ->> 'id') not between 1 and 200)
      or (select count(*) <> count(distinct item.value ->> 'id') from json_array_elements(value -> field_name) item) then return false; end if;
  end loop;
  for item in select * from json_array_elements(value -> 'audit') loop
    foreach field_name in array array['at', 'actor', 'action', 'detail'] loop
      if json_typeof(item -> field_name) is distinct from 'string' then return false; end if;
    end loop;
  end loop;
  for item in select * from json_array_elements(value -> 'jobs') loop
    if json_typeof(item -> 'status') is distinct from 'string' or item ->> 'status' not in ('queued', 'processing', 'blocked', 'failed', 'complete')
      or json_typeof(item -> 'stage') is distinct from 'number' or item ->> 'stage' not in ('1', '4')
      or json_typeof(item -> 'createdAt') is distinct from 'string' or json_typeof(item -> 'reason') is distinct from 'string' then return false; end if;
    foreach field_name in array array['sourceRecordingId', 'sourceReportId', 'startedAt', 'completedAt', 'reportId'] loop
      if item -> field_name is not null and json_typeof(item -> field_name) is distinct from 'string' then return false; end if;
    end loop;
    foreach field_name in array array['evidence', 'failureEvidence'] loop
      if item -> field_name is not null and json_typeof(item -> field_name) is distinct from 'object' then return false; end if;
    end loop;
    if item -> 'failureEvidenceHistory' is not null then
      if json_typeof(item -> 'failureEvidenceHistory') is distinct from 'array' then return false; end if;
      if json_array_length(item -> 'failureEvidenceHistory') > 20 or exists (
        select 1 from json_array_elements(item -> 'failureEvidenceHistory') entry where json_typeof(entry.value) is distinct from 'object'
      ) then return false; end if;
    end if;
  end loop;
  for receipt in select * from json_each(coalesce(value -> 'commandReceipts', '{}'::json)) loop
    if json_typeof(receipt.value) is distinct from 'object' then return false; end if;
    foreach field_name in array array['actorKey', 'fingerprint'] loop
      if json_typeof(receipt.value -> field_name) is distinct from 'string' then return false; end if;
    end loop;
    foreach field_name in array array['actor', 'action', 'targetId'] loop
      if receipt.value -> field_name is not null and json_typeof(receipt.value -> field_name) is distinct from 'string' then return false; end if;
    end loop;
  end loop;
  return true;
exception when data_exception then return false;
end;
$$;

create function partner_hub.flow_core_job_transition_valid(previous json, proposed json, updated_at text)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare old_status text := previous ->> 'status'; new_status text := proposed ->> 'status';
  field_name text; old_history json; new_history json;
begin
  if json_typeof(previous) is distinct from 'object' or json_typeof(proposed) is distinct from 'object'
    or old_status is null or new_status is null or updated_at is null
    or old_status not in ('queued', 'processing', 'blocked', 'failed', 'complete')
    or new_status not in ('queued', 'processing', 'blocked', 'failed', 'complete') then return false; end if;
  foreach field_name in array array['id', 'stage', 'sourceRecordingId', 'sourceReportId', 'createdAt'] loop
    if not partner_hub.flow_json_field_equal(previous, proposed, field_name) then return false; end if;
  end loop;
  if not (old_status = new_status
    or (old_status = 'queued' and new_status in ('processing', 'blocked'))
    or (old_status in ('blocked', 'failed') and new_status = 'queued')
    or (old_status = 'processing' and new_status in ('queued', 'blocked', 'failed', 'complete'))) then return false; end if;

  if old_status = new_status then
    if old_status = 'blocked' then
      if proposed -> 'startedAt' is not null and not partner_hub.flow_json_field_equal(previous, proposed, 'startedAt') then return false; end if;
      foreach field_name in array array['completedAt', 'reportId', 'evidence', 'failureEvidence'] loop
        if proposed -> field_name is not null then return false; end if;
      end loop;
    else
      foreach field_name in array array['reason', 'startedAt', 'completedAt', 'reportId', 'evidence', 'failureEvidence'] loop
        if not partner_hub.flow_json_field_equal(previous, proposed, field_name) then return false; end if;
      end loop;
    end if;
  else
    if json_typeof(proposed -> 'reason') is distinct from 'string' then return false; end if;
    if new_status in ('queued', 'processing', 'complete') then
      if proposed ->> 'reason' <> '' then return false; end if;
    elsif proposed ->> 'reason' = '' then return false;
    end if;
    if new_status = 'processing' then
      if json_typeof(proposed -> 'startedAt') is distinct from 'string'
        or proposed ->> 'startedAt' is distinct from updated_at then return false; end if;
    elsif new_status = 'queued' or old_status = 'queued' then
      if proposed -> 'startedAt' is not null then return false; end if;
    elsif not partner_hub.flow_json_field_equal(previous, proposed, 'startedAt') then return false;
    end if;
    if new_status = 'complete' then
      if json_typeof(proposed -> 'completedAt') is distinct from 'string' or proposed ->> 'completedAt' is distinct from updated_at
        or json_typeof(proposed -> 'reportId') is distinct from 'string' or json_typeof(proposed -> 'evidence') is distinct from 'object'
        or proposed -> 'failureEvidence' is not null then return false; end if;
    else
      foreach field_name in array array['completedAt', 'reportId', 'evidence'] loop
        if proposed -> field_name is not null then return false; end if;
      end loop;
      if new_status <> 'failed' and proposed -> 'failureEvidence' is not null then return false; end if;
    end if;
  end if;

  if json_typeof(previous -> 'evidence') = 'object' then
    if json_typeof(proposed -> 'evidence') is distinct from 'object'
      or not partner_hub.flow_json_field_equal(previous, proposed, 'evidence') then return false; end if;
  elsif proposed -> 'evidence' is not null and not (old_status = 'processing' and new_status = 'complete') then return false;
  end if;
  old_history := coalesce(previous -> 'failureEvidenceHistory', '[]'::json);
  new_history := coalesce(proposed -> 'failureEvidenceHistory', '[]'::json);
  if not partner_hub.flow_json_array_prefix(old_history, new_history) then return false; end if;
  if json_typeof(previous -> 'failureEvidence') = 'object' then
    if proposed -> 'failureEvidence' is null then
      if json_array_length(new_history) <> json_array_length(old_history) + 1
        or partner_hub.flow_json_compact(new_history -> json_array_length(old_history))
          is distinct from partner_hub.flow_json_compact(previous -> 'failureEvidence') then return false; end if;
    elsif json_typeof(proposed -> 'failureEvidence') is distinct from 'object'
      or not partner_hub.flow_json_field_equal(previous, proposed, 'failureEvidence')
      or json_array_length(new_history) <> json_array_length(old_history) then return false;
    end if;
  else
    if json_array_length(new_history) <> json_array_length(old_history)
      or (proposed -> 'failureEvidence' is not null and not (old_status = 'processing' and new_status = 'failed')) then return false; end if;
  end if;
  return true;
exception when data_exception then return false;
end;
$$;

create function partner_hub.flow_core_transition_valid(previous_payload text, proposed_payload text,
  row_case_id text, row_partner_id text, row_revision bigint, row_updated_at text)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare previous json; proposed json; item record; old_job json; field_name text;
  old_commands integer; added_commands integer; old_audit integer; completed_jobs integer := 0; retried_jobs integer := 0;
  command_id text; receipt json; audit json;
begin
  proposed := proposed_payload::json;
  if not partner_hub.flow_core_shape_valid(proposed) or row_case_id is null or row_partner_id is null
    or row_revision is null or row_revision not between 0 and 9007199254740991 or row_updated_at is null then return false; end if;
  if json_typeof(proposed -> 'caseId') is distinct from 'string' or proposed ->> 'caseId' is distinct from row_case_id
    or json_typeof(proposed -> 'partnerId') is distinct from 'string' or proposed ->> 'partnerId' is distinct from row_partner_id
    or json_typeof(proposed -> 'revision') is distinct from 'number' or proposed ->> 'revision' is distinct from row_revision::text
    or json_typeof(proposed -> 'updatedAt') is distinct from 'string' or proposed ->> 'updatedAt' is distinct from row_updated_at then return false; end if;
  if previous_payload is null then
    return json_array_length(proposed -> 'commandIds') = 0 and json_array_length(proposed -> 'audit') = 0
      and json_array_length(proposed -> 'jobs') = 0
      and not exists (select 1 from json_each(coalesce(proposed -> 'commandReceipts', '{}'::json)));
  end if;
  previous := previous_payload::json;
  if not partner_hub.flow_core_shape_valid(previous)
    or row_revision < 1 or json_typeof(previous -> 'caseId') is distinct from 'string'
    or json_typeof(previous -> 'partnerId') is distinct from 'string' or json_typeof(previous -> 'updatedAt') is distinct from 'string'
    or previous ->> 'caseId' is distinct from row_case_id or previous ->> 'partnerId' is distinct from row_partner_id
    or json_typeof(previous -> 'revision') is distinct from 'number'
    or previous ->> 'revision' is distinct from (row_revision - 1)::text then return false; end if;
  old_commands := json_array_length(previous -> 'commandIds');
  added_commands := json_array_length(proposed -> 'commandIds') - old_commands;
  old_audit := json_array_length(previous -> 'audit');
  if added_commands not between 0 and 1 or not partner_hub.flow_json_array_prefix(previous -> 'audit', proposed -> 'audit')
    or exists (select 1 from json_array_elements_text(previous -> 'commandIds') with ordinality prefix_command(value, ordinal)
      where proposed -> 'commandIds' ->> (prefix_command.ordinal::integer - 1) is distinct from prefix_command.value) then return false; end if;

  for item in select * from json_each(coalesce(previous -> 'commandReceipts', '{}'::json)) loop
    receipt := proposed -> 'commandReceipts' -> item.key;
    if receipt is null then return false; end if;
    foreach field_name in array array['actorKey', 'fingerprint', 'actor', 'action', 'targetId'] loop
      if not partner_hub.flow_json_field_equal(item.value, receipt, field_name) then return false; end if;
    end loop;
    if json_typeof(item.value -> 'targetId') is distinct from json_typeof(receipt -> 'targetId') then return false; end if;
  end loop;
  command_id := proposed -> 'commandIds' ->> old_commands;
  for item in select * from json_each(coalesce(proposed -> 'commandReceipts', '{}'::json)) loop
    if previous -> 'commandReceipts' -> item.key is null and item.key is distinct from command_id then return false; end if;
  end loop;
  if added_commands = 1 then
    receipt := proposed -> 'commandReceipts' -> command_id;
    select entry.value into audit from json_array_elements(proposed -> 'audit') with ordinality entry(value, ordinal)
      where entry.ordinal > old_audit and entry.value ->> 'id' = command_id;
    if receipt is null or audit is null or audit ->> 'at' is distinct from row_updated_at or audit ->> 'action' = 'ai_result'
      or json_typeof(receipt -> 'actor') is distinct from 'string' or json_typeof(receipt -> 'action') is distinct from 'string'
      or receipt ->> 'actor' is distinct from audit ->> 'actor' or receipt ->> 'action' is distinct from audit ->> 'action' then return false; end if;
    if receipt ->> 'action' in ('complete_meeting', 'cancel_meeting', 'mark_request_sent', 'receive_document',
      'review_document', 'record_contract', 'save_transcript') then
      if json_typeof(receipt -> 'targetId') is distinct from 'string' or length(receipt ->> 'targetId') not between 1 and 200 then return false; end if;
    elsif receipt -> 'targetId' is not null then return false;
    end if;
  end if;

  if exists (select 1 from json_array_elements(previous -> 'jobs') old_item where not exists (
    select 1 from json_array_elements(proposed -> 'jobs') new_item where new_item.value ->> 'id' = old_item.value ->> 'id'
  )) then return false; end if;
  for item in select value from json_array_elements(proposed -> 'jobs') loop
    select value into old_job from json_array_elements(previous -> 'jobs') old_item where old_item.value ->> 'id' = item.value ->> 'id';
    if old_job is null then
      if item.value ->> 'status' not in ('queued', 'blocked') or command_id is null
        or item.value ->> 'id' is distinct from command_id || '-job' then return false; end if;
      foreach field_name in array array['startedAt', 'completedAt', 'reportId', 'evidence', 'failureEvidence', 'failureEvidenceHistory'] loop
        if item.value -> field_name is not null then return false; end if;
      end loop;
      if item.value ->> 'createdAt' is distinct from row_updated_at then return false; end if;
      if item.value ->> 'stage' = '1' then
        if item.value -> 'sourceRecordingId' is not null or item.value -> 'sourceReportId' is not null then return false; end if;
      else
        if json_typeof(proposed -> 'recordings') is distinct from 'array' or json_typeof(proposed -> 'reports') is distinct from 'array'
          or json_typeof(item.value -> 'sourceRecordingId') is distinct from 'string'
          or json_typeof(item.value -> 'sourceReportId') is distinct from 'string' then return false; end if;
        if item.value ->> 'sourceRecordingId' is distinct from proposed -> 'recordings' -> -1 ->> 'id'
          or item.value ->> 'sourceReportId' is distinct from (
            select report.value ->> 'id' from json_array_elements(proposed -> 'reports') with ordinality report(value, ordinal)
            where (report.value -> 'stage')::jsonb = '1'::jsonb order by ordinal desc limit 1
          ) then return false; end if;
      end if;
      if (select count(*) from json_array_elements(proposed -> 'audit') with ordinality entry(value, ordinal)
        where entry.ordinal > old_audit and entry.value ->> 'id' = command_id and entry.value ->> 'at' = row_updated_at
          and entry.value ->> 'action' = (case when item.value ->> 'stage' = '1' then 'queue_report1' else 'save_recording' end)) <> 1 then return false; end if;
    else
      if not partner_hub.flow_core_job_transition_valid(old_job, item.value, row_updated_at) then return false; end if;
      if old_job ->> 'status' = 'processing' and item.value ->> 'status' in ('blocked', 'failed', 'complete') then
        completed_jobs := completed_jobs + 1;
        if added_commands <> 0 then return false; end if;
        if (select count(*) from json_array_elements(proposed -> 'audit') with ordinality entry(value, ordinal)
          where entry.ordinal > old_audit and entry.value ->> 'id' = (item.value ->> 'id') || '-' || row_updated_at
            and entry.value ->> 'at' = row_updated_at and entry.value ->> 'actor' = '보고서 자동생성'
            and entry.value ->> 'action' = 'ai_result') <> 1 then return false; end if;
      elsif old_job ->> 'status' = 'queued' and item.value ->> 'status' = 'processing' and added_commands <> 0 then return false;
      end if;
      if old_job ->> 'status' in ('blocked', 'failed', 'processing') and item.value ->> 'status' = 'queued' then
        retried_jobs := retried_jobs + 1;
      end if;
    end if;
  end loop;
  if retried_jobs > 0 and retried_jobs <> (select count(*) from json_array_elements(proposed -> 'audit') with ordinality entry(value, ordinal)
    where entry.ordinal > old_audit and entry.value ->> 'at' = row_updated_at
      and entry.value ->> 'action' in ('retry_job', 'save_transcript')) then return false; end if;
  return json_array_length(proposed -> 'audit') = old_audit + added_commands + completed_jobs;
exception when data_exception then return false;
end;
$$;

-- Pure helpers still must not be directly executable by browser roles. Do not
-- grant blanket function privileges or SECURITY DEFINER access to other data.
revoke all on function partner_hub.flow_json_compact(json), partner_hub.flow_json_unique_keys(json),
  partner_hub.flow_json_field_equal(json,json,text), partner_hub.flow_json_array_prefix(json,json),
  partner_hub.flow_core_shape_valid(json), partner_hub.flow_core_job_transition_valid(json,json,text),
  partner_hub.flow_core_transition_valid(text,text,text,text,bigint,text) from public, anon, authenticated;
grant execute on function partner_hub.flow_json_compact(json), partner_hub.flow_json_unique_keys(json),
  partner_hub.flow_json_field_equal(json,json,text), partner_hub.flow_json_array_prefix(json,json),
  partner_hub.flow_core_shape_valid(json), partner_hub.flow_core_job_transition_valid(json,json,text),
  partner_hub.flow_core_transition_valid(text,text,text,text,bigint,text) to service_role;

commit;
