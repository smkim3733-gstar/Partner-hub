begin;

-- Command effect-presence, state scope and collection target boundaries only.
-- These pure functions do NOT expose a FLOW root or certify full readiness.
-- Exact command effects, domain/reference/evidence and authoritative actor
-- validation remain required before the complete root guard can be installed.
create function partner_hub.flow_command_rules()
returns jsonb language sql immutable set search_path = pg_catalog as $$
  select '{
    "import_intake_source":{"effects":["files"],"scope":["files"],"targets":{}},
    "save_source":{"effects":["ai.sourceText","files"],"scope":["ai.sourceText","files"],"targets":{}},
    "exclude_source":{"effects":["files"],"scope":["files"],"targets":{}},
    "set_ai_policy":{"effects":["ai"],"scope":["ai.enabled","ai.approvedAt","ai.approvedBy","jobs"],"targets":{}},
    "queue_report1":{"effects":["jobs"],"scope":["jobs"],"targets":{}},
    "save_report":{"effects":["reports"],"scope":["reports","files","analysis"],"targets":{"reports":{"kind":"append","idSuffix":"report"}}},
    "confirm_analysis":{"effects":["analysis"],"scope":["analysis"],"targets":{}},
    "book_meeting":{"effects":["meetings"],"scope":["meetings"],"targets":{"meetings":{"kind":"append","idSuffix":"meeting"}}},
    "complete_meeting":{"effects":["meetings"],"scope":["meetings"],"targets":{"meetings":{"kind":"update","fields":["status","completedAt","note"],"minimum":1,"maximum":1}}},
    "cancel_meeting":{"effects":["meetings"],"scope":["meetings"],"targets":{"meetings":{"kind":"update","fields":["status","note"],"minimum":1,"maximum":1}}},
    "save_recording":{"effects":["recordings"],"scope":["recordings","jobs","files"],"targets":{"recordings":{"kind":"append","idSuffix":"recording"}}},
    "save_transcript":{"effects":["recordings"],"scope":["recordings","jobs","files"],"targets":{"recordings":{"kind":"update","fields":["transcript","transcriptFileId","transcriptReviewedAt","transcriptReviewedBy"],"minimum":1,"maximum":1}}},
    "retry_job":{"effects":["jobs"],"scope":["jobs"],"targets":{}},
    "confirm_solutions":{"effects":["decision"],"scope":["decision"],"targets":{}},
    "request_document":{"effects":["requests"],"scope":["requests"],"targets":{"requests":{"kind":"append","idSuffix":"request"}}},
    "mark_request_sent":{"effects":["requests"],"scope":["requests"],"targets":{"requests":{"kind":"update","fields":["sentAt"],"minimum":1,"maximum":1}}},
    "receive_document":{"effects":["requests"],"scope":["requests","files"],"targets":{"requests":{"kind":"update","fields":["fileId","status","receivedAt","reviewedAt","verifiedAt","note"],"minimum":1,"maximum":1}}},
    "review_document":{"effects":["requests"],"scope":["requests"],"targets":{"requests":{"kind":"update","fields":["status","note","reviewedAt","verifiedAt"],"minimum":1,"maximum":1}}},
    "record_contract":{"effects":["contract"],"scope":["contract","meetings","files"],"targets":{"meetings":{"kind":"update","fields":["status","completedAt"],"minimum":0,"maximum":1}}},
    "confirm_payment":{"effects":["payments"],"scope":["payments","executionStartedAt"],"targets":{"payments":{"kind":"append","idSuffix":"payment"}}},
    "start_aftercare":{"effects":["aftercare"],"scope":["aftercare"],"targets":{}}
  }'::jsonb;
$$;

