begin;

-- Preserve exact JSON text for existing compare-and-swap operations. jsonb is
-- used only to validate/query it, never to reserialize the CAS source value.
create function partner_hub.valid_utc_millisecond(value text)
returns boolean language plpgsql immutable strict set search_path = pg_catalog as $$
begin
  if value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' then
    return false;
  end if;
  return to_char(value::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') = value;
exception when invalid_datetime_format or datetime_field_overflow then
  return false;
end;
$$;

create table partner_hub.portal_state (
  id text primary key check (id = 'keve-partner-hub'),
  payload text not null check (jsonb_typeof(payload::jsonb) = 'object' and octet_length(payload) <= 900000),
  updated_at text not null check (partner_hub.valid_utc_millisecond(updated_at))
);
create function partner_hub.reject_portal_state_delete()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  raise exception 'portal state root is durable' using errcode = '23514';
end;
$$;
create trigger portal_state_no_delete before delete on partner_hub.portal_state
for each row execute function partner_hub.reject_portal_state_delete();

create table partner_hub.portal_login_stats (
  member_id text primary key check (member_id <> '' and member_id = trim(member_id)),
  last_login_at text not null check (partner_hub.valid_utc_millisecond(last_login_at)),
  login_count bigint not null default 1 check (login_count between 1 and 9007199254740991)
);
create function partner_hub.guard_portal_login_stat()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.login_count <> 1 then
      raise exception 'portal login stat insert envelope is invalid' using errcode = '23514';
    end if;
  else
    if NEW.member_id is distinct from OLD.member_id then
      raise exception 'portal login stat identity is immutable' using errcode = '23514';
    end if;
    if NEW.last_login_at < OLD.last_login_at or not (
      NEW.login_count = OLD.login_count or (NEW.login_count = OLD.login_count + 1
        and NEW.last_login_at::timestamptz >= OLD.last_login_at::timestamptz + interval '30 minutes')
    ) then
      raise exception 'portal login stat update envelope is invalid' using errcode = '23514';
    end if;
  end if;
  return NEW;
end;
$$;
create trigger portal_login_stats_guard before insert or update on partner_hub.portal_login_stats
for each row execute function partner_hub.guard_portal_login_stat();

alter table partner_hub.portal_state enable row level security;
alter table partner_hub.portal_login_stats enable row level security;
revoke all on partner_hub.portal_state, partner_hub.portal_login_stats from public, anon, authenticated;
grant select, insert, update on partner_hub.portal_state to service_role;
grant select, insert, update, delete on partner_hub.portal_login_stats to service_role;
revoke all on function partner_hub.valid_utc_millisecond(text),
  partner_hub.reject_portal_state_delete(), partner_hub.guard_portal_login_stat()
  from public, anon, authenticated;
grant execute on function partner_hub.valid_utc_millisecond(text) to service_role;

-- Base state/login scope only. AI/file/draft schemas have their own migrations;
-- this guard must not claim they are ready or suppress their SQL failures.
create function partner_hub.assert_portal_schema()
returns integer language plpgsql set search_path = pg_catalog as $$
begin
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'partner_hub' and c.relkind = 'r' and c.relrowsecurity
      and c.relname in ('portal_state', 'portal_login_stats')) <> 2
    or (select count(*) from pg_trigger t
      where t.tgenabled = 'O' and (
        (t.tgrelid = 'partner_hub.portal_state'::regclass and t.tgname = 'portal_state_no_delete') or
        (t.tgrelid = 'partner_hub.portal_login_stats'::regclass and t.tgname = 'portal_login_stats_guard')
      )) <> 2 then
    raise exception 'SUPABASE_PORTAL_SCHEMA_NOT_READY';
  end if;
  return 1;
end;
$$;
revoke all on function partner_hub.assert_portal_schema() from public, anon, authenticated;
grant execute on function partner_hub.assert_portal_schema() to service_role;

commit;
