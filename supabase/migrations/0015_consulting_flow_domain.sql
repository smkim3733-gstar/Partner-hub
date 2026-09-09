begin;

-- Stored-domain checks. These do not create a root or authorize a caller.
-- JSONB below is used only for semantic lookup, never to rewrite stored history.
create function partner_hub.flow_shape_rules()
returns jsonb language sql immutable set search_path=pg_catalog as $$
  select '{"root":{"schemaVersion":"i:1:1","caseId":"n:200","company":"n:300","partnerId":"n:200","partnerName":"n:200","revision":"i:0:9007199254740991","updatedAt":"t:40","reports":"x","files":"x","analysis":"x","meetings":"x","recordings":"x","requests":"x","decision":"?x","contract":"?x","payments":"x","executionStartedAt":"?d","aftercare":"?x","ai":"x","jobs":"x","audit":"x","commandIds":"x","commandReceipts":"?x"},"report":{"id":"n:200","stage":"i:1:6","version":"i:1:9007199254740991","title":"n:200","body":"t:80000","fileId":"?n:200","sourceReportId":"?n:200","sourceRecordingId":"?n:200","decisionId":"?n:200","documentsKey":"?n:300000","createdAt":"d","createdBy":"n:200","origin":"v:manual,ai"},"file":{"id":"n:200","name":"n:300","contentType":"n:200","size":"i:1:9007199254740991","key":"n:600","createdAt":"d","purpose":"n:100","intakeFileId":"?n:500","intakeSourceHash":"?n:500","sourceReviewedAt":"?d","sourceReviewedBy":"?n:500"},"analysis":{"reportId":"t:200","adminAt":"?d","partnerAt":"?d"},"meeting":{"id":"n:200","kind":"v:first,followup,contract","startsAt":"d","endsAt":"d","location":"n:200","attendance":"v:both,partner,admin","status":"v:scheduled,completed,cancelled","note":"t:1500","createdBy":"n:200","completedAt":"?d"},"recording":{"id":"n:200","meetingId":"n:200","fileId":"?n:200","transcriptFileId":"?n:200","audioFileId":"?n:200","transcript":"t:60000","transcriptReviewedAt":"?d","transcriptReviewedBy":"?n:200","consentAt":"d","createdAt":"d"},"request":{"id":"n:200","title":"n:150","required":"b","channel":"v:카카오톡,이메일,기타","recipient":"n:100","dueDate":"C","status":"v:requested,received,verified,needs_fix","fileId":"?n:200","sentAt":"?d","note":"t:1000","createdAt":"d","receivedAt":"?d","reviewedAt":"?d","verifiedAt":"?d"},"decision":{"id":"n:200","reportId":"n:200","solutions":"x","note":"t:2000","documentsNeeded":"b","at":"d"},"contract":{"meetingId":"n:200","reportId":"n:200","signedFileId":"n:200","signedAt":"c","expectedDepositWon":"i:1:1000000000000","recordedBy":"n:200"},"payment":{"id":"n:200","amountWon":"i:1:1000000000000","receivedAt":"c","reference":"n:200","confirmedBy":"n:200","recordedAt":"d"},"aftercare":{"at":"d","summary":"n:3000","nextDate":"c","owner":"n:100"},"ai":{"enabled":"b","approvedAt":"?d","approvedBy":"?n:200","sourceText":"t:80000"},"job":{"id":"n:200","stage":"i:1:4","sourceRecordingId":"?n:200","sourceReportId":"?n:200","status":"v:queued,processing,blocked,failed,complete","reason":"t:4000","createdAt":"d","startedAt":"?d","completedAt":"?d","reportId":"?n:200","evidence":"?x","failureEvidence":"?x","failureEvidenceHistory":"?x"},"jobEvidence":{"auditId":"n:200","instructionVersion":"e:100","requestedModel":"e:200","providerRequestId":"e:200","providerModel":"e:200","providerMessageId":"e:512","inputTokens":"i:1:9007199254740991","outputTokens":"i:1:9007199254740991","observedAt":"d"},"jobFailureEvidence":{"auditId":"n:200","instructionVersion":"e:100","requestedModel":"e:200","httpStatus":"i:400:599","observedAt":"d","providerRequestId":"?e:200"},"audit":{"id":"n:200","at":"d","actor":"n:200","action":"n:100","detail":"n:2000"},"receipt":{"actorKey":"n:500","fingerprint":"n:200","actor":"?n:200","action":"?n:100","targetId":"?n:200"}}'::jsonb;
