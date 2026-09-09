-- Run only against the Supabase migration target. Synthetic rows are confined
-- to one transaction and always rolled back. No Storage bytes are touched.
begin;
set local search_path = partner_hub, pg_catalog;
set local statement_timeout = '25000ms';
set local lock_timeout = '5000ms';

do $$
declare
  test_key text := 'company-source/storage-smoke-' || gen_random_uuid()::text;
  first_revision text := gen_random_uuid()::text;
  second_revision text := gen_random_uuid()::text;
  tombstone text := gen_random_uuid()::text;
  changed integer;
  visible_revision text;
begin
  if has_schema_privilege('anon', 'partner_hub', 'USAGE')
     or has_schema_privilege('authenticated', 'partner_hub', 'USAGE') then
    raise exception 'Browser role can access private schema';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'partner_hub' and c.relkind = 'r' and not c.relrowsecurity) then
    raise exception 'RLS missing';
  end if;
  if has_table_privilege('service_role', 'partner_hub.storage_object_versions', 'UPDATE')
     or has_table_privilege('service_role', 'partner_hub.storage_object_versions', 'DELETE') then
    raise exception 'Storage version mutation privilege leaked';
  end if;

  insert into storage_object_versions (object_key, revision, physical_path, wire)
    values (test_key, first_revision, 'partner-hub/objects/v1/' || first_revision, '{}'),
           (test_key, second_revision, 'partner-hub/objects/v1/' || second_revision, '{}');
  insert into storage_object_heads (object_key, revision, version_revision)
    select test_key, first_revision, first_revision where (null::text is null or exists
      (select 1 from storage_object_heads where object_key = test_key and revision = null::text))
    on conflict (object_key) do update set revision = excluded.revision,
      version_revision = excluded.version_revision where storage_object_heads.revision = null::text;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Initial create failed'; end if;

  -- A racing create must not overwrite the winner.
  insert into storage_object_heads (object_key, revision, version_revision)
    select test_key, second_revision, second_revision where (null::text is null or exists
      (select 1 from storage_object_heads where object_key = test_key and revision = null::text))
    on conflict (object_key) do update set revision = excluded.revision,
      version_revision = excluded.version_revision where storage_object_heads.revision = null::text;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Racing create overwrote winner'; end if;

  -- A matching revision replaces the pointer, not the immutable physical object.
  insert into storage_object_heads (object_key, revision, version_revision)
    select test_key, second_revision, second_revision where (first_revision::text is null or exists
      (select 1 from storage_object_heads where object_key = test_key and revision = first_revision))
    on conflict (object_key) do update set revision = excluded.revision,
      version_revision = excluded.version_revision where storage_object_heads.revision = first_revision;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Matching CAS failed'; end if;
  update storage_object_heads set revision = tombstone, version_revision = null
    where object_key = test_key and revision = first_revision;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Stale delete removed replacement'; end if;

  begin
    -- A later immutable-ledger failure must also undo the earlier pointer change.
    update storage_object_heads set revision = tombstone, version_revision = null
      where object_key = test_key and revision = second_revision;
    update storage_object_versions set wire = '{"tampered":true}'
      where object_key = test_key and revision = first_revision;
    raise exception 'Immutable update was accepted';
  exception when check_violation then
    if sqlerrm <> 'STORAGE_VERSION_IMMUTABLE' then raise; end if;
  end;
  select revision into visible_revision from storage_object_heads where object_key = test_key;
  if visible_revision <> second_revision then raise exception 'Atomic rollback failed'; end if;
  begin
    delete from storage_object_versions where object_key = test_key and revision = first_revision;
    raise exception 'Immutable delete was accepted';
  exception when check_violation then
    if sqlerrm <> 'STORAGE_VERSION_IMMUTABLE' then raise; end if;
  end;
  begin
    update storage_object_heads set version_revision = first_revision where object_key = test_key;
    raise exception 'Mismatched version pointer accepted';
  exception when check_violation then null;
  end;
  begin
    update storage_object_heads set revision = tombstone, version_revision = tombstone where object_key = test_key;
    raise exception 'Missing version accepted';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select 'PASS: private schema, RLS, CAS, foreign keys, immutable history, atomic rollback' as result;
rollback;
