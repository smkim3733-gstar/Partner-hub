begin;

-- PostgreSQL text cannot contain U+0000 or malformed UTF-8. Retain the Sites
-- policy for other non-display controls, preserving tab, CR and LF.
create function partner_hub.valid_ai_text(value json, maximum integer, allow_empty boolean default false)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare content text;
begin
  if json_typeof(value) is distinct from 'string' then return false; end if;
  content := value #>> '{}';
  return content = btrim(content) and (allow_empty or content <> '')
    and length(content) <= maximum
    and content !~ U&'[\0001-\0008\000B\000C\000E-\001F\007F-\009F\FFFD]';
exception when data_exception then return false;
end;
$$;

create function partner_hub.valid_ai_object_keys(value json, expected text[])
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
begin
  if json_typeof(value) is distinct from 'object' then return false; end if;
  -- json (not jsonb) deliberately preserves duplicate keys for rejection.
  return (select count(*) = cardinality(expected) and count(distinct key) = cardinality(expected)
    and bool_and(key = any(expected)) from json_each(value));
end;
$$;

create function partner_hub.valid_ai_fingerprint(value json)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select coalesce(json_typeof(value -> '_requestFingerprint') = 'string'
    and (value ->> '_requestFingerprint') ~ '^[0-9a-f]{64}$', false);
$$;

create function partner_hub.valid_ai_pending(payload text)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare value json;
begin
  if payload is null or octet_length(payload) > 256 then return false; end if;
  value := payload::json;
  return partner_hub.valid_ai_object_keys(value, array['_requestFingerprint'])
    and partner_hub.valid_ai_fingerprint(value);
exception when data_exception then return false;
end;
$$;

create function partner_hub.valid_ai_completed(payload text)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare value json; field_name text; candidate json;
begin
  if payload is null or octet_length(payload) > 320000 then return false; end if;
  value := payload::json;
  if not partner_hub.valid_ai_object_keys(value, array['_requestFingerprint', '_providerRequestId',
    '_providerModel', '_providerMessageId', 'companyOverview', 'confirmedStrengths', 'mainRisks',
    'solutionCandidates', 'verificationQuestions', 'missingDocuments', 'complianceNotes', 'nextAction'])
    or not partner_hub.valid_ai_fingerprint(value)
    or not partner_hub.valid_ai_text(value -> '_providerRequestId', 200)
    or not partner_hub.valid_ai_text(value -> '_providerModel', 200)
    or not partner_hub.valid_ai_text(value -> '_providerMessageId', 512)
    or not partner_hub.valid_ai_text(value -> 'companyOverview', 12000)
    or not partner_hub.valid_ai_text(value -> 'nextAction', 12000) then return false; end if;
  foreach field_name in array array['confirmedStrengths', 'mainRisks', 'verificationQuestions',
    'missingDocuments', 'complianceNotes'] loop
    if json_typeof(value -> field_name) is distinct from 'array' then return false; end if;
    if json_array_length(value -> field_name) > 20
      or exists (select 1 from json_array_elements(value -> field_name) item
        where not partner_hub.valid_ai_text(item.value, 4000)) then return false; end if;
  end loop;
  if json_typeof(value -> 'solutionCandidates') is distinct from 'array' then return false; end if;
  if json_array_length(value -> 'solutionCandidates') > 10 then return false; end if;
  for candidate in select * from json_array_elements(value -> 'solutionCandidates') loop
    if not partner_hub.valid_ai_object_keys(candidate, array['solution', 'basis', 'condition'])
      or not partner_hub.valid_ai_text(candidate -> 'solution', 4000)
      or not partner_hub.valid_ai_text(candidate -> 'basis', 4000)
      or not partner_hub.valid_ai_text(candidate -> 'condition', 4000, true) then return false; end if;
  end loop;
  return true;
exception when data_exception then return false;
end;
$$;

create table partner_hub.ai_diagnosis_runs (
  id text primary key, case_id text not null, company text not null,
  stage text not null, status text not null, instruction_version text not null,
  model text not null, result_json text not null,
  input_tokens bigint not null default 0, output_tokens bigint not null default 0,
  created_by_user_id text not null, created_at text not null
);
create index ai_diagnosis_runs_case_idx on partner_hub.ai_diagnosis_runs(case_id, created_at);
create unique index ai_diagnosis_runs_pending_case_idx on partner_hub.ai_diagnosis_runs(case_id)
  where status = '생성중';