$$;

-- Explicit ISO calendar/time inputs accepted by the existing SQLite path.
-- Reject locale-dependent PostgreSQL input, infinity and relative dates.
-- Legacy records outside this format need migration preflight, not silent edits.
create function partner_hub.flow_shape_time(value json)
returns timestamptz language plpgsql immutable set search_path=pg_catalog set timezone='UTC' set datestyle='ISO,YMD' as $$
declare source text;
begin
  if json_typeof(value) is distinct from 'string' then return null; end if;
  source := value #>> '{}';
  if length(source) not between 1 and 40
    or source !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([Tt ][0-9]{2}:[0-5][0-9](:[0-5][0-9](\.[0-9]+)?)?([Zz]|[+-][0-9]{2}:[0-5][0-9])?)?$' then return null; end if;
  -- JavaScript stores milliseconds: do not introduce PostgreSQL microsecond
  -- rounding differences into ordering of otherwise equal legacy instants.
  source:=regexp_replace(source,'(\.[0-9]{3})[0-9]+','\1');
  return source::timestamptz;
exception when data_exception then return null;
end;
$$;

-- n = nonblank name (legacy padding retained), t = text, e = trimmed name,
-- d = timestamp, c/C = required/possibly empty calendar date, x = child object.
-- Prefix ? permits an absent property, not explicit JSON null.
create function partner_hub.flow_shape_field_valid(value json, rule text)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare spec text := rule; parts text[]; source text;
begin
  if rule is null then return false; end if;
  if left(spec,1)='?' then if value is null then return true; end if; spec:=substr(spec,2); end if;
  if value is null or json_typeof(value)='null' then return false; end if;
  parts:=string_to_array(spec,':');
  if parts[1]='x' then return true; end if;
  if parts[1]='b' then return json_typeof(value)='boolean'; end if;
  if parts[1]='i' then return partner_hub.flow_integer_valid(value,parts[2]::numeric,parts[3]::numeric); end if;
  if json_typeof(value)<>'string' then return false; end if;
  source:=value #>> '{}';
  case parts[1]
    when 't' then return length(source)<=parts[2]::integer;
    when 'n' then return length(source)<=parts[2]::integer and length(partner_hub.flow_js_trim(source))>0;
    when 'e' then return partner_hub.flow_text_valid(value,1,parts[2]::integer);
    when 'd' then return partner_hub.flow_shape_time(value) is not null;
    when 'c' then return partner_hub.flow_date_only_valid(source);
    when 'C' then return source='' or partner_hub.flow_date_only_valid(source);
    when 'v' then return source=any(string_to_array(parts[2],','));
    else return false;
  end case;
exception when data_exception then return false;
end;
$$;

create function partner_hub.flow_shape_object_valid(value json, kind text)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare rules jsonb := partner_hub.flow_shape_rules()->kind; field record;
begin
  if rules is null or json_typeof(value) is distinct from 'object' then return false; end if;
  if exists(select 1 from json_each(value) property where not rules ? property.key) then return false; end if;
  for field in select * from jsonb_each_text(rules) loop
    if not partner_hub.flow_shape_field_valid(value->field.key,field.value) then return false; end if;
  end loop;
  return true;
exception when data_exception then return false;
end;
$$;

create function partner_hub.flow_stored_file_shape_valid(value json)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare name text; extension text; purpose text; mime text; maximum bigint;
begin
  if not partner_hub.flow_shape_object_valid(value,'file') then return false; end if;
  name:=value->>'name'; purpose:=value->>'purpose'; extension:=lower(regexp_replace(name,'^.*\.',''));
  if length(name)>180 or name<>normalize(name,NFC) or name<>partner_hub.flow_js_trim(name)
    or name ~ E'[\\\\/\\x01-\\x1f\\x7f]' or value->>'key' is distinct from 'consulting-flow/'||(value->>'id') then return false; end if;
  if not coalesce(case purpose
    when 'source' then extension=any(array['pdf','jpg','jpeg','png','txt'])
    when 'source_archived' then extension=any(array['pdf','jpg','jpeg','png','txt'])
    when 'report' then extension=any(array['pdf','docx','txt','md','pptx'])
    when 'recording' then extension=any(array['mp3','m4a','wav','docx','txt'])
    when 'transcript' then extension=any(array['docx','txt'])
    when 'requested_document' then extension=any(array['pdf','jpg','jpeg','png','docx','xlsx','txt'])
    when 'signed_contract' then extension=any(array['pdf','jpg','jpeg','png'])
    else false end,false) then return false; end if;
  mime:=case extension when 'pdf' then 'application/pdf' when 'jpg' then 'image/jpeg' when 'jpeg' then 'image/jpeg'
    when 'png' then 'image/png' when 'txt' then 'text/plain' when 'md' then 'text/markdown'
    when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    when 'pptx' then 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    when 'xlsx' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    when 'mp3' then 'audio/mpeg' when 'm4a' then 'audio/mp4' when 'wav' then 'audio/wav' end;
  maximum:=case when purpose in ('source','source_archived') then 8388608
    when purpose='transcript' or (purpose='recording' and extension in ('docx','txt')) then 5242880 else 26214400 end;
  return value->>'contentType'=mime and (value->>'size')::bigint<=maximum;
