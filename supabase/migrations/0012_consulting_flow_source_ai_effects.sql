begin;

-- Exact effects for six source/AI-control commands. This is an additive staged
-- layer, not a FLOW root, full command dispatcher or readiness assertion.

-- Top-level remove-then-set with original key order and untouched JSON spelling.
-- jsonb_set would normalize history; decoding/re-encoding all keys would also
-- lose escaped key spelling. Tokenize only to recover raw top-level keys, while
-- PostgreSQL's json parser owns values and validates syntax.
create function partner_hub.flow_json_object_edit(original json, replacements json, removed text[] default array[]::text[])
returns json language plpgsql immutable set search_path = pg_catalog as $fn$
declare token text; depth integer := 0; expect_key boolean := false; key_name text;
  pieces text[] := array[]::text[]; kept text[] := array[]::text[]; value json; member record;
begin
  if json_typeof(original) is distinct from 'object' or json_typeof(replacements) is distinct from 'object' or removed is null
    or array_position(removed, null) is not null
    or not partner_hub.flow_json_unique_keys(original) or not partner_hub.flow_json_unique_keys(replacements) then return null; end if;
  for token in select match[1] from regexp_matches(partner_hub.flow_json_compact(original),
    '("(?:[^"\\]|\\.)*"|[{}\[\],:]|[^"{}\[\],:]+)', 'g') with ordinality as tokens(match, ordinal) order by ordinal loop
    if depth = 1 and expect_key and left(token, 1) = '"' then
      key_name := token::json #>> '{}'; expect_key := false;
      if not (key_name = any(removed)) then
        value := coalesce(replacements -> key_name, original -> key_name);
        pieces := array_append(pieces, token || ':' || partner_hub.flow_json_compact(value));
        kept := array_append(kept, key_name);
      end if;
    end if;
    if token in ('{','[') then depth := depth + 1; if depth = 1 then expect_key := true; end if;
    elsif token in ('}',']') then depth := depth - 1;
    elsif token = ',' and depth = 1 then expect_key := true;
    end if;
  end loop;
  for member in select * from json_each(replacements) loop
    if not (member.key = any(kept)) then
      pieces := array_append(pieces, to_json(member.key)::text || ':' || partner_hub.flow_json_compact(member.value));
    end if;
  end loop;
  return ('{' || coalesce(array_to_string(pieces, ','), '') || '}')::json;
exception when data_exception then return null;
end;
$fn$;

create function partner_hub.flow_ai_control_effect_valid(previous json, proposed json, command_id text, action text, updated_at text)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare old_jobs json; new_jobs json; old_job json; new_job json; expected json; history json;
  position integer; retried integer := 0; enabled boolean; reason text;
