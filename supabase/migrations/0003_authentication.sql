begin;

-- Explicit ports of portalPasswordSchemaSql and standalone migrations 0001/2.
-- Password hashes and token digests remain server-only, outside portal JSON.
create table partner_hub.portal_password_accounts (
  member_id text primary key, email text unique not null,
  password_hash text not null, credential_version text not null,
  created_at text not null, updated_at text not null
);
create table partner_hub.portal_chatgpt_identity_bindings (
  subject_type text not null check (subject_type in ('owner', 'member')),
  subject_id text not null, user_key text unique not null,
  created_at text not null, updated_at text not null,
  primary key (subject_type, subject_id),
  check ((subject_type = 'owner' and subject_id = 'primary') or
    (subject_type = 'member' and length(subject_id) > 0))
);
create table partner_hub.portal_password_sessions (
  token_hash text primary key, member_id text not null,
  email text not null, credential_version text not null, expires_at bigint not null
);
create index portal_password_sessions_member_idx on partner_hub.portal_password_sessions(member_id);
create table partner_hub.portal_password_links (
  token_hash text primary key, member_id text not null, email text not null,
  expires_at bigint not null, consumed_by text, created_by text not null, created_at text not null
);
create index portal_password_links_member_idx on partner_hub.portal_password_links(member_id);
create table partner_hub.portal_auth_limits (
  key_hash text primary key, attempts bigint not null, expires_at bigint not null
);
create index portal_auth_limits_expiry_idx on partner_hub.portal_auth_limits(expires_at);

create table partner_hub.standalone_admin_accounts (
  id text primary key check (id = 'primary-admin'),
  email text not null unique check (email = lower(trim(email))),
  display_name text not null check (length(display_name) between 2 and 40),
  password_hash text not null, credential_version text not null,
  active integer not null default 1 check (active in (0, 1)),
  created_at text not null, updated_at text not null
);
create table partner_hub.standalone_admin_sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  admin_id text not null references partner_hub.standalone_admin_accounts(id),
  credential_version text not null,
  issued_at bigint not null, expires_at bigint not null,
  check (expires_at > issued_at and expires_at <= issued_at + 3600000)
);
create index standalone_admin_sessions_expiry on partner_hub.standalone_admin_sessions(expires_at);
create table partner_hub.standalone_admin_audit (
  id text primary key,
  admin_id text not null references partner_hub.standalone_admin_accounts(id),
  action text not null check (action in ('provision', 'login', 'logout', 'switch')),
  created_at text not null
);
create table partner_hub.standalone_admin_recovery_audit (
  id text primary key,
  admin_id text not null references partner_hub.standalone_admin_accounts(id),
  reason text not null check (reason in ('lost-password', 'credential-compromise', 'rotation')),
  previous_version_hash text not null check (previous_version_hash ~ '^[a-f0-9]{64}$'),
  next_version_hash text not null unique check (next_version_hash ~ '^[a-f0-9]{64}$'),
  created_at text not null
);
create function partner_hub.reject_admin_recovery_mutation()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  raise exception 'standalone_admin_recovery_audit_immutable' using errcode = '23514';
end;
$$;
revoke all on function partner_hub.reject_admin_recovery_mutation() from public, anon, authenticated;
create trigger standalone_admin_recovery_audit_no_update
before update or delete on partner_hub.standalone_admin_recovery_audit
for each row execute function partner_hub.reject_admin_recovery_mutation();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'portal_password_accounts', 'portal_chatgpt_identity_bindings',
    'portal_password_sessions', 'portal_password_links', 'portal_auth_limits',
    'standalone_admin_accounts', 'standalone_admin_sessions',
    'standalone_admin_audit', 'standalone_admin_recovery_audit'
  ] loop
    execute format('alter table partner_hub.%I enable row level security', table_name);
    execute format('revoke all on partner_hub.%I from public, anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on partner_hub.%I to service_role', table_name);
  end loop;
end;
$$;
revoke update, delete on partner_hub.standalone_admin_recovery_audit from service_role;

-- A request may validate its installed schema, but cannot create or repair it.
create function partner_hub.assert_auth_schema()
returns integer language plpgsql set search_path = pg_catalog as $$
begin
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'partner_hub' and c.relkind = 'r' and c.relrowsecurity
      and c.relname in ('portal_password_accounts', 'portal_chatgpt_identity_bindings',
        'portal_password_sessions', 'portal_password_links', 'portal_auth_limits',
        'standalone_admin_accounts', 'standalone_admin_sessions',
        'standalone_admin_audit', 'standalone_admin_recovery_audit')) <> 9
    or not exists (select 1 from pg_trigger t
      where t.tgrelid = 'partner_hub.standalone_admin_recovery_audit'::regclass
        and t.tgname = 'standalone_admin_recovery_audit_no_update' and t.tgenabled = 'O') then
    raise exception 'SUPABASE_AUTH_SCHEMA_NOT_READY';
  end if;
  return 1;
end;
$$;
revoke all on function partner_hub.assert_auth_schema() from public, anon, authenticated;
grant execute on function partner_hub.assert_auth_schema() to service_role;

commit;
