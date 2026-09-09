-- Initial-target only. Exercises real ledgers, not a partially guarded FLOW
-- root. No production root is created; positive completion uses a local-only
-- fixture until the complete native FLOW port is ready. All probe rows roll back.
begin;
set local statement_timeout='25s';
do $preflight$
declare table_name text; populated boolean;
begin
  foreach table_name in array array['consulting_flow_file_owners','consulting_flow_file_metadata',
    'consulting_flow_file_object_integrity','consulting_flow_file_object_checksums','consulting_flow_upload_command_keys',
    'consulting_flow_upload_requests','consulting_flow_upload_completions'] loop
    execute format('select exists(select 1 from partner_hub.%I)',table_name) into populated;
    if populated then raise exception 'Initial-target probe requires empty FLOW file ledgers'; end if;
  end loop;
end;
$preflight$;
set local role service_role;
do $probe$
declare table_name text; n integer;
begin
  perform partner_hub.assert_flow_file_ledger_schema();
  if to_regclass('partner_hub.consulting_flows') is not null then raise exception 'This is not a complete FLOW runtime probe'; end if;
  foreach table_name in array array['consulting_flow_file_owners','consulting_flow_file_metadata',
    'consulting_flow_file_object_integrity','consulting_flow_file_object_checksums','consulting_flow_upload_command_keys',
    'consulting_flow_upload_requests','consulting_flow_upload_completions'] loop
    if has_table_privilege('anon','partner_hub.'||table_name,'select,insert,update,delete')
      or has_table_privilege('authenticated','partner_hub.'||table_name,'select,insert,update,delete')
      or has_table_privilege('service_role','partner_hub.'||table_name,'truncate,delete') then
      raise exception 'Unexpected FLOW ledger role privilege';
    end if;
  end loop;
  insert into partner_hub.consulting_flow_upload_requests
    (case_id,actor_key,command_id,slot,fingerprint,file_id,storage_key,original_name,content_type,size_bytes,purpose,created_at,status)
    values ('synthetic-case','admin:primary','synthetic-command','file',repeat('a',64),'synthetic-file',
      'consulting-flow/synthetic-file','synthetic.txt','text/plain',4,'recording','2026-09-09T13:00:00.000Z','pending');
  begin
    insert into partner_hub.consulting_flow_upload_requests
      (case_id,actor_key,command_id,slot,fingerprint,file_id,storage_key,original_name,content_type,size_bytes,purpose,created_at,status)
      values ('synthetic-case','admin:primary','synthetic-command','audio',repeat('b',64),'synthetic-audio',
        'consulting-flow/synthetic-audio','synthetic.mp3','audio/mpeg',4,'recording','2026-09-09T13:00:00.000Z','pending');
    raise exception 'Cross-slot fingerprint change accepted';
  exception when check_violation then null;
  end;
  begin
    update partner_hub.consulting_flow_upload_requests set status='ready' where file_id='synthetic-file';
    raise exception 'Uncommitted upload became ready';
  exception when check_violation then null;
  end;
  begin
    update partner_hub.consulting_flow_upload_command_keys set fingerprint=repeat('b',64);
    raise exception 'Upload command key changed';
  exception when check_violation then null;
  end;
  begin
    insert into partner_hub.consulting_flow_file_owners values ('synthetic-file','synthetic-case','consulting-flow/synthetic-file','2026-09-09T13:00:00.000Z');
    insert into partner_hub.consulting_flow_file_object_integrity values ('synthetic-file','etag',null,'text/plain');
    raise exception 'NULL ETag proof accepted';
  exception when check_violation then null;
  end;
  select count(*) into n from partner_hub.consulting_flow_file_owners;
  if n <> 0 then raise exception 'Late failure retained an earlier owner claim'; end if;
  insert into partner_hub.consulting_flow_file_metadata
    (file_id,original_name,content_type,size_bytes,purpose) values ('synthetic-legacy','synthetic.pdf','application/pdf',4,'source');
  update partner_hub.consulting_flow_file_metadata set purpose='source_archived' where file_id='synthetic-legacy';
  begin
    update partner_hub.consulting_flow_file_metadata set purpose='source' where file_id='synthetic-legacy';
    raise exception 'Archived source resurrected';
  exception when check_violation then null;
  end;
  select count(*) into n from partner_hub.consulting_flow_upload_requests where status='pending';
  if n <> 1 then raise exception 'Pending reservation was changed'; end if;
  select count(*) into n from partner_hub.consulting_flow_upload_command_keys;
  if n <> 1 then raise exception 'Failed reservation leaked a key'; end if;
end;
$probe$;
rollback;
