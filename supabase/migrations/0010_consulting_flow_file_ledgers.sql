begin;

-- Independent durable ledgers, intentionally without cascading foreign keys:
-- legacy/orphan evidence must remain inspectable. No data backfill is performed.
-- The complete consulting_flows root is a later migration. Functions referring
-- to that root are PL/pgSQL and fail closed until it exists and is fully guarded.
create table partner_hub.consulting_flow_file_owners (
  file_id text primary key, case_id text not null, storage_key text not null unique, created_at text not null
);
create index consulting_flow_file_owners_case_idx on partner_hub.consulting_flow_file_owners(case_id);
create table partner_hub.consulting_flow_file_metadata (
  file_id text primary key, original_name text not null, content_type text not null,
  size_bytes bigint not null, purpose text not null, intake_file_id text,
  intake_source_hash text, source_reviewed_at text, source_reviewed_by text
);
create table partner_hub.consulting_flow_file_object_integrity (
  file_id text primary key, validation_mode text not null check (validation_mode in ('metadata','etag')),
  r2_etag text, r2_content_type text not null,
  check ((validation_mode='metadata' and r2_etag is null) or
    (validation_mode='etag' and r2_etag is not null and length(r2_etag) between 1 and 256))
);
create table partner_hub.consulting_flow_file_object_checksums (
  file_id text primary key, sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$')
);

-- PostgreSQL can insert the two slots concurrently. A shared immutable row
-- serializes their fingerprint even outside the app's SERIALIZABLE transaction.
-- A predicate-only trigger would allow write skew at READ COMMITTED.
create table partner_hub.consulting_flow_upload_command_keys (
  case_id text not null, actor_key text not null, command_id text not null, fingerprint text not null,
  primary key(case_id,actor_key,command_id),
  check (case_id ~ '^[A-Za-z0-9_-]{1,120}$'),
  check (actor_key = 'admin:primary' or actor_key ~ '^member:[A-Za-z0-9_-]{1,120}$'),
  check (command_id ~ '^[A-Za-z0-9_-]{8,100}$'), check (fingerprint ~ '^[0-9a-f]{64}$')
);
create table partner_hub.consulting_flow_upload_requests (
  case_id text not null, actor_key text not null, command_id text not null,
  slot text not null check (slot in ('file','audio')), fingerprint text not null,
  file_id text not null unique, storage_key text not null unique,
  original_name text not null, content_type text not null, size_bytes bigint not null,
  purpose text not null, intake_file_id text, intake_source_hash text,
  source_reviewed_at text, source_reviewed_by text, created_at text not null,
  status text not null check (status in ('pending','ready')),
  primary key(case_id,actor_key,command_id,slot),
  check (case_id ~ '^[A-Za-z0-9_-]{1,120}$'),
  check (actor_key = 'admin:primary' or actor_key ~ '^member:[A-Za-z0-9_-]{1,120}$'),
  check (command_id ~ '^[A-Za-z0-9_-]{8,100}$'), check (fingerprint ~ '^[0-9a-f]{64}$'),
  check (file_id ~ '^[A-Za-z0-9_-]{1,200}$'), check (storage_key = 'consulting-flow/' || file_id),
  check (length(original_name) between 1 and 300), check (length(content_type) between 1 and 200),
  check (size_bytes between 1 and 26214400),
  check (purpose in ('source','report','recording','transcript','requested_document','signed_contract')),
  check (slot <> 'audio' or purpose = 'recording'),
  check ((intake_file_id is null and intake_source_hash is null and source_reviewed_at is null and source_reviewed_by is null)
    or (purpose = 'source' and intake_file_id is not null and intake_source_hash is not null
      and source_reviewed_at is not null and source_reviewed_by is not null
      and length(intake_file_id) between 1 and 120 and intake_source_hash ~ '^[0-9a-f]{64}$'
      and partner_hub.valid_utc_millisecond(source_reviewed_at) and length(source_reviewed_by) between 1 and 200)),
  check (partner_hub.valid_utc_millisecond(created_at))
);
create index consulting_flow_upload_requests_pending_idx
  on partner_hub.consulting_flow_upload_requests(status,created_at,file_id) where status='pending';
create unique index consulting_flow_upload_requests_pending_fingerprint_slot_idx
  on partner_hub.consulting_flow_upload_requests(case_id,actor_key,fingerprint,slot) where status='pending';