exception when data_exception then return false;
end;
$$;

create function partner_hub.flow_job_shape_valid(value json)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare status text; started timestamptz; completed timestamptz; created timestamptz; observed timestamptz; prior timestamptz; item json;
begin
  if not partner_hub.flow_shape_object_valid(value,'job') or value->>'stage' not in ('1','4') then return false; end if;
  status:=value->>'status'; started:=partner_hub.flow_shape_time(value->'startedAt'); completed:=partner_hub.flow_shape_time(value->'completedAt');
  created:=partner_hub.flow_shape_time(value->'createdAt');
  if not (case status
    when 'queued' then started is null and completed is null and value->'reportId' is null
    when 'processing' then started is not null and completed is null and value->'reportId' is null
    when 'complete' then started is not null and completed is not null and value->'reportId' is not null
    when 'failed' then started is not null and completed is null and value->'reportId' is null
    when 'blocked' then completed is null and value->'reportId' is null
    else false end) or started<created or completed<started then return false; end if;
  if value->'evidence' is not null then
    item:=value->'evidence'; observed:=partner_hub.flow_shape_time(item->'observedAt');
    if status<>'complete' or not partner_hub.flow_shape_object_valid(item,'jobEvidence')
      or observed<started or observed>completed then return false; end if;
  end if;
  if value->'failureEvidence' is not null then
    item:=value->'failureEvidence'; observed:=partner_hub.flow_shape_time(item->'observedAt');
    if status<>'failed' or not partner_hub.flow_shape_object_valid(item,'jobFailureEvidence') or observed<started then return false; end if;
  end if;
  if value->'failureEvidenceHistory' is not null then
    if json_typeof(value->'failureEvidenceHistory') is distinct from 'array' then return false; end if;
    if json_array_length(value->'failureEvidenceHistory') not between 1 and 20 then return false; end if;
    for item in select * from json_array_elements(value->'failureEvidenceHistory') loop
      if not partner_hub.flow_shape_object_valid(item,'jobFailureEvidence') then return false; end if;
      observed:=partner_hub.flow_shape_time(item->'observedAt');
      if observed<created or observed<prior then return false; end if;
      prior:=observed;
    end loop;
  end if;
  return true;
exception when data_exception then return false;
end;
$$;

create function partner_hub.flow_domain_valid(value json)
returns boolean language plpgsql immutable set search_path=pg_catalog set timezone='UTC' as $$
declare collection text; kind text; item json; field text; id text; maps jsonb:='{}'; lookup jsonb; flow jsonb;
  decision jsonb; contract jsonb; aftercare jsonb; job jsonb; evidence jsonb; evidence_set jsonb; audit jsonb;
  prior timestamptz; moment timestamptz; updated timestamptz; execution timestamptz;
  status text; source text; observed timestamptz; paid numeric:=0; complete boolean; history_ids text[];
