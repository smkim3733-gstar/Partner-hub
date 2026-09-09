begin;
set local role service_role;
set local statement_timeout = '20s';
do $$
declare consumed integer; start_ms bigint;
begin
  -- Initial connection probe only. Never change existing operational metrics.
  if exists(select 1 from partner_hub.portal_duplicate_request_stats)
    or exists(select 1 from partner_hub.portal_save_conflict_stats)
    or exists(select 1 from partner_hub.portal_conflict_recovery_stats)
    or exists(select 1 from partner_hub.portal_conflict_receipts) then
    raise exception 'metrics probe requires empty tables';
  end if;
  perform partner_hub.assert_portal_metrics_schema();
  insert into partner_hub.portal_duplicate_request_stats values ('2040-06-01', 'flow_command', 'safe_retry', 1);
  insert into partner_hub.portal_save_conflict_stats values ('2040-06-01', 'state_save', 'state_revision', 'partner', 1, '2040-06-01T00:00:00.000Z');
  start_ms := (extract(epoch from '2040-06-01T00:00:00.000Z'::timestamptz) * 1000)::bigint;
  insert into partner_hub.portal_conflict_recovery_stats
    (bucket_date, source, kind, actor_role, issued_count)
    values ('2040-06-01', 'state_save', 'state_revision', 'partner', 1);
  insert into partner_hub.portal_conflict_receipts values
    (repeat('a',64), '2040-06-01', 'state_save', 'state_revision', 'partner', '2040-06-01T00:00:00.000Z', start_ms + 86400000, null);
  consumed := partner_hub.consume_portal_conflict_receipt(repeat('a',64), 'state_save', 'admin', start_ms + 1000);
  if consumed <> 0 then raise exception 'wrong-role receipt accepted'; end if;
  consumed := partner_hub.consume_portal_conflict_receipt(repeat('a',64), 'state_save', 'partner', start_ms + 60000);
  if consumed <> 1 then raise exception 'valid receipt rejected'; end if;
  consumed := partner_hub.consume_portal_conflict_receipt(repeat('a',64), 'state_save', 'partner', start_ms + 61000);
  if consumed <> 0 then raise exception 'receipt replay accepted'; end if;
  if not exists(select 1 from partner_hub.portal_conflict_recovery_stats
    where issued_count = 1 and recovered_count = 1 and under_5m_count = 1) then
    raise exception 'recovery counter mismatch';
  end if;
  if exists(select 1 from partner_hub.portal_conflict_receipts) then raise exception 'used receipt remains'; end if;
end;
$$;
rollback;
