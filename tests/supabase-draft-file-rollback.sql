-- Target-only pre-onboarding test: synthetic metadata, no Storage bytes.
-- Refuse a populated target and roll back every synthetic row.
begin;
set transaction isolation level serializable;
set local search_path = partner_hub, pg_catalog;
set local statement_timeout = '25000ms';
set local lock_timeout = '5000ms';

do $$
declare table_name text;
begin
  if exists (select 1 from portal_state) or exists (select 1 from standalone_admin_accounts)
    or exists (select 1 from portal_password_accounts) or exists (select 1 from application_drafts)
    or exists (select 1 from company_file_objects) or exists (select 1 from company_file_upload_requests) then
    raise exception 'Pre-onboarding probe refused: target already has application data';
  end if;
  perform partner_hub.assert_draft_schema();
  perform partner_hub.assert_company_file_schema();
  if has_schema_privilege('anon', 'partner_hub', 'USAGE')
    or has_schema_privilege('authenticated', 'partner_hub', 'USAGE') then
    raise exception 'Browser schema access leaked';
  end if;
  foreach table_name in array array['application_drafts', 'company_file_objects', 'company_file_object_integrity',
    'company_file_object_checksums', 'company_file_storage_keys', 'company_file_metadata',
    'company_file_assignments', 'company_file_case_links', 'company_file_upload_requests'] loop
    if not (select relrowsecurity from pg_class where oid = ('partner_hub.' || table_name)::regclass)
      or has_table_privilege('anon', 'partner_hub.' || table_name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      or has_table_privilege('authenticated', 'partner_hub.' || table_name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      or has_table_privilege('service_role', 'partner_hub.' || table_name, 'TRUNCATE') then
      raise exception 'RLS/privilege check failed: %', table_name;
    end if;
  end loop;

  insert into application_drafts values ('migration-test-owner', 1, 'migration-draft-001', '{}', '2026-09-09T00:00:00.000Z');
  begin
    update application_drafts set revision = 3, payload = '{"changed":true}';
    raise exception 'Skipped draft revision accepted';
  exception when check_violation then null;
  end;
  begin
    update application_drafts set owner_key = 'other', revision = 2, payload = '{"changed":true}';
    raise exception 'Draft ownership changed';
  exception when check_violation then null;
  end;
  update application_drafts set revision = 2, payload = null;
  begin
    update application_drafts set revision = 3, payload = '{}';
    raise exception 'Tombstoned draft ID revived';
  exception when check_violation then null;
  end;
  update application_drafts set revision = 3, draft_id = 'migration-draft-002', payload = '{}';
  begin
    delete from application_drafts;
    raise exception 'Draft tombstone deleted';
  exception when check_violation then null;
  end;

  insert into company_file_upload_requests values
    ('migration-test-owner', 'migration-upload', 'synthetic-fingerprint', 'migration-test-file', 'synthetic-time', 'pending');
  insert into company_file_objects values
    ('migration-test-file', 'synthetic/not-a-storage-object', 'synthetic.pdf', 'Synthetic company', 'Synthetic category',
     'Synthetic title', 'Synthetic owner', 'synthetic-user', 'synthetic@example.invalid', 'application/pdf', 123, 'synthetic-time');
  begin
    insert into company_file_object_integrity values ('migration-test-file', 'etag', null, 'application/pdf');
    raise exception 'NULL ETag accepted in etag mode';
  exception when check_violation then null;
  end;
  insert into company_file_object_integrity values ('migration-test-file', 'etag', 'synthetic-etag', 'application/pdf');
  insert into company_file_object_checksums values ('migration-test-file', repeat('a', 64));
  insert into company_file_storage_keys values ('migration-test-file', 'synthetic/not-a-storage-object');
  insert into company_file_metadata select id, original_name, company, category, title, assigned_trainee,
    uploaded_by_user_id, uploaded_by_email, content_type, size_bytes, created_at from company_file_objects;
  insert into company_file_assignments values ('migration-test-file', 'migration-test-member');
  insert into company_file_case_links values ('migration-test-file', 'migration-test-case');
  begin
    update company_file_objects set title = title;
    raise exception 'Immutable file root updated';
  exception when check_violation then null;
  end;
  foreach table_name in array array['company_file_object_integrity', 'company_file_object_checksums',
    'company_file_storage_keys', 'company_file_metadata', 'company_file_assignments', 'company_file_case_links'] loop
    begin
      execute format('update partner_hub.%I set file_id = file_id', table_name);
      raise exception 'Immutable child updated: %', table_name;
    exception when check_violation then null;
    end;
    begin
      execute format('delete from partner_hub.%I', table_name);
      raise exception 'Immutable child directly deleted: %', table_name;
    exception when check_violation then null;
    end;
  end loop;
  begin
    update company_file_upload_requests set status = 'ready';
    insert into company_file_object_checksums values ('migration-test-file', repeat('b', 64));
    raise exception 'Duplicate checksum accepted';
  exception when unique_violation then null;
  end;
  if (select status from company_file_upload_requests) <> 'pending' then
    raise exception 'File transaction rollback failed';
  end if;
  update company_file_upload_requests set request_key = 'migrated-key', fingerprint = 'migrated-fingerprint';
  update company_file_upload_requests set status = 'ready';
  begin
    update company_file_upload_requests set status = 'pending';
    raise exception 'Upload status reversed';
  exception when check_violation then null;
  end;
  update company_file_upload_requests set status = 'deleted';
  update company_file_upload_requests set status = 'deleted';
  begin
    update company_file_upload_requests set request_key = 'revived-key';
    raise exception 'Deleted receipt rekeyed';
  exception when check_violation then null;
  end;
  begin
    delete from company_file_upload_requests;
    raise exception 'Durable receipt deleted';
  exception when check_violation then null;
  end;
  delete from company_file_objects;
  if exists (select 1 from company_file_object_integrity) or exists (select 1 from company_file_object_checksums)
    or exists (select 1 from company_file_storage_keys) or exists (select 1 from company_file_metadata)
    or exists (select 1 from company_file_assignments) or exists (select 1 from company_file_case_links)
    or (select count(*) from company_file_upload_requests) <> 1 then
    raise exception 'Parent cascade or durable receipt retention failed';
  end if;
end;
$$;
select 'PASS: draft lifecycle, file immutability, transaction rollback, cascade, durable receipts and private privileges' as result;
rollback;