begin
  if action is null or action not in ('set_ai_policy','queue_report1','retry_job') or command_id is null or updated_at is null
    or json_typeof(previous) is distinct from 'object' or json_typeof(proposed) is distinct from 'object'
    or not partner_hub.flow_json_unique_keys(previous) or not partner_hub.flow_json_unique_keys(proposed)
    or json_typeof(proposed #> '{ai,enabled}') is distinct from 'boolean' then return false; end if;
  enabled := (proposed #>> '{ai,enabled}')::boolean;
  old_jobs := previous -> 'jobs'; new_jobs := proposed -> 'jobs';
  if json_typeof(old_jobs) is distinct from 'array' or json_typeof(new_jobs) is distinct from 'array' then return false; end if;
  if greatest(json_array_length(old_jobs),json_array_length(new_jobs)) > 2000 or exists (
    select 1 from (select value from json_array_elements(old_jobs) union all select value from json_array_elements(new_jobs)) item
      where json_typeof(item.value) is distinct from 'object'
  ) then return false; end if;
  if action = 'queue_report1' then
    reason := case when enabled then '' else '김성민 대표의 외부 AI 자동생성 승인이 필요합니다.' end;
    expected := json_build_object('id',command_id || '-job','stage',1,
      'status',case when enabled then 'queued' else 'blocked' end,'reason',reason,'createdAt',updated_at);
    return json_array_length(new_jobs) = json_array_length(old_jobs) + 1
      and partner_hub.flow_json_array_prefix(old_jobs,new_jobs)
      and partner_hub.flow_json_compact(new_jobs -> json_array_length(old_jobs)) = partner_hub.flow_json_compact(expected);
  end if;
  if json_array_length(old_jobs) <> json_array_length(new_jobs) then return false; end if;
  for position in 0..json_array_length(old_jobs) - 1 loop
    old_job := old_jobs -> position; new_job := new_jobs -> position;
    expected := old_job;
    if action = 'set_ai_policy' then
      if not enabled and old_job ->> 'status' = 'queued' then
        expected := partner_hub.flow_json_object_edit(old_job,'{"status":"blocked","reason":"대표가 자동생성을 중지했습니다."}');
      end if;
    elsif old_job ->> 'status' in ('blocked','failed','processing') then
      if json_typeof(old_job -> 'failureEvidence') = 'object' then
        history := coalesce(old_job -> 'failureEvidenceHistory','[]'::json);
        if json_typeof(history) is distinct from 'array' or json_array_length(history) >= 20 then return false; end if;
        history := (left(partner_hub.flow_json_compact(history),length(partner_hub.flow_json_compact(history)) - 1)
          || case when json_array_length(history) > 0 then ',' else '' end
          || partner_hub.flow_json_compact(old_job -> 'failureEvidence') || ']')::json;
        expected := partner_hub.flow_json_object_edit(expected,json_build_object('failureEvidenceHistory',history));
      elsif old_job -> 'failureEvidence' is not null then return false;
      end if;
      expected := partner_hub.flow_json_object_edit(expected,'{"status":"queued","reason":""}',array['failureEvidence','startedAt']);
      if partner_hub.flow_json_compact(new_job) = partner_hub.flow_json_compact(expected) then
        retried := retried + 1;
      else expected := old_job;
      end if;
    end if;
    if expected is null or partner_hub.flow_json_compact(new_job) is distinct from partner_hub.flow_json_compact(expected) then return false; end if;
  end loop;
  return action = 'set_ai_policy' or retried = 1;
exception when data_exception then return false;
end;
$$;

-- Read the real source ledgers in the caller's transaction. Legacy name-based
-- assignment remains allowed only when no stable member assignment exists.
-- The immutable source hash here is a provenance value; this does not claim
-- to read or hash actual Storage bytes.
create function partner_hub.flow_intake_origin_valid(previous json, file json, updated_at text)
returns boolean language plpgsql stable set search_path = pg_catalog as $$
begin
  if json_typeof(previous) is distinct from 'object' or json_typeof(file) is distinct from 'object' or updated_at is null
    or not partner_hub.flow_json_unique_keys(previous) or not partner_hub.flow_json_unique_keys(file) then return false; end if;
  if json_typeof(file -> 'intakeFileId') is distinct from 'string' or btrim(file ->> 'intakeFileId') = ''
    or json_typeof(file -> 'intakeSourceHash') is distinct from 'string' or file ->> 'intakeSourceHash' !~ '^[0-9a-f]{64}$'
    or json_typeof(file -> 'sourceReviewedAt') is distinct from 'string' or file ->> 'sourceReviewedAt' is distinct from updated_at
    or json_typeof(file -> 'sourceReviewedBy') is distinct from 'string' or btrim(file ->> 'sourceReviewedBy') = '' then return false; end if;
  return exists (
    select 1 from partner_hub.company_file_objects source
    left join partner_hub.company_file_assignments assignment on assignment.file_id = source.id
    left join partner_hub.company_file_case_links case_link on case_link.file_id = source.id
    where source.id = file ->> 'intakeFileId' and source.company = previous ->> 'company'
      and (case_link.case_id is null or case_link.case_id = previous ->> 'caseId')
      and ((assignment.partner_member_id is not null and length(assignment.partner_member_id) > 0 and assignment.partner_member_id = previous ->> 'partnerId')
        or (assignment.partner_member_id is null and source.assigned_trainee = previous ->> 'partnerName'))
      and not exists (select 1 from partner_hub.company_file_upload_requests upload where upload.file_id = source.id and upload.status = 'deleted')
      and exists (select 1 from partner_hub.company_file_storage_keys object_key where object_key.file_id = source.id and object_key.storage_key = source.storage_key)
      and exists (select 1 from partner_hub.company_file_metadata metadata where metadata.file_id = source.id
        and (metadata.original_name,metadata.company,metadata.category,metadata.title,metadata.assigned_trainee,
          metadata.uploaded_by_user_id,metadata.uploaded_by_email,metadata.content_type,metadata.size_bytes,metadata.created_at)
          = (source.original_name,source.company,source.category,source.title,source.assigned_trainee,
            source.uploaded_by_user_id,source.uploaded_by_email,source.content_type,source.size_bytes,source.created_at))
      and exists (select 1 from partner_hub.company_file_object_integrity integrity where integrity.file_id = source.id and integrity.r2_content_type = source.content_type
        and ((integrity.validation_mode = 'metadata' and integrity.r2_etag is null)
          or (integrity.validation_mode = 'etag' and integrity.r2_etag is not null and length(integrity.r2_etag) between 1 and 256)))
      and (case_link.case_id is null or case_link.case_id not like 'case-draft-%'
        or not exists (select 1 from partner_hub.company_file_upload_requests upload where upload.file_id = source.id)
        or exists (select 1 from partner_hub.portal_state portal cross join lateral
          json_array_elements(case when json_typeof(portal.payload::json -> 'companyDocuments') = 'array'
            then portal.payload::json -> 'companyDocuments' else '[]'::json end) document
          where portal.id = 'keve-partner-hub' and partner_hub.flow_json_unique_keys(portal.payload::json)
            and document.value ->> 'storageFileId' = source.id and document.value ->> 'caseId' = case_link.case_id))
  );
exception when data_exception then return false;
end;
$$;

create function partner_hub.flow_source_effect_valid(previous json, proposed json, action text, updated_at text)
returns boolean language plpgsql stable set search_path = pg_catalog as $$
declare old_files json; new_files json; old_file json; new_file json; expected json; position integer; changed integer := 0;
begin
  if action is null or action not in ('save_source','import_intake_source','exclude_source') or updated_at is null
    or json_typeof(previous) is distinct from 'object' or json_typeof(proposed) is distinct from 'object'
    or not partner_hub.flow_json_unique_keys(previous) or not partner_hub.flow_json_unique_keys(proposed) then return false; end if;
  old_files := previous -> 'files'; new_files := proposed -> 'files';
  if json_typeof(old_files) is distinct from 'array' or json_typeof(new_files) is distinct from 'array' then return false; end if;
  if greatest(json_array_length(old_files),json_array_length(new_files)) > 4000 or exists (
    select 1 from (select value from json_array_elements(old_files) union all select value from json_array_elements(new_files)) item
      where json_typeof(item.value) is distinct from 'object'
  ) then return false; end if;
  if action in ('save_source','import_intake_source') then
    if json_array_length(new_files) not between json_array_length(old_files) + (case when action = 'import_intake_source' then 1 else 0 end)
        and json_array_length(old_files) + 1 or not partner_hub.flow_json_array_prefix(old_files,new_files) then return false; end if;
    if json_array_length(new_files) = json_array_length(old_files) then return true; end if;
    new_file := new_files -> json_array_length(old_files);
    if new_file ->> 'purpose' is distinct from 'source' or new_file ->> 'createdAt' is distinct from updated_at then return false; end if;
    if action = 'save_source' then return new_file -> 'intakeFileId' is null; end if;
    return partner_hub.flow_intake_origin_valid(previous,new_file,updated_at);
  end if;
  if json_array_length(new_files) <> json_array_length(old_files) then return false; end if;
  for position in 0..json_array_length(old_files) - 1 loop
    old_file := old_files -> position; new_file := new_files -> position;
    if partner_hub.flow_json_compact(old_file) is not distinct from partner_hub.flow_json_compact(new_file) then continue; end if;
    changed := changed + 1;
    expected := partner_hub.flow_json_object_edit(old_file,'{"purpose":"source_archived"}');
    if old_file ->> 'purpose' is distinct from 'source' or expected is null
      or partner_hub.flow_json_compact(new_file) is distinct from partner_hub.flow_json_compact(expected) then return false; end if;
  end loop;
  return changed = 1;
exception when data_exception then return false;
end;
$$;

revoke all on function partner_hub.flow_json_object_edit(json,json,text[]),
  partner_hub.flow_ai_control_effect_valid(json,json,text,text,text),
  partner_hub.flow_intake_origin_valid(json,json,text), partner_hub.flow_source_effect_valid(json,json,text,text)
  from public, anon, authenticated;
grant execute on function partner_hub.flow_json_object_edit(json,json,text[]),
  partner_hub.flow_ai_control_effect_valid(json,json,text,text,text),
  partner_hub.flow_intake_origin_valid(json,json,text), partner_hub.flow_source_effect_valid(json,json,text,text)
  to service_role;

commit;
