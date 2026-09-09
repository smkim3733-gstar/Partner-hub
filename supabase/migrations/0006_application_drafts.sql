begin;

create table partner_hub.application_drafts (
  owner_key text primary key,
  revision bigint not null check (revision between 1 and 9007199254740991),
  draft_id text not null unique check (draft_id ~ '^[A-Za-z0-9-]{10,80}$'),
  payload text check (payload is null or jsonb_typeof(payload::jsonb) = 'object'),
  updated_at text not null check (partner_hub.valid_utc_millisecond(updated_at))
);
create function partner_hub.guard_application_draft()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'application draft tombstone is durable' using errcode = '23514';
  elsif TG_OP = 'INSERT' then
    if NEW.revision <> 1 or NEW.payload is null then
      raise exception 'application draft insert envelope is invalid' using errcode = '23514';
    end if;
  else
    if NEW.owner_key is distinct from OLD.owner_key then
      raise exception 'application draft owner is immutable' using errcode = '23514';
    end if;
    if NEW.revision <> OLD.revision + 1 or NEW.payload is not distinct from OLD.payload
       or not ((OLD.payload is not null and NEW.draft_id = OLD.draft_id)
         or (OLD.payload is null and NEW.payload is not null and NEW.draft_id <> OLD.draft_id)) then
      raise exception 'application draft transition envelope is invalid' using errcode = '23514';
    end if;
  end if;
  return NEW;
end;
$$;
create trigger application_drafts_guard before insert or update or delete on partner_hub.application_drafts
for each row execute function partner_hub.guard_application_draft();
alter table partner_hub.application_drafts enable row level security;
revoke all on partner_hub.application_drafts from public, anon, authenticated;
grant select, insert, update on partner_hub.application_drafts to service_role;
revoke all on function partner_hub.guard_application_draft() from public, anon, authenticated;

create function partner_hub.assert_draft_schema()
returns integer language plpgsql set search_path = pg_catalog as $$
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'partner_hub' and c.relname = 'application_drafts' and c.relkind = 'r' and c.relrowsecurity)
    or not exists (select 1 from pg_trigger where tgrelid = 'partner_hub.application_drafts'::regclass
      and tgname = 'application_drafts_guard' and tgenabled = 'O') then
    raise exception 'SUPABASE_DRAFT_SCHEMA_NOT_READY';
  end if;
  return 1;
end;
$$;
revoke all on function partner_hub.assert_draft_schema() from public, anon, authenticated;
grant execute on function partner_hub.assert_draft_schema() to service_role;

commit;