create table partner_hub.consulting_flow_upload_completions (
  file_id text primary key check (file_id ~ '^[A-Za-z0-9_-]{1,200}$'),
  command_id text not null check (command_id ~ '^[A-Za-z0-9_-]{8,100}$')
);

create function partner_hub.guard_flow_file_immutable()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  raise exception 'FLOW file ledger is immutable and durable' using errcode='23514';
end;
$$;
create trigger consulting_flow_file_owners_guard before update or delete on partner_hub.consulting_flow_file_owners
  for each row execute function partner_hub.guard_flow_file_immutable();
create trigger consulting_flow_file_object_integrity_guard before update or delete on partner_hub.consulting_flow_file_object_integrity
  for each row execute function partner_hub.guard_flow_file_immutable();
create trigger consulting_flow_file_object_checksums_guard before update or delete on partner_hub.consulting_flow_file_object_checksums
  for each row execute function partner_hub.guard_flow_file_immutable();

create function partner_hub.guard_flow_file_metadata()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if TG_OP='DELETE' then raise exception 'FLOW file metadata is durable' using errcode='23514'; end if;
  if (to_jsonb(NEW)-'purpose') is distinct from (to_jsonb(OLD)-'purpose')
    or not (NEW.purpose=OLD.purpose or (OLD.purpose='source' and NEW.purpose='source_archived')) then
    raise exception 'FLOW file metadata transition is invalid' using errcode='23514';
  end if;
  return NEW;
end;
$$;
create trigger consulting_flow_file_metadata_guard before update or delete on partner_hub.consulting_flow_file_metadata
  for each row execute function partner_hub.guard_flow_file_metadata();

create function partner_hub.guard_flow_upload_command_key()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if TG_OP='DELETE' then raise exception 'FLOW upload command key is durable' using errcode='23514'; end if;
  -- Exact no-op only: ON CONFLICT below locks/checks the current row version.
  if NEW is distinct from OLD then raise exception 'FLOW upload fingerprint is immutable' using errcode='23514'; end if;
  return NEW;
end;
$$;
create trigger consulting_flow_upload_command_keys_guard before update or delete on partner_hub.consulting_flow_upload_command_keys
  for each row execute function partner_hub.guard_flow_upload_command_key();

create function partner_hub.flow_reserved_file_matches(file json, reservation partner_hub.consulting_flow_upload_requests, owner_created_at text)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare field_name text; expected text;
begin
  if json_typeof(file) is distinct from 'object' or not partner_hub.flow_json_unique_keys(file) then return false; end if;
  foreach field_name in array array['id','key','name','contentType','purpose','createdAt'] loop
    expected := case field_name when 'id' then reservation.file_id when 'key' then reservation.storage_key
      when 'name' then reservation.original_name when 'contentType' then reservation.content_type
      when 'purpose' then reservation.purpose else owner_created_at end;
    if json_typeof(file -> field_name) is distinct from 'string' or file ->> field_name is distinct from expected then return false; end if;
  end loop;
  if json_typeof(file -> 'size') is distinct from 'number' or file ->> 'size' is distinct from reservation.size_bytes::text then return false; end if;
  foreach field_name in array array['intakeFileId','intakeSourceHash','sourceReviewedAt','sourceReviewedBy'] loop
    expected := case field_name when 'intakeFileId' then reservation.intake_file_id when 'intakeSourceHash' then reservation.intake_source_hash
      when 'sourceReviewedAt' then reservation.source_reviewed_at else reservation.source_reviewed_by end;
    if expected is null then
      if file -> field_name is not null then return false; end if;
    elsif json_typeof(file -> field_name) is distinct from 'string' or file ->> field_name is distinct from expected then return false;
    end if;
  end loop;
  return true;
exception when data_exception then return false;
end;
$$;

