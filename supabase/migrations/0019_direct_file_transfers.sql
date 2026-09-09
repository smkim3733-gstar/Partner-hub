begin;

-- Browser capabilities address only random, create-only staging objects.
-- Business file IDs, ownership, revision and receipts remain in their existing
-- ledgers. The app never treats a Storage callback as a business commit.
create table partner_hub.supabase_file_transfers (
  id text primary key check (id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'),
  user_id text not null check (length(user_id) between 1 and 200),
  session_hash text not null check (session_hash ~ '^[a-f0-9]{64}$'),
  intent text not null check (
    octet_length(intent) <= 16384 and partner_hub.inventory_unique_json(intent)
    and jsonb_typeof(intent::jsonb) = 'object'
    and (intent::jsonb->>'kind' in ('company-upload', 'flow-upload')) is true
  ),
  payload text check (payload is null or (
    octet_length(payload) <= 400000 and partner_hub.inventory_unique_json(payload)
    and jsonb_typeof(payload::jsonb) = 'object'
  )),
  file_path text unique check (file_path ~ '^partner-hub/staging/v1/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'),
  audio_path text unique check (audio_path ~ '^partner-hub/staging/v1/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'),
  created_at bigint not null check (created_at between 1 and 9007199246760991),
  expires_at bigint not null check (expires_at = created_at + 600000),
  -- Provider signatures live for two hours and can be issued until expires_at.
  -- Include the 120-second signing request timeout and 60-second clock margin.
  -- Never free quota or delete staging while a signature might still work.
  retain_until bigint not null check (retain_until = expires_at + 7380000),
  check (file_path is not null or audio_path is not null),
  check (file_path is distinct from audio_path),
  check ((case when intent::jsonb->>'kind' = 'company-upload' then
    payload is null and file_path is not null and audio_path is null
  else
    payload is not null
    and (file_path is not null) = jsonb_exists(intent::jsonb->'files', 'file')
    and (audio_path is not null) = jsonb_exists(intent::jsonb->'files', 'audio')
  end) is true)
);
create index supabase_file_transfers_user_retention
  on partner_hub.supabase_file_transfers (user_id, retain_until);

create function partner_hub.reject_file_transfer_mutation()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  raise exception 'FILE_TRANSFER_IMMUTABLE' using errcode = '23514';
end;
$$;
revoke all on function partner_hub.reject_file_transfer_mutation() from public, anon, authenticated;
create trigger supabase_file_transfers_immutable
  before update or delete on partner_hub.supabase_file_transfers
  for each row execute function partner_hub.reject_file_transfer_mutation();
alter table partner_hub.supabase_file_transfers enable row level security;
revoke all on partner_hub.supabase_file_transfers from public, anon, authenticated;
grant select, insert on partner_hub.supabase_file_transfers to service_role;

commit;