begin
  if not partner_hub.flow_json_unique_keys(value) or not partner_hub.flow_shape_object_valid(value,'root') then return false; end if;
  foreach collection in array array['reports','files','meetings','recordings','requests','payments','jobs','audit'] loop
    if json_typeof(value->collection) is distinct from 'array' then return false; end if;
    if json_array_length(value->collection)>(case when collection in ('reports','files','audit') then 4000 else 2000 end) then return false; end if;
    kind:=case collection when 'reports' then 'report' when 'files' then 'file' when 'meetings' then 'meeting'
      when 'recordings' then 'recording' when 'requests' then 'request' when 'payments' then 'payment' when 'jobs' then 'job' else 'audit' end;
    lookup:='{}';
    for item in select * from json_array_elements(value->collection) loop
      if not partner_hub.flow_shape_object_valid(item,kind) then return false; end if;
      id:=item->>'id'; if lookup ? id then return false; end if;
      lookup:=lookup||jsonb_build_object(id,item::jsonb);
      if kind='file' and not partner_hub.flow_stored_file_shape_valid(item) then return false; end if;
      if kind='job' and not partner_hub.flow_job_shape_valid(item) then return false; end if;
      if kind='meeting' then
        if partner_hub.flow_shape_time(item->'endsAt')<=partner_hub.flow_shape_time(item->'startsAt') then return false; end if;
        if item->>'status'='completed' then
          if item->'completedAt' is null or partner_hub.flow_shape_time(item->'completedAt')<partner_hub.flow_shape_time(item->'startsAt') then return false; end if;
        elsif item->'completedAt' is not null then return false; end if;
      end if;
      if kind='request' then
        status:=item->>'status';
        if not (case status
          when 'requested' then item->'fileId' is null and item->'receivedAt' is null and item->'reviewedAt' is null and item->'verifiedAt' is null
          when 'received' then item->'fileId' is not null and item->'receivedAt' is not null and item->'reviewedAt' is null and item->'verifiedAt' is null
          when 'needs_fix' then item->'fileId' is not null and item->'receivedAt' is not null and item->'reviewedAt' is not null and item->'verifiedAt' is null
          when 'verified' then item->'fileId' is not null and item->'receivedAt' is not null and item->'reviewedAt' is not null and item->'verifiedAt' is not null
          else false end) then return false; end if;
        prior:=null;
        foreach field in array array['createdAt','sentAt','receivedAt','reviewedAt','verifiedAt'] loop
          if item->field is not null then
            moment:=partner_hub.flow_shape_time(item->field); if moment<prior then return false; end if; prior:=moment;
          end if;
        end loop;
      end if;
    end loop;
    maps:=maps||jsonb_build_object(collection,lookup);
  end loop;
  foreach kind in array array['analysis','ai','decision','contract','aftercare'] loop
    if value->kind is not null and not partner_hub.flow_shape_object_valid(value->kind,kind) then return false; end if;
  end loop;
  if value->'decision' is not null then
    if json_typeof(value#>'{decision,solutions}') is distinct from 'array' then return false; end if;
    if json_array_length(value#>'{decision,solutions}')>12 or exists(select 1 from json_array_elements(value#>'{decision,solutions}') entry
      where not partner_hub.flow_shape_field_valid(entry.value,'n:80')) then return false; end if;
  end if;
  if json_typeof(value->'commandIds') is distinct from 'array' then return false; end if;
  if json_array_length(value->'commandIds')>2000 or exists(select 1 from json_array_elements(value->'commandIds') entry
      where not partner_hub.flow_shape_field_valid(entry.value,'n:200'))
    or (select count(*)<>count(distinct entry.value#>>'{}') from json_array_elements(value->'commandIds') entry) then return false; end if;
  if value->'commandReceipts' is not null then
    if json_typeof(value->'commandReceipts') is distinct from 'object' then return false; end if;
    if (select count(*) from json_each(value->'commandReceipts'))>2000 then return false; end if;
    for field,item in select * from json_each(value->'commandReceipts') loop
      if not partner_hub.flow_shape_field_valid(to_json(field),'n:200') or not partner_hub.flow_shape_object_valid(item,'receipt')
        or not exists(select 1 from json_array_elements(value->'commandIds') entry where entry.value#>>'{}'=field) then return false; end if;
    end loop;
  end if;
  flow:=value::jsonb; decision:=flow->'decision'; contract:=flow->'contract'; aftercare:=flow->'aftercare';
  source:=flow#>>'{analysis,reportId}';
  if source<>'' and maps#>>array['reports',source,'stage'] is distinct from '1' then return false; end if;
  for item in select * from json_array_elements(value->'reports') loop
    source:=item->>'sourceReportId'; if source is not null and maps#>>array['reports',source,'stage'] is distinct from '1' then return false; end if;
    source:=item->>'sourceRecordingId'; if source is not null and not (maps->'recordings') ? source then return false; end if;
    source:=item->>'decisionId'; if source is not null and decision->>'id' is distinct from source then return false; end if;
    source:=item->>'fileId'; if source is not null and not (maps->'files') ? source then return false; end if;
  end loop;
  if decision is not null and maps#>>array['reports',decision->>'reportId','stage'] is distinct from '4' then return false; end if;
  if contract is not null and (maps#>>array['meetings',contract->>'meetingId','kind'] is distinct from 'contract'
    or maps#>>array['meetings',contract->>'meetingId','status'] is distinct from 'completed'
    or maps#>>array['reports',contract->>'reportId','stage'] is distinct from '6'
    or maps#>>array['files',contract->>'signedFileId','purpose'] is distinct from 'signed_contract') then return false; end if;
  for item in select * from json_array_elements(value->'recordings') loop
    if not (maps->'meetings') ? (item->>'meetingId') then return false; end if;
    foreach field in array array['fileId','transcriptFileId','audioFileId'] loop
      source:=item->>field; if source is not null and not (maps->'files') ? source then return false; end if;
    end loop;
  end loop;
  for item in select * from json_array_elements(value->'requests') loop
    source:=item->>'fileId'; if source is not null and not (maps->'files') ? source then return false; end if;
  end loop;
  updated:=partner_hub.flow_shape_time(value->'updatedAt');
  for job in select * from jsonb_array_elements(flow->'jobs') loop
    source:=job->>'sourceRecordingId'; if source is not null and not (maps->'recordings') ? source then return false; end if;
    source:=job->>'sourceReportId'; if source is not null and maps#>>array['reports',source,'stage'] is distinct from '1' then return false; end if;
    source:=job->>'reportId'; if source is not null and maps#>>array['reports',source,'stage'] is distinct from job->>'stage' then return false; end if;
    evidence_set:=coalesce(job->'failureEvidenceHistory','[]');
    if job->'evidence' is not null then evidence_set:=evidence_set||jsonb_build_array(job->'evidence'); end if;
    if job->'failureEvidence' is not null then evidence_set:=evidence_set||jsonb_build_array(job->'failureEvidence'); end if;
    history_ids:=array[]::text[];
    for evidence in select * from jsonb_array_elements(evidence_set) loop
      id:=evidence->>'auditId'; if id=any(history_ids) then return false; end if; history_ids:=array_append(history_ids,id);
      observed:=partner_hub.flow_shape_time((evidence->'observedAt')::json); audit:=maps#>array['audit',id];
      moment:=partner_hub.flow_shape_time((audit->'at')::json);
      if updated is null or audit is null or id is distinct from (job->>'id')||'-'||(audit->>'at')
        or audit->>'actor' is distinct from '보고서 자동생성' or audit->>'action' is distinct from 'ai_result'
        or moment<observed or moment>updated or observed>updated
        or (evidence=job->'evidence' and audit->>'at' is distinct from job->>'completedAt') then return false; end if;
    end loop;
  end loop;
  for item in select * from json_array_elements(value->'payments') loop
    if contract is null or item->>'receivedAt'>to_char((partner_hub.flow_shape_time(item->'recordedAt') at time zone 'UTC')+interval '9 hours','YYYY-MM-DD') then return false; end if;
    paid:=paid+(item->>'amountWon')::numeric;
  end loop;
  complete:=contract is not null and paid>=(contract->>'expectedDepositWon')::numeric;
  execution:=partner_hub.flow_shape_time(value->'executionStartedAt');
  if (execution is not null) is distinct from complete then return false; end if;
  if aftercare is not null and (execution is null or partner_hub.flow_shape_time((aftercare->'at')::json)<execution) then return false; end if;
  return true;
exception when data_exception then return false;
end;
$$;

revoke all on function partner_hub.flow_shape_rules(),partner_hub.flow_shape_time(json),partner_hub.flow_shape_field_valid(json,text),
  partner_hub.flow_shape_object_valid(json,text),partner_hub.flow_stored_file_shape_valid(json),partner_hub.flow_job_shape_valid(json),
  partner_hub.flow_domain_valid(json) from public,anon,authenticated;
grant execute on function partner_hub.flow_shape_rules(),partner_hub.flow_shape_time(json),partner_hub.flow_shape_field_valid(json,text),
  partner_hub.flow_shape_object_valid(json,text),partner_hub.flow_stored_file_shape_valid(json),partner_hub.flow_job_shape_valid(json),
  partner_hub.flow_domain_valid(json) to service_role;

commit;
