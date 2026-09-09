begin;

-- Anonymous aggregates only. No user, company, case, file, request key, IP,
-- fingerprint or request body belongs in these tables.
create table partner_hub.portal_duplicate_request_stats (
  bucket_date text not null check (partner_hub.valid_utc_millisecond(bucket_date || 'T00:00:00.000Z')),
  source text not null check (source in ('flow_command', 'file_upload', 'admin_partner_registration')),
  outcome text not null check (outcome in ('safe_retry', 'request_key_conflict', 'existing_record_blocked', 'unkeyed_request')),
  event_count bigint not null default 1 check (event_count between 0 and 9007199254740991),
  primary key (bucket_date, source, outcome)
);

create table partner_hub.portal_save_conflict_stats (
  bucket_date text not null check (partner_hub.valid_utc_millisecond(bucket_date || 'T00:00:00.000Z')),
  source text not null check (source in ('state_save', 'public_registration', 'admin_partner_registration')),
  kind text not null check (kind in ('member_revision', 'state_revision', 'recovery_proof', 'document_file_metadata', 'document_file_provenance', 'cas_exhausted', 'other')),
  actor_role text not null check (actor_role in ('admin', 'partner', 'unauthenticated')),
  conflict_count bigint not null default 1 check (conflict_count between 0 and 9007199254740991),
  last_conflict_at text not null check (partner_hub.valid_utc_millisecond(last_conflict_at)),
  primary key (bucket_date, source, kind, actor_role)
);

create table partner_hub.portal_conflict_recovery_stats (
  bucket_date text not null check (partner_hub.valid_utc_millisecond(bucket_date || 'T00:00:00.000Z')),
  source text not null check (source in ('state_save', 'public_registration', 'admin_partner_registration')),
  kind text not null check (kind in ('member_revision', 'state_revision', 'recovery_proof', 'document_file_metadata', 'document_file_provenance', 'cas_exhausted', 'other')),
  actor_role text not null check (actor_role in ('admin', 'partner', 'unauthenticated')),
  issued_count bigint not null default 0 check (issued_count between 0 and 9007199254740991),
  recovered_count bigint not null default 0 check (recovered_count between 0 and issued_count),
  under_1m_count bigint not null default 0 check (under_1m_count between 0 and recovered_count),
  under_5m_count bigint not null default 0 check (under_5m_count between 0 and recovered_count),
  under_30m_count bigint not null default 0 check (under_30m_count between 0 and recovered_count),
  under_2h_count bigint not null default 0 check (under_2h_count between 0 and recovered_count),
  under_24h_count bigint not null default 0 check (under_24h_count between 0 and recovered_count),
  check (under_1m_count + under_5m_count + under_30m_count + under_2h_count + under_24h_count = recovered_count),
  primary key (bucket_date, source, kind, actor_role)
);

-- A short-lived, anonymous receipt retains ONLY the SHA-256 hash of its bearer
-- token and the aggregate dimensions. Consumption never returns that hash.
create table partner_hub.portal_conflict_receipts (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  bucket_date text not null check (partner_hub.valid_utc_millisecond(bucket_date || 'T00:00:00.000Z')),
  source text not null check (source in ('state_save', 'public_registration', 'admin_partner_registration')),
  kind text not null check (kind in ('member_revision', 'state_revision', 'recovery_proof', 'document_file_metadata', 'document_file_provenance', 'cas_exhausted', 'other')),
  actor_role text not null check (actor_role in ('admin', 'partner', 'unauthenticated')),
  started_at text not null check (partner_hub.valid_utc_millisecond(started_at)),
  expires_at bigint not null check (expires_at between 0 and 9007199254740991),
  claimed_at text check (claimed_at is null or partner_hub.valid_utc_millisecond(claimed_at)),
  check (expires_at = (extract(epoch from started_at::timestamptz) * 1000)::bigint + 86400000)
);
create index portal_conflict_receipts_expiry_idx on partner_hub.portal_conflict_receipts (expires_at);

