begin;

-- Storage API owns the physical bytes. These application-owned tables keep
-- logical R2 keys and atomic version changes; storage.* is never modified.
create table partner_hub.storage_object_versions (
  object_key text not null check (
    object_key ~ '^(company-source|consulting-flow)/[A-Za-z0-9_-]{1,200}$'
    or object_key ~ '^[A-Za-z0-9_-]{1,200}$'
  ),
  revision text not null check (revision ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'),
  physical_path text not null unique check (physical_path = 'partner-hub/objects/v1/' || revision),
  wire text not null check (jsonb_typeof(wire::jsonb) = 'object' and octet_length(wire) <= 16384),
  created_at timestamptz not null default now(),
  primary key (object_key, revision)
);

create table partner_hub.storage_object_heads (
  object_key text primary key,
  revision text not null check (revision ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'),
  version_revision text,
  foreign key (object_key, version_revision)
    references partner_hub.storage_object_versions (object_key, revision),
  check (version_revision is null or version_revision = revision)
);

create function partner_hub.reject_storage_version_mutation()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  raise exception 'STORAGE_VERSION_IMMUTABLE' using errcode = '23514';
end;
$$;
revoke all on function partner_hub.reject_storage_version_mutation() from public, anon, authenticated;
create trigger storage_object_versions_immutable
before update or delete on partner_hub.storage_object_versions
for each row execute function partner_hub.reject_storage_version_mutation();

alter table partner_hub.storage_object_versions enable row level security;
alter table partner_hub.storage_object_heads enable row level security;
revoke all on partner_hub.storage_object_versions, partner_hub.storage_object_heads
  from public, anon, authenticated;
grant select, insert on partner_hub.storage_object_versions to service_role;
grant select, insert, update on partner_hub.storage_object_heads to service_role;

commit;
