begin;

create schema if not exists partner_hub;

-- Application tables are server-only. Browser-facing anon/authenticated roles
-- receive no schema or table access; the existing portal performs authorization.
revoke all on schema partner_hub from public, anon, authenticated;
grant usage on schema partner_hub to service_role;

create table if not exists partner_hub.schema_migrations (
  sequence integer primary key,
  name text not null unique,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  applied_at timestamptz not null default now()
);

alter table partner_hub.schema_migrations enable row level security;
revoke all on table partner_hub.schema_migrations from public, anon, authenticated;
grant select, insert on table partner_hub.schema_migrations to service_role;

commit;