-- One PostgreSQL statement owns receipt claim, aggregate increment and cleanup.
-- Concurrent consumers lock the same receipt: only its successful DELETE can
-- increment the aggregate. Any failure rolls back the DELETE too, allowing retry.
-- This is telemetry, NOT authorization or proof of a successful business write.
create function partner_hub.consume_portal_conflict_receipt(
  receipt_hash text, receipt_source text, receipt_role text, recovered_time bigint
)
returns integer language plpgsql set search_path = pg_catalog as $$
declare
  receipt partner_hub.portal_conflict_receipts%rowtype;
  elapsed_seconds bigint;
begin
  if recovered_time is null or recovered_time not between 0 and 9007199254740991 then
    raise exception 'invalid recovery timestamp';
  end if;
  delete from partner_hub.portal_conflict_receipts
    where token_hash = receipt_hash and source = receipt_source and actor_role = receipt_role
      and claimed_at is null and expires_at > recovered_time
    returning * into receipt;
  if not found then
    delete from partner_hub.portal_conflict_receipts where expires_at <= recovered_time;
    return 0;
  end if;
  elapsed_seconds := greatest(0, (recovered_time - (receipt.expires_at - 86400000)) / 1000);
  update partner_hub.portal_conflict_recovery_stats set
    recovered_count = recovered_count + 1,
    under_1m_count = under_1m_count + case when elapsed_seconds < 60 then 1 else 0 end,
    under_5m_count = under_5m_count + case when elapsed_seconds >= 60 and elapsed_seconds < 300 then 1 else 0 end,
    under_30m_count = under_30m_count + case when elapsed_seconds >= 300 and elapsed_seconds < 1800 then 1 else 0 end,
    under_2h_count = under_2h_count + case when elapsed_seconds >= 1800 and elapsed_seconds < 7200 then 1 else 0 end,
    under_24h_count = under_24h_count + case when elapsed_seconds >= 7200 then 1 else 0 end
    where bucket_date = receipt.bucket_date and source = receipt.source
      and kind = receipt.kind and actor_role = receipt.actor_role;
  if not found then
    raise exception 'recovery aggregate is missing';
  end if;
  delete from partner_hub.portal_conflict_receipts where expires_at <= recovered_time;
  return 1;
end;
$$;

alter table partner_hub.portal_duplicate_request_stats enable row level security;
alter table partner_hub.portal_save_conflict_stats enable row level security;
alter table partner_hub.portal_conflict_recovery_stats enable row level security;
alter table partner_hub.portal_conflict_receipts enable row level security;
revoke all on partner_hub.portal_duplicate_request_stats, partner_hub.portal_save_conflict_stats,
  partner_hub.portal_conflict_recovery_stats, partner_hub.portal_conflict_receipts from public, anon, authenticated;
grant select, insert, update on partner_hub.portal_duplicate_request_stats, partner_hub.portal_save_conflict_stats,
  partner_hub.portal_conflict_recovery_stats to service_role;
grant select, insert, delete on partner_hub.portal_conflict_receipts to service_role;
revoke all on function partner_hub.consume_portal_conflict_receipt(text, text, text, bigint) from public, anon, authenticated;
grant execute on function partner_hub.consume_portal_conflict_receipt(text, text, text, bigint) to service_role;

create function partner_hub.assert_portal_metrics_schema()
returns integer language plpgsql set search_path = pg_catalog as $$
begin
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'partner_hub' and c.relkind = 'r' and c.relrowsecurity
      and c.relname in ('portal_duplicate_request_stats', 'portal_save_conflict_stats',
        'portal_conflict_recovery_stats', 'portal_conflict_receipts')) <> 4
    or to_regprocedure('partner_hub.consume_portal_conflict_receipt(text,text,text,bigint)') is null then
    raise exception 'portal metrics schema is not ready';
  end if;
  return 1;
end;
$$;
revoke all on function partner_hub.assert_portal_metrics_schema() from public, anon, authenticated;
grant execute on function partner_hub.assert_portal_metrics_schema() to service_role;

commit;
