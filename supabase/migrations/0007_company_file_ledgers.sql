begin;

create table partner_hub.company_file_objects (
  id text primary key, storage_key text not null unique,
  original_name text not null, company text not null, category text not null,
  title text not null, assigned_trainee text not null, uploaded_by_user_id text not null,
  uploaded_by_email text not null, content_type text not null, size_bytes bigint not null,
  created_at text not null
);
create index company_file_objects_owner_idx on partner_hub.company_file_objects(assigned_trainee, created_at);
create index company_file_objects_company_idx on partner_hub.company_file_objects(company, created_at);
create table partner_hub.company_file_object_integrity (
  file_id text primary key references partner_hub.company_file_objects(id) on delete cascade,
  validation_mode text not null check (validation_mode in ('metadata', 'etag')),
  r2_etag text, r2_content_type text not null,
  check ((validation_mode = 'metadata' and r2_etag is null) or
    (validation_mode = 'etag' and r2_etag is not null and length(r2_etag) between 1 and 256))
);
create table partner_hub.company_file_object_checksums (
  file_id text primary key references partner_hub.company_file_objects(id) on delete cascade,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$')
);
create table partner_hub.company_file_storage_keys (
  file_id text primary key references partner_hub.company_file_objects(id) on delete cascade,
  storage_key text not null unique
);
create table partner_hub.company_file_metadata (
  file_id text primary key references partner_hub.company_file_objects(id) on delete cascade,
  original_name text not null, company text not null, category text not null,
  title text not null, assigned_trainee text not null, uploaded_by_user_id text not null,
  uploaded_by_email text not null, content_type text not null, size_bytes bigint not null,
  created_at text not null
);
-- Missing assignment row = legacy name fallback. Empty ID = admin-only.
create table partner_hub.company_file_assignments (
  file_id text primary key references partner_hub.company_file_objects(id) on delete cascade,
  partner_member_id text not null
);
create table partner_hub.company_file_case_links (
  file_id text primary key references partner_hub.company_file_objects(id) on delete cascade,
  case_id text not null
);
-- Deliberately no FK to the deletable file root: receipts survive its removal.
create table partner_hub.company_file_upload_requests (
  owner_key text not null, request_key text not null, fingerprint text not null,
  file_id text not null unique, created_at text not null,
  status text not null check (status in ('pending', 'ready', 'deleted')),
  primary key (owner_key, request_key)
);

create function partner_hub.reject_company_file_update()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  raise exception 'company file object is immutable' using errcode = '23514';
end;
$$;
create trigger company_file_objects_no_update before update on partner_hub.company_file_objects
for each row execute function partner_hub.reject_company_file_update();

create function partner_hub.guard_company_file_child()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if TG_OP = 'UPDATE' then
    raise exception '% is immutable', TG_ARGV[0] using errcode = '23514';
  end if;
  if exists (select 1 from partner_hub.company_file_objects where id = OLD.file_id) then
    raise exception '% requires parent deletion', TG_ARGV[0] using errcode = '23514';
  end if;
  -- FK cascades run after the parent is absent. RETURN OLD permits each delete.
  return OLD;
end;
$$;
create trigger company_file_object_integrity_guard before update or delete on partner_hub.company_file_object_integrity
for each row execute function partner_hub.guard_company_file_child('company file object integrity');
create trigger company_file_object_checksums_guard before update or delete on partner_hub.company_file_object_checksums
for each row execute function partner_hub.guard_company_file_child('company file object checksum');
create trigger company_file_storage_keys_guard before update or delete on partner_hub.company_file_storage_keys
for each row execute function partner_hub.guard_company_file_child('company file storage key');
create trigger company_file_metadata_guard before update or delete on partner_hub.company_file_metadata
for each row execute function partner_hub.guard_company_file_child('company file metadata');
create trigger company_file_assignments_guard before update or delete on partner_hub.company_file_assignments
for each row execute function partner_hub.guard_company_file_child('company file assignment');
create trigger company_file_case_links_guard before update or delete on partner_hub.company_file_case_links
for each row execute function partner_hub.guard_company_file_child('company file case link');

create function partner_hub.guard_company_upload_request()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'company file upload request is durable' using errcode = '23514';
  end if;
  if NEW.owner_key <> OLD.owner_key or NEW.file_id <> OLD.file_id or NEW.created_at <> OLD.created_at
    or (NEW.fingerprint <> OLD.fingerprint and NEW.request_key = OLD.request_key)
    or ((NEW.request_key <> OLD.request_key or NEW.fingerprint <> OLD.fingerprint) and NEW.status <> OLD.status)
    or (OLD.status = 'deleted' and (NEW.request_key <> OLD.request_key or NEW.fingerprint <> OLD.fingerprint))
    or not (NEW.status = OLD.status or (OLD.status = 'pending' and NEW.status in ('ready', 'deleted'))
      or (OLD.status = 'ready' and NEW.status = 'deleted')) then
    raise exception 'company file upload request transition is invalid' using errcode = '23514';
  end if;
  return NEW;
end;
$$;
create trigger company_file_upload_requests_guard before update or delete on partner_hub.company_file_upload_requests
for each row execute function partner_hub.guard_company_upload_request();

do $$
declare table_name text;
begin
  foreach table_name in array array['company_file_objects', 'company_file_object_integrity',
    'company_file_object_checksums', 'company_file_storage_keys', 'company_file_metadata',
    'company_file_assignments', 'company_file_case_links', 'company_file_upload_requests'] loop
    execute format('alter table partner_hub.%I enable row level security', table_name);
    execute format('revoke all on partner_hub.%I from public, anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on partner_hub.%I to service_role', table_name);
  end loop;
end;
$$;
revoke delete on partner_hub.company_file_upload_requests from service_role;
revoke all on function partner_hub.reject_company_file_update(), partner_hub.guard_company_file_child(),
  partner_hub.guard_company_upload_request() from public, anon, authenticated;

create function partner_hub.assert_company_file_schema()
returns integer language plpgsql set search_path = pg_catalog as $$
begin
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'partner_hub' and c.relkind = 'r' and c.relrowsecurity
      and c.relname in ('company_file_objects', 'company_file_object_integrity',
        'company_file_object_checksums', 'company_file_storage_keys', 'company_file_metadata',
        'company_file_assignments', 'company_file_case_links', 'company_file_upload_requests')) <> 8
    or (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'partner_hub' and t.tgenabled = 'O'
      and ((c.relname = 'company_file_objects' and t.tgname = 'company_file_objects_no_update') or
        (c.relname in ('company_file_object_integrity', 'company_file_object_checksums', 'company_file_storage_keys',
          'company_file_metadata', 'company_file_assignments', 'company_file_case_links', 'company_file_upload_requests')
          and t.tgname = c.relname || '_guard'))) <> 8 then
    raise exception 'SUPABASE_COMPANY_FILE_SCHEMA_NOT_READY';
  end if;
  return 1;
end;
$$;
revoke all on function partner_hub.assert_company_file_schema() from public, anon, authenticated;
grant execute on function partner_hub.assert_company_file_schema() to service_role;

commit;
