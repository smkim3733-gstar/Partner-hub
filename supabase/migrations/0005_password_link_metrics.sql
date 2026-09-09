begin;

-- Anonymous daily totals only. No user, email, bearer token or request payload.
create table partner_hub.portal_password_link_stats (
  bucket_date text primary key,
  issued_count bigint not null default 0 check (issued_count between 0 and 9007199254740991),
  active_replacement_count bigint not null default 0 check (active_replacement_count between 0 and 9007199254740991),
  expired_at_reissue_count bigint not null default 0 check (expired_at_reissue_count between 0 and 9007199254740991),
  redeemed_count bigint not null default 0 check (redeemed_count between 0 and 9007199254740991),
  observed_expired_attempt_count bigint not null default 0 check (observed_expired_attempt_count between 0 and 9007199254740991)
);
alter table partner_hub.portal_password_link_stats enable row level security;
revoke all on partner_hub.portal_password_link_stats from public, anon, authenticated;
grant select, insert, update on partner_hub.portal_password_link_stats to service_role;

commit;
