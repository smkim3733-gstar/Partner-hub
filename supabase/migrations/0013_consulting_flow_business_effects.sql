begin;

-- Remaining fifteen command effects and composition of all twenty-one.
-- Still no FLOW root or whole-runtime readiness: domain/reference/evidence,
-- authoritative account checks and internal AI-result transitions are separate.

create function partner_hub.flow_js_trim(value text)
returns text language sql immutable strict set search_path = pg_catalog as $$
  select btrim(value,chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)
    ||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)
    ||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279));
$$;
create function partner_hub.flow_text_valid(value json, minimum integer, maximum integer)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select coalesce(json_typeof(value) = 'string' and length(value #>> '{}') between minimum and maximum
    and value #>> '{}' = partner_hub.flow_js_trim(value #>> '{}'),false);
$$;
create function partner_hub.flow_integer_valid(value json, minimum numeric, maximum numeric)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
begin
  if json_typeof(value) is distinct from 'number' or partner_hub.flow_json_compact(value) !~ '^-?(0|[1-9][0-9]*)$' then return false; end if;
  return value::text::numeric between minimum and maximum;
exception when data_exception then return false;
end;
$$;
create function partner_hub.flow_date_only_valid(value text)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
begin
  if value is null or value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
  return to_char(value::date,'YYYY-MM-DD') = value;
exception when data_exception then return false;
end;
$$;

-- Derived prerequisites only; not a substitute for the full stored shape.
create function partner_hub.flow_business_context(value json)
returns json language plpgsql immutable set search_path = pg_catalog as $$
declare collection text; reports json[] := array[]::json[]; report json; recording json; first_meeting json; deep_report json;
  stage integer; documents_key text; analysis_done boolean; preparation_done boolean; documents_done boolean; signing_ready boolean;
  paid numeric := 0;
begin
  if json_typeof(value) is distinct from 'object' or not partner_hub.flow_json_unique_keys(value) then return null; end if;
  foreach collection in array array['reports','files','meetings','recordings','requests','payments'] loop
    if json_typeof(value -> collection) is distinct from 'array' then return null; end if;
    if json_array_length(value -> collection) > (case when collection in ('reports','files') then 4000 else 2000 end)
      or exists(select 1 from json_array_elements(value -> collection) item where json_typeof(item.value) is distinct from 'object'
        or not partner_hub.flow_text_valid(item.value -> 'id',1,200))
      or (select count(*) <> count(distinct item.value ->> 'id') from json_array_elements(value -> collection) item) then return null; end if;
  end loop;
  if exists(select 1 from json_array_elements(value -> 'reports') item where not partner_hub.flow_integer_valid(item.value -> 'stage',1,6))
    or exists(select 1 from json_array_elements(value -> 'requests') item where json_typeof(item.value -> 'required') is distinct from 'boolean')
    or exists(select 1 from json_array_elements(value -> 'payments') item where not partner_hub.flow_integer_valid(item.value -> 'amountWon',1,1000000000000)) then return null; end if;
  for stage in 1..6 loop
    select item.value into report from json_array_elements(value -> 'reports') with ordinality item(value,position)
      where item.value ->> 'stage' = stage::text order by position desc limit 1;
    reports[stage] := report;
  end loop;
  recording := value -> 'recordings' -> (json_array_length(value -> 'recordings') - 1);
  select item.value into first_meeting from json_array_elements(value -> 'meetings') with ordinality item(value,position)
    where item.value ->> 'kind' = 'first' and item.value ->> 'status' <> 'cancelled' order by position limit 1;
  select item.value into deep_report from json_array_elements(value -> 'reports') with ordinality item(value,position)
    where item.value ->> 'stage' = '4' and item.value ->> 'sourceReportId' = reports[1] ->> 'id'
      and item.value ->> 'sourceRecordingId' = recording ->> 'id' order by position desc limit 1;
  select partner_hub.flow_json_compact(coalesce(json_agg(json_build_array(item.value ->> 'id',
      item.value ->> 'fileId',item.value ->> 'verifiedAt') order by position),'[]'::json))
    into documents_key from json_array_elements(value -> 'requests') with ordinality item(value,position)
    where item.value ->> 'required' = 'true';
  analysis_done := coalesce(value #>> '{analysis,reportId}' = reports[1] ->> 'id'
    and length(value #>> '{analysis,adminAt}') > 0 and length(value #>> '{analysis,partnerAt}') > 0,false);
  preparation_done := coalesce(reports[1] ->> 'id' <> '' and reports[2] ->> 'sourceReportId' = reports[1] ->> 'id'
    and reports[3] ->> 'sourceReportId' = reports[1] ->> 'id',false);
  documents_done := coalesce(json_typeof(value -> 'decision') = 'object' and value #>> '{decision,reportId}' = deep_report ->> 'id'
    and json_typeof(value #> '{decision,documentsNeeded}') = 'boolean'
    and (value #>> '{decision,documentsNeeded}' = 'false' or exists(select 1 from json_array_elements(value -> 'requests') item where item.value ->> 'required' = 'true'))
    and not exists(select 1 from json_array_elements(value -> 'requests') item where item.value ->> 'required' = 'true' and item.value ->> 'status' is distinct from 'verified'),false);
  signing_ready := documents_done and coalesce(reports[5] ->> 'decisionId' = value #>> '{decision,id}'
    and reports[6] ->> 'decisionId' = value #>> '{decision,id}'
    and reports[5] ->> 'documentsKey' = documents_key and reports[6] ->> 'documentsKey' = documents_key,false);
  select coalesce(sum((item.value ->> 'amountWon')::numeric),0) into paid from json_array_elements(value -> 'payments') item;
  return json_build_object('r1',reports[1],'r2',reports[2],'r3',reports[3],'r4',reports[4],'r5',reports[5],'r6',reports[6],
    'recording',recording,'deep',deep_report,'first',first_meeting,'documentsKey',documents_key,'analysisDone',analysis_done,
    'preparationDone',preparation_done,'documentsDone',documents_done,'signingReady',signing_ready,'paid',paid);
exception when data_exception then return null;
end;
$$;

-- Exactly one referenced new attachment, or reuse of one intact existing file.
-- Byte integrity and ownership are still enforced by the separate file ledgers.
create function partner_hub.flow_attachment_effect_valid(previous json, proposed json, file_id text, purpose text, updated_at text, must_append boolean)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare target json; old_count integer; new_count integer; existed boolean;
begin
  if json_typeof(previous) is distinct from 'array' or json_typeof(proposed) is distinct from 'array'
    or not partner_hub.flow_json_array_prefix(previous,proposed) or must_append is null then return false; end if;
  old_count := json_array_length(previous); new_count := json_array_length(proposed);
  if file_id is null then return not must_append and old_count = new_count; end if;
  if (select count(*) from json_array_elements(proposed) item where item.value ->> 'id' = file_id) <> 1 then return false; end if;
  select item.value into target from json_array_elements(proposed) item where item.value ->> 'id' = file_id;
  if target ->> 'purpose' is distinct from purpose then return false; end if;
  existed := exists(select 1 from json_array_elements(previous) item where item.value ->> 'id' = file_id);
  if existed then return not must_append and old_count = new_count; end if;
  if new_count <> old_count + 1 or proposed -> old_count ->> 'id' is distinct from file_id
    or target ->> 'createdAt' is distinct from updated_at
    or (select count(*) from json_each(target)) <> 7
    or exists(select 1 from json_each(target) item where item.key not in ('id','name','contentType','size','key','createdAt','purpose')) then return false; end if;
  return true;
exception when data_exception then return false;
end;
$$;

create function partner_hub.flow_business_effect_valid(previous json, proposed json, command_id text, action text, updated_at text)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare context json; receipt json; actor_key text; actor_id text; actor_name text; target_id text; audit_detail text;
  item json; old_item json; expected json; attached json; stage integer; version integer; reference_id text; field_name text;
  completed boolean; new_cycle boolean; execution_time text; korean_date text;
begin
  if action is null or action not in ('save_report','confirm_analysis','book_meeting','complete_meeting','cancel_meeting','confirm_solutions',
    'request_document','mark_request_sent','receive_document','review_document','record_contract','confirm_payment','start_aftercare')
    or command_id is null or not coalesce(partner_hub.valid_utc_millisecond(updated_at),false)
    or not partner_hub.flow_core_shape_valid(previous) or not partner_hub.flow_core_shape_valid(proposed) then return false; end if;
  context := partner_hub.flow_business_context(previous);
  if context is null or partner_hub.flow_business_context(proposed) is null then return false; end if;
  receipt := proposed -> 'commandReceipts' -> command_id; actor_key := receipt ->> 'actorKey'; target_id := receipt ->> 'targetId';
  if actor_key = 'admin:primary' then actor_id := 'admin:primary'; actor_name := '김성민 대표';
  elsif actor_key = 'member:' || (previous ->> 'partnerId') then actor_id := previous ->> 'partnerId'; actor_name := previous ->> 'partnerName';
  else return false; end if;
  if action in ('save_report','confirm_solutions','request_document','review_document','confirm_payment','start_aftercare')
    and actor_key <> 'admin:primary' then return false; end if;
  korean_date := to_char((updated_at::timestamptz at time zone 'UTC') + interval '9 hours','YYYY-MM-DD');
  case action
    when 'save_report' then
      item := proposed -> 'reports' -> json_array_length(previous -> 'reports');
      if not partner_hub.flow_integer_valid(item -> 'stage',1,6) or not partner_hub.flow_text_valid(item -> 'body',0,80000)
        or (length(item ->> 'body') < 80 and json_typeof(item -> 'fileId') is distinct from 'string') then return false; end if;
      stage := (item ->> 'stage')::integer;
      if previous -> 'contract' is not null or exists(select 1 from json_array_elements(previous -> 'jobs') entry
          where entry.value ->> 'stage' = stage::text and entry.value ->> 'status' in ('queued','processing'))
        or (stage = 1 and context #>> '{first,completedAt}' is not null)
        or (stage in (2,3) and (context ->> 'analysisDone' <> 'true' or context #>> '{first,id}' is null))
        or (stage >= 5 and context ->> 'documentsDone' <> 'true') then return false; end if;
      select count(*)::integer + 1 into version from json_array_elements(previous -> 'reports') entry where entry.value ->> 'stage' = stage::text;
      expected := json_build_object('id',command_id || '-report','stage',stage,'version',version,
        'title',(array['1차 정밀진단보고서','2차 대표 상담보고서','3차 초회상담 PPT','4차 심화보고서','5차 견적서','6차 경영자문용역계약서'])[stage],
        'body',item ->> 'body');
      if item -> 'fileId' is not null then
        if not partner_hub.flow_text_valid(item -> 'fileId',1,200) then return false; end if;
        expected := partner_hub.flow_json_object_edit(expected,json_build_object('fileId',item ->> 'fileId'));
      end if;
      if stage > 1 then
        if context #>> '{r1,id}' is null then return false; end if;
        expected := partner_hub.flow_json_object_edit(expected,json_build_object('sourceReportId',context #>> '{r1,id}'));
      end if;
      if stage = 4 then
        if context #>> '{recording,id}' is null then return false; end if;
        expected := partner_hub.flow_json_object_edit(expected,json_build_object('sourceRecordingId',context #>> '{recording,id}'));
      end if;
      if stage >= 5 then
        if previous #>> '{decision,id}' is null then return false; end if;
        expected := partner_hub.flow_json_object_edit(expected,json_build_object('decisionId',previous #>> '{decision,id}','documentsKey',context ->> 'documentsKey'));
      end if;
      expected := partner_hub.flow_json_object_edit(expected,json_build_object('createdAt',updated_at,'createdBy','김성민 대표','origin','manual'));
      if partner_hub.flow_json_compact(item) is distinct from partner_hub.flow_json_compact(expected)
        or json_array_length(proposed -> 'reports') <> json_array_length(previous -> 'reports') + 1
        or not partner_hub.flow_json_array_prefix(previous -> 'reports',proposed -> 'reports')
        or not partner_hub.flow_attachment_effect_valid(previous -> 'files',proposed -> 'files',item ->> 'fileId','report',updated_at,false) then return false; end if;
      select entry.value into attached from json_array_elements(proposed -> 'files') entry where entry.value ->> 'id' = item ->> 'fileId';
      if (stage = 3 and not coalesce(attached ->> 'name' ~* '\.(pptx|pdf)$',false))
        or (stage = 1 and coalesce(attached ->> 'name' ~* '\.docx$',false) and length(item ->> 'body') < 80) then return false; end if;
      expected := case when stage = 1 then json_build_object('reportId',item ->> 'id') else previous -> 'analysis' end;
      if partner_hub.flow_json_compact(proposed -> 'analysis') is distinct from partner_hub.flow_json_compact(expected) then return false; end if;
    when 'confirm_analysis' then
      reference_id := context #>> '{r1,id}'; if reference_id is null then return false; end if;
      expected := case when previous #>> '{analysis,reportId}' = reference_id then previous -> 'analysis' else json_build_object('reportId',reference_id) end;
      expected := partner_hub.flow_json_object_edit(expected,json_build_object(case when actor_key = 'admin:primary' then 'adminAt' else 'partnerAt' end,updated_at));
      if partner_hub.flow_json_compact(proposed -> 'analysis') is distinct from partner_hub.flow_json_compact(expected) then return false; end if;
    when 'book_meeting' then
      item := proposed -> 'meetings' -> json_array_length(previous -> 'meetings');
      if item ->> 'kind' is null or item ->> 'kind' not in ('first','followup','contract')
        or item ->> 'attendance' is null or item ->> 'attendance' not in ('both','partner','admin')
        or not coalesce(partner_hub.valid_utc_millisecond(item ->> 'startsAt'),false)
        or not coalesce(partner_hub.valid_utc_millisecond(item ->> 'endsAt'),false)
        or item ->> 'endsAt' <= item ->> 'startsAt'
        or not partner_hub.flow_text_valid(item -> 'location',1,200) or not partner_hub.flow_text_valid(item -> 'note',0,1000) then return false; end if;
      expected := json_build_object('id',command_id || '-meeting','kind',item ->> 'kind','startsAt',item ->> 'startsAt',
        'endsAt',item ->> 'endsAt','attendance',item ->> 'attendance','location',item ->> 'location','status','scheduled','note',item ->> 'note','createdBy',actor_id);
      if partner_hub.flow_json_compact(item) is distinct from partner_hub.flow_json_compact(expected)
        or exists(select 1 from json_array_elements(previous -> 'meetings') entry where entry.value ->> 'status' = 'scheduled'
          and item ->> 'startsAt' < entry.value ->> 'endsAt' and item ->> 'endsAt' > entry.value ->> 'startsAt')
        or (item ->> 'kind' = 'first' and (context ->> 'analysisDone' <> 'true' or context #>> '{first,id}' is not null or item ->> 'attendance' <> 'both'))
        or (item ->> 'kind' = 'followup' and context #>> '{first,status}' is distinct from 'completed')
        or (item ->> 'kind' = 'contract' and (context ->> 'signingReady' <> 'true' or previous -> 'contract' is not null)) then return false; end if;
    when 'complete_meeting','cancel_meeting' then
      select entry.value into old_item from json_array_elements(previous -> 'meetings') entry where entry.value ->> 'id' = target_id;
      select entry.value into item from json_array_elements(proposed -> 'meetings') entry where entry.value ->> 'id' = target_id;
      if old_item is null or item is null or old_item ->> 'status' is distinct from 'scheduled' or old_item -> 'completedAt' is not null
        or not partner_hub.flow_text_valid(item -> 'note',0,1500)
        or (item ->> 'note' = '' and old_item ->> 'note' <> '')
        or (actor_key <> 'admin:primary' and coalesce(old_item ->> 'attendance','') not in ('both','partner')) then return false; end if;
      expected := partner_hub.flow_json_object_edit(old_item,json_build_object('status',case when action = 'complete_meeting' then 'completed' else 'cancelled' end));
      if action = 'complete_meeting' then
        if old_item ->> 'startsAt' > updated_at or (old_item ->> 'kind' = 'first' and (
          context ->> 'analysisDone' <> 'true' or context ->> 'preparationDone' <> 'true' or exists(
            select 1 from json_array_elements(previous -> 'jobs') entry where entry.value ->> 'stage' = '1' and entry.value ->> 'status' in ('queued','processing')))) then return false; end if;
        expected := partner_hub.flow_json_object_edit(expected,json_build_object('completedAt',updated_at));
      end if;
      expected := partner_hub.flow_json_object_edit(expected,json_build_object('note',item ->> 'note'));
      if partner_hub.flow_json_compact(item) is distinct from partner_hub.flow_json_compact(expected) then return false; end if;
    when 'confirm_solutions' then
      item := proposed -> 'decision';
      if previous -> 'contract' is not null or context #>> '{deep,id}' is null
        or json_typeof(item -> 'solutions') is distinct from 'array' or json_typeof(item -> 'documentsNeeded') is distinct from 'boolean'
        or not partner_hub.flow_text_valid(item -> 'note',0,2000) then return false; end if;
      if json_array_length(item -> 'solutions') not between 1 and 12
        or exists(select 1 from json_array_elements(item -> 'solutions') entry where not partner_hub.flow_text_valid(entry.value,1,80))
        or (select count(*) <> count(distinct entry.value #>> '{}') from json_array_elements(item -> 'solutions') entry) then return false; end if;
      expected := json_build_object('id',command_id || '-decision','reportId',context #>> '{deep,id}','solutions',item -> 'solutions',
        'documentsNeeded',item -> 'documentsNeeded','note',item ->> 'note','at',updated_at);
      if partner_hub.flow_json_compact(item) is distinct from partner_hub.flow_json_compact(expected) then return false; end if;
    when 'request_document' then
      item := proposed -> 'requests' -> json_array_length(previous -> 'requests');
      if previous -> 'contract' is not null or not partner_hub.flow_text_valid(item -> 'title',1,150)
        or not partner_hub.flow_text_valid(item -> 'recipient',1,100) or json_typeof(item -> 'required') is distinct from 'boolean'
        or coalesce(item ->> 'channel','') not in ('카카오톡','이메일','기타')
        or json_typeof(item -> 'dueDate') is distinct from 'string'
        or (item ->> 'dueDate' <> '' and not partner_hub.flow_date_only_valid(item ->> 'dueDate')) then return false; end if;
      expected := json_build_object('id',command_id || '-request','title',item ->> 'title','required',item -> 'required','channel',item ->> 'channel',
        'recipient',item ->> 'recipient','dueDate',item ->> 'dueDate','status','requested','note','','createdAt',updated_at);
      if partner_hub.flow_json_compact(item) is distinct from partner_hub.flow_json_compact(expected) then return false; end if;
    when 'mark_request_sent','receive_document','review_document' then
      select entry.value into old_item from json_array_elements(previous -> 'requests') entry where entry.value ->> 'id' = target_id;
      select entry.value into item from json_array_elements(proposed -> 'requests') entry where entry.value ->> 'id' = target_id;
      if old_item is null or item is null then return false; end if;
      if action = 'mark_request_sent' then
        expected := partner_hub.flow_json_object_edit(old_item,json_build_object('sentAt',updated_at));
        audit_detail := (old_item ->> 'channel') || ' 서류요청 실제 발송 기록';
      else
        if previous -> 'contract' is not null or not partner_hub.flow_text_valid(item -> 'note',0,1000) then return false; end if;
        if action = 'receive_document' then
          if not partner_hub.flow_text_valid(item -> 'fileId',1,200)
            or not partner_hub.flow_attachment_effect_valid(previous -> 'files',proposed -> 'files',item ->> 'fileId','requested_document',updated_at,false) then return false; end if;
          new_cycle := old_item ->> 'fileId' is distinct from item ->> 'fileId' or old_item ->> 'status' is distinct from 'received';
          expected := partner_hub.flow_json_object_edit(old_item,json_build_object('fileId',item ->> 'fileId','status','received'));
          if new_cycle then expected := partner_hub.flow_json_object_edit(expected,json_build_object('receivedAt',updated_at),array['reviewedAt','verifiedAt']); end if;
          expected := partner_hub.flow_json_object_edit(expected,json_build_object('note',item ->> 'note'));
          audit_detail := '요청 서류 수령 · 대표 검토 대기';
        else
          if old_item ->> 'status' = 'requested' or not partner_hub.flow_text_valid(old_item -> 'receivedAt',1,40)
            or not partner_hub.flow_text_valid(old_item -> 'fileId',1,200)
            or not partner_hub.flow_attachment_effect_valid(previous -> 'files',proposed -> 'files',old_item ->> 'fileId','requested_document',updated_at,false)
            or json_array_length(previous -> 'files') <> json_array_length(proposed -> 'files')
            or coalesce(item ->> 'status','') not in ('verified','needs_fix')
            or (item ->> 'status' = 'needs_fix' and item ->> 'note' = '') then return false; end if;
          expected := partner_hub.flow_json_object_edit(old_item,json_build_object('status',item ->> 'status','note',item ->> 'note','reviewedAt',updated_at));
          if item ->> 'status' = 'verified' then expected := partner_hub.flow_json_object_edit(expected,json_build_object('verifiedAt',updated_at));
          else expected := partner_hub.flow_json_object_edit(expected,'{}',array['verifiedAt']); end if;
          audit_detail := case when item ->> 'status' = 'verified' then '필수 서류 검토 완료' else '서류 보완 요청' end;
        end if;
      end if;
      if partner_hub.flow_json_compact(item) is distinct from partner_hub.flow_json_compact(expected) then return false; end if;
    when 'record_contract' then
      item := proposed -> 'contract';
      select entry.value into old_item from json_array_elements(previous -> 'meetings') entry where entry.value ->> 'id' = target_id;
      if previous -> 'contract' is not null or context ->> 'signingReady' <> 'true' or old_item is null
        or old_item ->> 'kind' is distinct from 'contract' or coalesce(old_item ->> 'status','') not in ('scheduled','completed')
        or old_item ->> 'startsAt' > updated_at
        or (actor_key <> 'admin:primary' and coalesce(old_item ->> 'attendance','') not in ('both','partner'))
        or not partner_hub.flow_date_only_valid(item ->> 'signedAt') or item ->> 'signedAt' > korean_date
        or not partner_hub.flow_integer_valid(item -> 'expectedDepositWon',1,1000000000000)
        or not partner_hub.flow_attachment_effect_valid(previous -> 'files',proposed -> 'files',item ->> 'signedFileId','signed_contract',updated_at,true) then return false; end if;
      expected := case when old_item ->> 'status' = 'scheduled' then
        partner_hub.flow_json_object_edit(old_item,json_build_object('status','completed','completedAt',updated_at)) else old_item end;
      select entry.value into attached from json_array_elements(proposed -> 'meetings') entry where entry.value ->> 'id' = target_id;
      if partner_hub.flow_json_compact(attached) is distinct from partner_hub.flow_json_compact(expected) then return false; end if;
      expected := json_build_object('meetingId',target_id,'reportId',context #>> '{r6,id}','signedFileId',item ->> 'signedFileId',
        'signedAt',item ->> 'signedAt','expectedDepositWon',item -> 'expectedDepositWon','recordedBy',actor_name);
      if partner_hub.flow_json_compact(item) is distinct from partner_hub.flow_json_compact(expected) then return false; end if;
      audit_detail := '서명본과 약정 계약금 등록 · 입금 확인 대기';
    when 'confirm_payment' then
      item := proposed -> 'payments' -> json_array_length(previous -> 'payments');
      if json_typeof(previous -> 'contract') is distinct from 'object'
        or not partner_hub.flow_integer_valid(previous #> '{contract,expectedDepositWon}',1,1000000000000)
        or not partner_hub.flow_integer_valid(item -> 'amountWon',1,1000000000000)
        or not partner_hub.flow_date_only_valid(item ->> 'receivedAt') or item ->> 'receivedAt' > korean_date
        or not partner_hub.flow_text_valid(item -> 'reference',1,200) then return false; end if;
      expected := json_build_object('id',command_id || '-payment','amountWon',item -> 'amountWon','receivedAt',item ->> 'receivedAt',
        'reference',item ->> 'reference','confirmedBy','김성민 대표','recordedAt',updated_at);
      if partner_hub.flow_json_compact(item) is distinct from partner_hub.flow_json_compact(expected) then return false; end if;
      completed := (context ->> 'paid')::numeric + (item ->> 'amountWon')::numeric >= (previous #>> '{contract,expectedDepositWon}')::numeric;
      execution_time := coalesce(previous ->> 'executionStartedAt',case when completed then updated_at end);
      if execution_time is null then
        if proposed -> 'executionStartedAt' is not null then return false; end if;
      elsif json_typeof(proposed -> 'executionStartedAt') is distinct from 'string' or proposed ->> 'executionStartedAt' is distinct from execution_time then return false; end if;
      audit_detail := case when completed then '약정 계약금 입금 확인 완료 · 컨설팅 수행 시작' else '계약금 일부 입금 확인 · 잔액 대기' end;
    when 'start_aftercare' then
      item := proposed -> 'aftercare';
      if json_typeof(previous -> 'contract') is distinct from 'object'
        or not partner_hub.flow_integer_valid(previous #> '{contract,expectedDepositWon}',1,1000000000000)
        or (context ->> 'paid')::numeric < (previous #>> '{contract,expectedDepositWon}')::numeric
        or not partner_hub.flow_text_valid(previous -> 'executionStartedAt',1,40)
        or not partner_hub.flow_text_valid(item -> 'summary',1,3000) or not partner_hub.flow_text_valid(item -> 'owner',1,100)
        or not partner_hub.flow_date_only_valid(item ->> 'nextDate') then return false; end if;
      expected := json_build_object('at',updated_at,'summary',item ->> 'summary','nextDate',item ->> 'nextDate','owner',item ->> 'owner');
      if partner_hub.flow_json_compact(item) is distinct from partner_hub.flow_json_compact(expected) then return false; end if;
      audit_detail := '컨설팅 수행 결과 확인 · 사후관리 일정 등록';
    else return false;
  end case;
  if audit_detail is not null and (select count(*) from json_array_elements(proposed -> 'audit') entry
    where entry.value ->> 'id' = command_id and entry.value ->> 'action' = action and entry.value ->> 'at' = updated_at and entry.value ->> 'detail' = audit_detail) <> 1 then return false; end if;
  return true;
exception when data_exception then return false;
end;
$$;

create function partner_hub.flow_recording_effect_valid(previous json, proposed json, command_id text, action text, updated_at text)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare context json; recording json; old_recording json; file_ids text[] := array[]::text[]; primary_file json; audio_file json;
  item json; expected json; history json; reason text; audit_detail text; enabled boolean; position integer; target_position integer; recording_id text; old_files integer;
begin
  if action is null or action not in ('save_recording','save_transcript') or command_id is null
    or not coalesce(partner_hub.valid_utc_millisecond(updated_at),false)
    or not partner_hub.flow_core_shape_valid(previous) or not partner_hub.flow_core_shape_valid(proposed)
    or json_typeof(proposed #> '{ai,enabled}') is distinct from 'boolean' or previous -> 'contract' is not null then return false; end if;
  context := partner_hub.flow_business_context(previous);
  if context is null or partner_hub.flow_business_context(proposed) is null then return false; end if;
  enabled := (proposed #>> '{ai,enabled}')::boolean; old_files := json_array_length(previous -> 'files');
  recording := proposed -> 'recordings' -> (json_array_length(proposed -> 'recordings') - 1); recording_id := recording ->> 'id';
  if recording_id is null or not partner_hub.flow_text_valid(recording -> 'transcript',0,60000) then return false; end if;
  if action = 'save_recording' then
    if recording_id <> command_id || '-recording' or recording ->> 'createdAt' is distinct from updated_at or recording ->> 'consentAt' is distinct from updated_at
      or not exists(select 1 from json_array_elements(previous -> 'meetings') entry where entry.value ->> 'id' = recording ->> 'meetingId' and entry.value ->> 'status' = 'completed') then return false; end if;
    if recording ->> 'transcript' <> '' then
      if length(recording ->> 'transcript') < 20 or exists(select 1 from json_array_elements(previous -> 'recordings') entry
        where entry.value ->> 'meetingId' = recording ->> 'meetingId' and entry.value ->> 'transcript' = recording ->> 'transcript') then return false; end if;
      if recording ->> 'transcriptReviewedAt' is distinct from updated_at or not partner_hub.flow_text_valid(recording -> 'transcriptReviewedBy',1,200) then return false; end if;
    elsif recording -> 'transcriptReviewedAt' is not null or recording -> 'transcriptReviewedBy' is not null then return false; end if;
    if recording -> 'fileId' is not null then
      if not partner_hub.flow_text_valid(recording -> 'fileId',1,200) then return false; end if;
      file_ids := array_append(file_ids,recording ->> 'fileId');
      primary_file := proposed -> 'files' -> old_files;
    end if;
    if recording -> 'audioFileId' is not null then
      if not partner_hub.flow_text_valid(recording -> 'audioFileId',1,200) then return false; end if;
      if recording ->> 'audioFileId' is distinct from recording ->> 'fileId' then file_ids := array_append(file_ids,recording ->> 'audioFileId'); end if;
    end if;
    if json_array_length(proposed -> 'files') <> old_files + cardinality(file_ids) or not partner_hub.flow_json_array_prefix(previous -> 'files',proposed -> 'files') then return false; end if;
    for position in 1..cardinality(file_ids) loop
      item := proposed -> 'files' -> (old_files + position - 1);
      if item ->> 'id' is distinct from file_ids[position] or item ->> 'purpose' is distinct from 'recording' or item ->> 'createdAt' is distinct from updated_at
        or (select count(*) from json_each(item)) <> 7
        or exists(select 1 from json_each(item) property where property.key not in ('id','name','contentType','size','key','createdAt','purpose')) then return false; end if;
    end loop;
    if cardinality(file_ids) = 0 and length(recording ->> 'transcript') < 20 then return false; end if;
    if coalesce(primary_file ->> 'name','') ~* '\.(docx|txt)$' then
      if recording ->> 'transcriptFileId' is distinct from recording ->> 'fileId' or length(recording ->> 'transcript') < 20 then return false; end if;
    elsif recording -> 'transcriptFileId' is not null then return false; end if;
    if coalesce(primary_file ->> 'name','') ~* '\.(mp3|m4a|wav)$' then
      if recording ->> 'audioFileId' is distinct from recording ->> 'fileId' then return false; end if;
    elsif recording -> 'audioFileId' is not null and recording ->> 'audioFileId' is not distinct from recording ->> 'fileId' then return false; end if;
    if recording -> 'audioFileId' is not null then
      select entry.value into audio_file from json_array_elements(proposed -> 'files') entry where entry.value ->> 'id' = recording ->> 'audioFileId';
      if not coalesce(audio_file ->> 'name' ~* '\.(mp3|m4a|wav)$',false) then return false; end if;
    end if;
    expected := json_build_object('id',recording_id,'meetingId',recording ->> 'meetingId');
    if recording -> 'fileId' is not null then expected := partner_hub.flow_json_object_edit(expected,json_build_object('fileId',recording ->> 'fileId')); end if;
    if recording -> 'transcriptFileId' is not null then expected := partner_hub.flow_json_object_edit(expected,json_build_object('transcriptFileId',recording ->> 'transcriptFileId')); end if;
    if recording -> 'audioFileId' is not null then expected := partner_hub.flow_json_object_edit(expected,json_build_object('audioFileId',recording ->> 'audioFileId')); end if;
    expected := partner_hub.flow_json_object_edit(expected,json_build_object('transcript',recording ->> 'transcript'));
    if recording ->> 'transcript' <> '' then expected := partner_hub.flow_json_object_edit(expected,json_build_object('transcriptReviewedAt',updated_at,'transcriptReviewedBy',recording ->> 'transcriptReviewedBy')); end if;
    expected := partner_hub.flow_json_object_edit(expected,json_build_object('consentAt',updated_at,'createdAt',updated_at));
    if partner_hub.flow_json_compact(recording) is distinct from partner_hub.flow_json_compact(expected) then return false; end if;
    audit_detail := case when recording ->> 'transcript' <> '' then '확인한 상담 전사문 저장 · 4차 심화보고서 생성 요청' else '보조 음성 보관 · 전사문 대기 (음성 자동전사 미실행)' end;
    reason := case when recording ->> 'transcript' = '' then '전사문 대기: Word·TXT를 첨부하거나 본문을 입력해 주세요. 음성은 보관만 하며 자동전사는 미연결입니다.'
      when not enabled then '김성민 대표의 외부 AI 자동생성 승인이 필요합니다.' else '' end;
    expected := json_build_object('id',command_id || '-job','stage',4,'sourceRecordingId',recording_id,'sourceReportId',context #>> '{r1,id}',
      'status',case when reason = '' then 'queued' else 'blocked' end,'reason',reason,'createdAt',updated_at);
    if context #>> '{r1,id}' is null or json_array_length(proposed -> 'jobs') <> json_array_length(previous -> 'jobs') + 1
      or not partner_hub.flow_json_array_prefix(previous -> 'jobs',proposed -> 'jobs')
      or partner_hub.flow_json_compact(proposed -> 'jobs' -> json_array_length(previous -> 'jobs')) is distinct from partner_hub.flow_json_compact(expected) then return false; end if;
  else
    old_recording := previous -> 'recordings' -> (json_array_length(previous -> 'recordings') - 1);
    if proposed -> 'commandReceipts' -> command_id ->> 'targetId' is distinct from recording_id or old_recording ->> 'id' is distinct from recording_id
      or not partner_hub.flow_text_valid(recording -> 'transcript',20,60000) or old_recording ->> 'transcript' is not distinct from recording ->> 'transcript'
      or recording ->> 'transcriptReviewedAt' is distinct from updated_at or not partner_hub.flow_text_valid(recording -> 'transcriptReviewedBy',1,200)
      or exists(select 1 from json_array_elements(previous -> 'jobs') entry where entry.value ->> 'sourceRecordingId' = recording_id and entry.value ->> 'status' in ('processing','complete')) then return false; end if;
    -- Preserve upload behavior as well as the old job-only SQL guard: one new
    -- transcript attachment or unchanged existing transcript-file reference.
    if json_array_length(proposed -> 'files') = old_files then
      if not partner_hub.flow_json_field_equal(previous,proposed,'files')
        or not partner_hub.flow_json_field_equal(old_recording,recording,'transcriptFileId')
        or json_typeof(old_recording -> 'transcriptFileId') is distinct from json_typeof(recording -> 'transcriptFileId') then return false; end if;
    else
      if not partner_hub.flow_attachment_effect_valid(previous -> 'files',proposed -> 'files',recording ->> 'transcriptFileId','recording',updated_at,true) then return false; end if;
      item := proposed -> 'files' -> old_files;
      if not coalesce(item ->> 'name' ~* '\.(docx|txt)$',false) then return false; end if;
    end if;
    if json_array_length(proposed -> 'jobs') <> json_array_length(previous -> 'jobs') then return false; end if;
    select (entry.position - 1)::integer into target_position from json_array_elements(previous -> 'jobs') with ordinality entry(value,position)
      where entry.value ->> 'sourceRecordingId' = recording_id order by entry.position desc limit 1;
    audit_detail := case when previous -> 'jobs' -> target_position ->> 'status' = 'failed' and not enabled
      then '전사문 보완 · AI 재승인 후 재시도 필요' else '전사문 보완 · 4차 생성 준비' end;
    for position in 0..json_array_length(previous -> 'jobs') - 1 loop
      item := previous -> 'jobs' -> position; expected := item;
      if position = target_position and not (item ->> 'status' = 'failed' and not enabled) then
        if json_typeof(item -> 'failureEvidence') = 'object' then
          history := coalesce(item -> 'failureEvidenceHistory','[]'::json);
          if json_typeof(history) is distinct from 'array' or json_array_length(history) >= 20 then return false; end if;
          history := (left(partner_hub.flow_json_compact(history),length(partner_hub.flow_json_compact(history)) - 1)
            || case when json_array_length(history) > 0 then ',' else '' end || partner_hub.flow_json_compact(item -> 'failureEvidence') || ']')::json;
          expected := partner_hub.flow_json_object_edit(expected,json_build_object('failureEvidenceHistory',history));
        end if;
        expected := partner_hub.flow_json_object_edit(expected,json_build_object('status',case when enabled then 'queued' else 'blocked' end,
          'reason',case when enabled then '' else '대표의 AI 자동생성 승인이 필요합니다.' end),array['failureEvidence','startedAt']);
      end if;
      if partner_hub.flow_json_compact(proposed -> 'jobs' -> position) is distinct from partner_hub.flow_json_compact(expected) then return false; end if;
    end loop;
  end if;
  if (select count(*) from json_array_elements(proposed -> 'audit') entry where entry.value ->> 'id' = command_id
    and entry.value ->> 'action' = action and entry.value ->> 'at' = updated_at and entry.value ->> 'detail' = audit_detail) <> 1 then return false; end if;
  return true;
exception when data_exception then return false;
end;
$$;

-- All command effect families composed with the existing core/scope/target
-- boundary. Internal job-only writes still need their dedicated result guard.
create function partner_hub.flow_command_effect_transition_valid(previous_payload text, proposed_payload text,
  row_case_id text, row_partner_id text, row_revision bigint, row_updated_at text)
returns boolean language plpgsql stable set search_path = pg_catalog as $$
declare previous json; proposed json; command_id text; action text; old_count integer;
begin
  if not partner_hub.flow_command_boundary_valid(previous_payload,proposed_payload,row_case_id,row_partner_id,row_revision,row_updated_at) then return false; end if;
  if previous_payload is null then return true; end if;
  previous := previous_payload::json; proposed := proposed_payload::json; old_count := json_array_length(previous -> 'commandIds');
  if old_count = json_array_length(proposed -> 'commandIds') then return true; end if;
  command_id := proposed -> 'commandIds' ->> old_count; action := proposed -> 'commandReceipts' -> command_id ->> 'action';
  if action in ('save_source','import_intake_source','exclude_source') then
    return partner_hub.flow_source_effect_valid(previous,proposed,action,row_updated_at);
  elsif action in ('set_ai_policy','queue_report1','retry_job') then
    return partner_hub.flow_ai_control_effect_valid(previous,proposed,command_id,action,row_updated_at);
  elsif action in ('save_recording','save_transcript') then
    return partner_hub.flow_recording_effect_valid(previous,proposed,command_id,action,row_updated_at);
  else
    return partner_hub.flow_business_effect_valid(previous,proposed,command_id,action,row_updated_at);
  end if;
exception when data_exception then return false;
end;
$$;

revoke all on function partner_hub.flow_js_trim(text), partner_hub.flow_text_valid(json,integer,integer),
  partner_hub.flow_integer_valid(json,numeric,numeric), partner_hub.flow_date_only_valid(text),
  partner_hub.flow_business_context(json), partner_hub.flow_attachment_effect_valid(json,json,text,text,text,boolean),
  partner_hub.flow_business_effect_valid(json,json,text,text,text), partner_hub.flow_recording_effect_valid(json,json,text,text,text),
  partner_hub.flow_command_effect_transition_valid(text,text,text,text,bigint,text) from public,anon,authenticated;
grant execute on function partner_hub.flow_js_trim(text), partner_hub.flow_text_valid(json,integer,integer),
  partner_hub.flow_integer_valid(json,numeric,numeric), partner_hub.flow_date_only_valid(text),
  partner_hub.flow_business_context(json), partner_hub.flow_attachment_effect_valid(json,json,text,text,text,boolean),
  partner_hub.flow_business_effect_valid(json,json,text,text,text), partner_hub.flow_recording_effect_valid(json,json,text,text,text),
  partner_hub.flow_command_effect_transition_valid(text,text,text,text,bigint,text) to service_role;

commit;