create function partner_hub.guard_flow_upload_request()
returns trigger language plpgsql set search_path=pg_catalog as $$
declare payload json; owner_time text;
begin
  if TG_OP='DELETE' then raise exception 'FLOW upload reservation is durable' using errcode='23514'; end if;
  if TG_OP='INSERT' then
    if NEW.status <> 'pending' then raise exception 'FLOW upload must start pending' using errcode='23514'; end if;
    insert into partner_hub.consulting_flow_upload_command_keys(case_id,actor_key,command_id,fingerprint)
      values(NEW.case_id,NEW.actor_key,NEW.command_id,NEW.fingerprint)
      on conflict(case_id,actor_key,command_id) do update set fingerprint=excluded.fingerprint;
    return NEW;
  end if;
  if (to_jsonb(NEW)-'status') is distinct from (to_jsonb(OLD)-'status')
    or not (NEW.status=OLD.status or (OLD.status='pending' and NEW.status='ready')) then
    raise exception 'FLOW upload reservation transition is invalid' using errcode='23514';
  end if;
  if OLD.status='pending' and NEW.status='ready' then
    if not exists (select 1 from partner_hub.consulting_flow_upload_completions where file_id=NEW.file_id) then
      raise exception 'FLOW upload completion is missing' using errcode='23514';
    end if;
    select owner.created_at into owner_time from partner_hub.consulting_flow_file_owners owner
      join partner_hub.consulting_flow_file_metadata metadata on metadata.file_id=owner.file_id
      join partner_hub.consulting_flow_file_object_integrity integrity on integrity.file_id=owner.file_id
      join partner_hub.consulting_flow_file_object_checksums checksum on checksum.file_id=owner.file_id
      where owner.file_id=NEW.file_id and owner.case_id=NEW.case_id and owner.storage_key=NEW.storage_key
        and metadata.original_name=NEW.original_name and metadata.content_type=NEW.content_type and metadata.size_bytes=NEW.size_bytes
        and metadata.purpose=NEW.purpose and metadata.intake_file_id is not distinct from NEW.intake_file_id
        and metadata.intake_source_hash is not distinct from NEW.intake_source_hash
        and metadata.source_reviewed_at is not distinct from NEW.source_reviewed_at
        and metadata.source_reviewed_by is not distinct from NEW.source_reviewed_by
        and integrity.validation_mode='etag' and integrity.r2_etag is not null and integrity.r2_content_type=NEW.content_type
        and checksum.sha256 ~ '^[0-9a-f]{64}$';
    if not found then raise exception 'FLOW upload ledgers do not match' using errcode='23514'; end if;
    select flow.payload::json into payload from partner_hub.consulting_flows flow where flow.case_id=NEW.case_id;
    if not found or json_typeof(payload -> 'files') is distinct from 'array' or not partner_hub.flow_json_unique_keys(payload) then
      raise exception 'FLOW upload payload is unavailable' using errcode='23514';
    end if;
    if (select count(*) from json_array_elements(payload -> 'files') file where file.value ->> 'id'=NEW.file_id) <> 1
      or not exists (select 1 from json_array_elements(payload -> 'files') file
        where partner_hub.flow_reserved_file_matches(file.value,NEW,owner_time)) then
      raise exception 'FLOW upload file is not committed' using errcode='23514';
    end if;
  end if;
  return NEW;
end;
$$;
create trigger consulting_flow_upload_requests_guard before insert or update or delete on partner_hub.consulting_flow_upload_requests
  for each row execute function partner_hub.guard_flow_upload_request();

create function partner_hub.guard_flow_upload_completion()
returns trigger language plpgsql set search_path=pg_catalog as $$
declare reservation partner_hub.consulting_flow_upload_requests; sibling partner_hub.consulting_flow_upload_requests;
  payload json; receipt json; file_slot text; audio_slot text;