-- Nested history compares compact text, not jsonb normalization. Scalar null
-- and absence collapse for state scope, as in the existing SQLite guard.
create function partner_hub.flow_json_path_equal(previous json, proposed json, field_path text[])
returns boolean language sql immutable set search_path = pg_catalog as $$
  select case when json_typeof(previous #> field_path) in ('object', 'array')
      or json_typeof(proposed #> field_path) in ('object', 'array') then
    partner_hub.flow_json_compact(previous #> field_path)
      is not distinct from partner_hub.flow_json_compact(proposed #> field_path)
  else nullif((previous #> field_path)::jsonb, 'null'::jsonb)
    is not distinct from nullif((proposed #> field_path)::jsonb, 'null'::jsonb) end;
$$;

-- Target properties preserve type as well as value: absent != null and integer
-- spelling != real spelling (SQLite json_type). Full domain bounds are separate.
create function partner_hub.flow_json_type_tag(value json)
returns text language sql immutable strict set search_path = pg_catalog as $$
  select case when json_typeof(value) = 'number' then
    -- json_type describes lexical integer/real, even above SQLite int64 range;
    -- do not confuse it with typeof(json_extract(...)), which can be real.
    case when partner_hub.flow_json_compact(value) ~ '^-?(0|[1-9][0-9]*)$'
      then 'integer' else 'real' end
    else json_typeof(value) end;
$$;

create function partner_hub.flow_command_scope_valid(previous json, proposed json, action text)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare rule jsonb; field_path text; effect_changed boolean := false;
begin
  rule := partner_hub.flow_command_rules() -> action;
  if rule is null or json_typeof(previous) is distinct from 'object' or json_typeof(proposed) is distinct from 'object'
    or not partner_hub.flow_json_unique_keys(previous) or not partner_hub.flow_json_unique_keys(proposed) then return false; end if;
  foreach field_path in array array['company','partnerName','reports','files','analysis','meetings','recordings',
    'requests','decision','contract','payments','executionStartedAt','aftercare',
    'ai.enabled','ai.approvedAt','ai.approvedBy','ai.sourceText','jobs'] loop
    if not (rule -> 'scope' ? field_path)
      and not partner_hub.flow_json_path_equal(previous, proposed, string_to_array(field_path, '.')) then return false; end if;
  end loop;
  for field_path in select jsonb_array_elements_text(rule -> 'effects') loop
    if not partner_hub.flow_json_path_equal(previous, proposed, string_to_array(field_path, '.')) then effect_changed := true; end if;
  end loop;
  return effect_changed;
exception when data_exception then return false;
end;
$$;

create function partner_hub.flow_command_targets_valid(previous json, proposed json, command_id text, action text, updated_at text)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare rules jsonb; rule jsonb; collection_name text; old_items json; new_items json;
  old_item json; new_item json; position integer; changed integer; property text; target_id text;
  needs_target boolean := action in ('complete_meeting','cancel_meeting','save_transcript',
    'mark_request_sent','receive_document','review_document','record_contract');
begin
  rules := partner_hub.flow_command_rules() -> action;
  if rules is null or command_id is null or length(command_id) not between 1 and 200 or updated_at is null
    or json_typeof(previous) is distinct from 'object' or json_typeof(proposed) is distinct from 'object'
    or not partner_hub.flow_json_unique_keys(previous) or not partner_hub.flow_json_unique_keys(proposed) then return false; end if;
  if needs_target then
    if json_typeof(proposed -> 'commandReceipts' -> command_id -> 'targetId') is distinct from 'string' then return false; end if;
    target_id := proposed -> 'commandReceipts' -> command_id ->> 'targetId';
    if length(target_id) not between 1 and 200 then return false; end if;
  end if;
  foreach collection_name in array array['reports','meetings','recordings','requests','payments'] loop
    old_items := previous -> collection_name; new_items := proposed -> collection_name;
    if json_typeof(old_items) is distinct from 'array' or json_typeof(new_items) is distinct from 'array' then return false; end if;
    if greatest(json_array_length(old_items), json_array_length(new_items)) > (case when collection_name = 'reports' then 4000 else 2000 end)
      or exists (select 1 from (select value from json_array_elements(old_items) union all select value from json_array_elements(new_items)) item
        where json_typeof(item.value) is distinct from 'object' or json_typeof(item.value -> 'id') is distinct from 'string'
          or length(item.value ->> 'id') not between 1 and 200)
      or (select count(*) <> count(distinct value ->> 'id') from json_array_elements(old_items))
      or (select count(*) <> count(distinct value ->> 'id') from json_array_elements(new_items)) then return false; end if;
    rule := rules -> 'targets' -> collection_name;
    if rule is null then
      if not partner_hub.flow_json_field_equal(previous, proposed, collection_name) then return false; end if;
    elsif rule ->> 'kind' = 'append' then
      if json_array_length(new_items) <> json_array_length(old_items) + 1
        or not partner_hub.flow_json_array_prefix(old_items, new_items)
        or new_items -> json_array_length(old_items) ->> 'id' is distinct from command_id || '-' || (rule ->> 'idSuffix') then return false; end if;
    else
      if json_array_length(new_items) <> json_array_length(old_items) then return false; end if;
      changed := 0;
      for position in 0..json_array_length(old_items) - 1 loop
        old_item := old_items -> position; new_item := new_items -> position;
        if partner_hub.flow_json_compact(old_item) is not distinct from partner_hub.flow_json_compact(new_item) then continue; end if;
        changed := changed + 1;
        if new_item ->> 'id' is distinct from target_id then return false; end if;
        for property in select json_object_keys(old_item) union select json_object_keys(new_item) loop
          if not (rule -> 'fields' ? property) and (
            partner_hub.flow_json_type_tag(old_item -> property) is distinct from partner_hub.flow_json_type_tag(new_item -> property)
            or not partner_hub.flow_json_field_equal(old_item, new_item, property)) then return false; end if;
        end loop;
        case action
          when 'complete_meeting' then
            if new_item ->> 'status' is distinct from 'completed' or new_item ->> 'completedAt' is distinct from updated_at then return false; end if;
          when 'cancel_meeting' then
            if new_item ->> 'status' is distinct from 'cancelled' then return false; end if;
          when 'save_transcript' then
            if new_item ->> 'id' is distinct from new_items -> (json_array_length(new_items) - 1) ->> 'id'
              or new_item ->> 'transcriptReviewedAt' is distinct from updated_at then return false; end if;
          when 'mark_request_sent' then
            if new_item ->> 'sentAt' is distinct from updated_at then return false; end if;
          when 'receive_document' then
            if new_item ->> 'status' is distinct from 'received' then return false; end if;
          when 'review_document' then
            if coalesce(new_item ->> 'status', '') not in ('verified','needs_fix')
              or new_item ->> 'reviewedAt' is distinct from updated_at then return false; end if;
          when 'record_contract' then
            if new_item ->> 'id' is distinct from proposed #>> '{contract,meetingId}'
              or new_item ->> 'status' is distinct from 'completed' then return false; end if;
          else return false;
        end case;
      end loop;
      if changed not between (rule ->> 'minimum')::integer and (rule ->> 'maximum')::integer then return false; end if;
      -- Contract may refer to an already-completed, unchanged meeting, but may
      -- not use that zero-change allowance to select a nonexistent/wrong target.
      if action = 'record_contract' and (proposed #>> '{contract,meetingId}' is distinct from target_id
        or not exists (select 1 from json_array_elements(old_items) item where item.value ->> 'id' = target_id)
        or not exists (select 1 from json_array_elements(new_items) item
          where item.value ->> 'id' = target_id and item.value ->> 'status' = 'completed')) then return false; end if;
    end if;
  end loop;
  return true;
exception when data_exception then return false;
end;
$$;

-- Composition point for the later root guard. Core checks retain row/envelope,
-- command history, receipts, audit and job lifecycle. Internal job-only writes
-- still need the separate non-command/domain layer, not these command rules.
create function partner_hub.flow_command_boundary_valid(previous_payload text, proposed_payload text,
  row_case_id text, row_partner_id text, row_revision bigint, row_updated_at text)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare previous json; proposed json; old_count integer; command_id text; action text;
begin
  if not partner_hub.flow_core_transition_valid(previous_payload, proposed_payload,
    row_case_id, row_partner_id, row_revision, row_updated_at) then return false; end if;
  if previous_payload is null then return true; end if;
  previous := previous_payload::json; proposed := proposed_payload::json;
  old_count := json_array_length(previous -> 'commandIds');
  if json_array_length(proposed -> 'commandIds') = old_count then return true; end if;
  command_id := proposed -> 'commandIds' ->> old_count;
  action := proposed -> 'commandReceipts' -> command_id ->> 'action';
  return partner_hub.flow_command_scope_valid(previous, proposed, action)
    and partner_hub.flow_command_targets_valid(previous, proposed, command_id, action, row_updated_at);
exception when data_exception then return false;
end;
$$;

revoke all on function partner_hub.flow_command_rules(),
  partner_hub.flow_json_path_equal(json,json,text[]), partner_hub.flow_json_type_tag(json),
  partner_hub.flow_command_scope_valid(json,json,text),
  partner_hub.flow_command_targets_valid(json,json,text,text,text),
  partner_hub.flow_command_boundary_valid(text,text,text,text,bigint,text)
  from public, anon, authenticated;
grant execute on function partner_hub.flow_command_rules(),
  partner_hub.flow_json_path_equal(json,json,text[]), partner_hub.flow_json_type_tag(json),
  partner_hub.flow_command_scope_valid(json,json,text),
  partner_hub.flow_command_targets_valid(json,json,text,text,text),
  partner_hub.flow_command_boundary_valid(text,text,text,text,bigint,text)
  to service_role;

commit;
