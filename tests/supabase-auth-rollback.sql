-- Target-only pre-onboarding probe. Synthetic, unusable credentials; no Storage
-- bytes or existing records changed. Every synthetic row is rolled back.
begin;
set transaction isolation level serializable;
set local search_path = partner_hub, pg_catalog;
set local statement_timeout = '25000ms';
set local lock_timeout = '5000ms';

do $$
declare saved_payload text := '{ "members" : [] }';
begin
  if exists (select 1 from standalone_admin_accounts) or exists (select 1 from portal_state)
     or exists (select 1 from portal_password_accounts) then
    raise exception 'Pre-onboarding probe refused: target already has application data';
  end if;
  perform partner_hub.assert_auth_schema();
  perform partner_hub.assert_portal_schema();
  if has_schema_privilege('anon', 'partner_hub', 'USAGE')
     or has_schema_privilege('authenticated', 'partner_hub', 'USAGE') then
    raise exception 'Browser schema access leaked';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'partner_hub' and c.relkind = 'r' and (
      not c.relrowsecurity or has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
      or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE'))) then
    raise exception 'Table RLS or browser privilege check failed';
  end if;
  if has_table_privilege('service_role', 'partner_hub.standalone_admin_recovery_audit', 'UPDATE')
     or has_table_privilege('service_role', 'partner_hub.standalone_admin_recovery_audit', 'DELETE') then
    raise exception 'Recovery audit mutation privilege leaked';
  end if;

  insert into standalone_admin_accounts values
    ('primary-admin', 'migration-test@example.invalid', 'Migration test', 'unusable-test-hash',
     'test-version', 1, '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z');
  insert into standalone_admin_sessions values (repeat('a', 64), 'primary-admin', 'test-version', 1, 2);
  insert into standalone_admin_recovery_audit values ('migration-test-audit', 'primary-admin', 'rotation',
    repeat('b', 64), repeat('c', 64), '2026-09-09T00:00:00.000Z');
  begin
    update standalone_admin_accounts set credential_version = 'should-rollback';
    delete from standalone_admin_sessions;
    insert into standalone_admin_recovery_audit values ('migration-test-audit', 'primary-admin', 'rotation',
      repeat('c', 64), repeat('d', 64), '2026-09-09T00:00:00.000Z');
    raise exception 'Duplicate recovery receipt accepted';
  exception when unique_violation then null;
  end;
  if (select credential_version from standalone_admin_accounts) <> 'test-version'
     or (select count(*) from standalone_admin_sessions) <> 1 then
    raise exception 'Credential/session rollback failed';
  end if;
  begin
    delete from standalone_admin_recovery_audit;
    raise exception 'Recovery audit deletion accepted';
  exception when check_violation then
    if sqlerrm <> 'standalone_admin_recovery_audit_immutable' then raise; end if;
  end;

  insert into portal_state values ('keve-partner-hub', saved_payload, '2026-09-09T00:00:00.000Z');
  begin
    update portal_state set payload = '[]';
    raise exception 'Invalid portal JSON accepted';
  exception when check_violation then null;
  end;
  begin
    update portal_state set payload = jsonb_build_object('text', repeat('가', 300000))::text;
    raise exception 'Excess UTF-8 payload accepted';
  exception when check_violation then null;
  end;
  begin
    delete from portal_state;
    raise exception 'Portal root deletion accepted';
  exception when check_violation then
    if sqlerrm <> 'portal state root is durable' then raise; end if;
  end;
  if (select payload from portal_state) <> saved_payload then
    raise exception 'Exact CAS source text changed';
  end if;
  insert into portal_login_stats values ('migration-member', '2026-09-09T00:00:00.000Z', 1);
  begin
    update portal_login_stats set login_count = 2;
    raise exception 'Login session window bypassed';
  exception when check_violation then null;
  end;
  update portal_login_stats set login_count = 2, last_login_at = '2026-09-09T00:30:00.000Z';
  if (select login_count from portal_login_stats) <> 2 then raise exception 'Login counter failed'; end if;
end;
$$;
select 'PASS: private auth schema, RLS, recovery rollback, immutable audit, portal guards and login window' as result;
rollback;