create function partner_hub.guard_ai_diagnosis_run()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'AI diagnosis run is durable' using errcode = '23514';
  elsif TG_OP = 'INSERT' then
    if NEW.id !~ '^[A-Za-z0-9_-]{16,100}$' or NEW.stage <> 'Step 0' or NEW.status <> '생성중'
      or not partner_hub.valid_ai_text(to_json(NEW.case_id), 120)
      or not partner_hub.valid_ai_text(to_json(NEW.company), 100)
      or not partner_hub.valid_ai_text(to_json(NEW.instruction_version), 100)
      or not partner_hub.valid_ai_text(to_json(NEW.model), 200)
      or not partner_hub.valid_ai_text(to_json(NEW.created_by_user_id), 256)
      or not partner_hub.valid_utc_millisecond(NEW.created_at)
      or NEW.input_tokens <> 0 or NEW.output_tokens <> 0
      or not partner_hub.valid_ai_pending(NEW.result_json) then
      raise exception 'AI diagnosis run insert envelope is invalid' using errcode = '23514';
    end if;
  else
    if (NEW.id, NEW.case_id, NEW.company, NEW.stage, NEW.instruction_version, NEW.model, NEW.created_by_user_id)
      is distinct from
      (OLD.id, OLD.case_id, OLD.company, OLD.stage, OLD.instruction_version, OLD.model, OLD.created_by_user_id) then
      raise exception 'AI diagnosis run identity is immutable' using errcode = '23514';
    end if;
    if OLD.status = '생성중' and NEW.status = '생성실패'
      and (NEW.result_json, NEW.input_tokens, NEW.output_tokens, NEW.created_at)
        is not distinct from (OLD.result_json, OLD.input_tokens, OLD.output_tokens, OLD.created_at) then
      return NEW;
    end if;
    if OLD.status = '생성중' and NEW.status = '대표 검토 대기'
      and partner_hub.valid_ai_completed(NEW.result_json)
      and partner_hub.valid_utc_millisecond(NEW.created_at) and NEW.created_at >= OLD.created_at
      and NEW.input_tokens between 1 and 9007199254740991 and NEW.output_tokens between 1 and 4000 then
      if (NEW.result_json::json ->> '_requestFingerprint') = (OLD.result_json::json ->> '_requestFingerprint') then
        return NEW;
      end if;
    end if;
    raise exception 'AI diagnosis run transition is invalid' using errcode = '23514';
  end if;
  return NEW;
end;
$$;
create trigger ai_diagnosis_runs_guard before insert or update or delete on partner_hub.ai_diagnosis_runs
for each row execute function partner_hub.guard_ai_diagnosis_run();

alter table partner_hub.ai_diagnosis_runs enable row level security;
revoke all on partner_hub.ai_diagnosis_runs from public, anon, authenticated;
grant select, insert, update on partner_hub.ai_diagnosis_runs to service_role;
revoke all on function partner_hub.valid_ai_text(json, integer, boolean), partner_hub.valid_ai_object_keys(json, text[]),
  partner_hub.valid_ai_fingerprint(json), partner_hub.valid_ai_pending(text), partner_hub.valid_ai_completed(text),
  partner_hub.guard_ai_diagnosis_run() from public, anon, authenticated;
grant execute on function partner_hub.valid_ai_text(json, integer, boolean), partner_hub.valid_ai_object_keys(json, text[]),
  partner_hub.valid_ai_fingerprint(json), partner_hub.valid_ai_pending(text), partner_hub.valid_ai_completed(text)
  to service_role;

create function partner_hub.assert_ai_diagnosis_schema()
returns integer language plpgsql set search_path = pg_catalog as $$
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'partner_hub' and c.relname = 'ai_diagnosis_runs' and c.relkind = 'r' and c.relrowsecurity)
    or not exists (select 1 from pg_trigger where tgrelid = 'partner_hub.ai_diagnosis_runs'::regclass
      and tgname = 'ai_diagnosis_runs_guard' and tgenabled = 'O')
    or not exists (select 1 from pg_index where indexrelid = 'partner_hub.ai_diagnosis_runs_pending_case_idx'::regclass
      and indrelid = 'partner_hub.ai_diagnosis_runs'::regclass and indisunique and indisvalid and indisready
      and indpred is not null) then
    raise exception 'SUPABASE_AI_DIAGNOSIS_SCHEMA_NOT_READY';
  end if;
  return 1;
end;
$$;
revoke all on function partner_hub.assert_ai_diagnosis_schema() from public, anon, authenticated;
grant execute on function partner_hub.assert_ai_diagnosis_schema() to service_role;

commit;