begin
  if TG_OP <> 'INSERT' then raise exception 'FLOW completion is immutable and durable' using errcode='23514'; end if;
  select * into reservation from partner_hub.consulting_flow_upload_requests where file_id=NEW.file_id and status='pending';
  if not found then raise exception 'FLOW pending reservation is missing' using errcode='23514'; end if;
  select flow.payload::json into payload from partner_hub.consulting_flows flow where flow.case_id=reservation.case_id;
  if not found or not partner_hub.flow_json_unique_keys(payload) or json_typeof(payload -> 'commandIds') is distinct from 'array'
    or json_typeof(payload -> 'commandReceipts') is distinct from 'object' then
    raise exception 'FLOW completion payload is unavailable' using errcode='23514';
  end if;
  receipt := payload -> 'commandReceipts' -> NEW.command_id;
  if (select count(*) from json_array_elements(payload -> 'commandIds') command
      where json_typeof(command.value)='string' and command.value #>> '{}' = NEW.command_id) <> 1
    or json_typeof(receipt) is distinct from 'object' or json_typeof(receipt -> 'actorKey') is distinct from 'string'
    or json_typeof(receipt -> 'fingerprint') is distinct from 'string'
    or receipt ->> 'actorKey' is distinct from reservation.actor_key or receipt ->> 'fingerprint' is distinct from reservation.fingerprint then
    raise exception 'FLOW completion command proof is invalid' using errcode='23514';
  end if;
  select * into sibling from partner_hub.consulting_flow_upload_requests other
    where other.case_id=reservation.case_id and other.actor_key=reservation.actor_key
      and other.command_id=reservation.command_id and other.fingerprint=reservation.fingerprint and other.slot<>reservation.slot;
  if reservation.slot='audio' or found then
    if json_typeof(payload -> 'recordings') is distinct from 'array' then
      raise exception 'FLOW recording proof is missing' using errcode='23514';
    end if;
    file_slot := case when reservation.slot='file' then reservation.file_id else sibling.file_id end;
    audio_slot := case when reservation.slot='audio' then reservation.file_id else sibling.file_id end;
    if not exists (select 1 from json_array_elements(payload -> 'recordings') recording
      where json_typeof(recording.value -> 'id')='string' and recording.value ->> 'id'=NEW.command_id||'-recording'
        and json_typeof(recording.value -> 'audioFileId')='string' and recording.value ->> 'audioFileId'=audio_slot
        and (sibling.file_id is null or (json_typeof(recording.value -> 'fileId')='string' and recording.value ->> 'fileId'=file_slot))) then
      raise exception 'FLOW recording slots do not match' using errcode='23514';
    end if;
  end if;
  return NEW;
end;
$$;
create trigger consulting_flow_upload_completions_guard before insert or update or delete on partner_hub.consulting_flow_upload_completions
  for each row execute function partner_hub.guard_flow_upload_completion();

do $$
declare table_name text;
begin
  foreach table_name in array array['consulting_flow_file_owners','consulting_flow_file_metadata',
    'consulting_flow_file_object_integrity','consulting_flow_file_object_checksums','consulting_flow_upload_command_keys',
    'consulting_flow_upload_requests','consulting_flow_upload_completions'] loop
    execute format('alter table partner_hub.%I enable row level security',table_name);
    execute format('revoke all on partner_hub.%I from public,anon,authenticated',table_name);
    execute format('grant select,insert,update on partner_hub.%I to service_role',table_name);
  end loop;
end;
$$;

-- Ledger readiness only, never whole FLOW/domain or HTTP readiness. As with
-- existing guards this checks catalog prerequisites, not a full schema hash.
create function partner_hub.assert_flow_file_ledger_schema()
returns integer language plpgsql set search_path=pg_catalog as $$
declare table_name text;
begin
  foreach table_name in array array['consulting_flow_file_owners','consulting_flow_file_metadata',
    'consulting_flow_file_object_integrity','consulting_flow_file_object_checksums','consulting_flow_upload_command_keys',
    'consulting_flow_upload_requests','consulting_flow_upload_completions'] loop
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      join pg_trigger t on t.tgrelid=c.oid where n.nspname='partner_hub' and c.relname=table_name
        and c.relkind='r' and c.relrowsecurity and t.tgname=table_name||'_guard' and t.tgenabled='O') then
      raise exception 'SUPABASE_FLOW_FILE_LEDGER_SCHEMA_NOT_READY';
    end if;
  end loop;
  if not exists (select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='partner_hub' and c.relname='consulting_flow_upload_requests_pending_fingerprint_slot_idx'
      and i.indisunique and i.indisvalid and i.indpred is not null) then raise exception 'SUPABASE_FLOW_FILE_LEDGER_SCHEMA_NOT_READY'; end if;
  return 1;
end;
$$;
revoke all on function partner_hub.guard_flow_file_immutable(),partner_hub.guard_flow_file_metadata(),
  partner_hub.guard_flow_upload_command_key(),partner_hub.guard_flow_upload_request(),partner_hub.guard_flow_upload_completion(),
  partner_hub.flow_reserved_file_matches(json,partner_hub.consulting_flow_upload_requests,text),partner_hub.assert_flow_file_ledger_schema()
  from public,anon,authenticated;
grant execute on function partner_hub.flow_reserved_file_matches(json,partner_hub.consulting_flow_upload_requests,text),
  partner_hub.assert_flow_file_ledger_schema() to service_role;

commit;
