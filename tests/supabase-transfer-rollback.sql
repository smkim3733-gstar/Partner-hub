begin;
set local role service_role;
set local search_path to partner_hub, pg_catalog;
set local statement_timeout = '20000ms';

do $$
declare
  original_id text := '11111111-1111-4111-8111-111111111111';
  other_id text := '22222222-2222-4222-8222-222222222222';
  path text := 'partner-hub/staging/v1/33333333-3333-4333-8333-333333333333';
  request_intent text := '{"kind":"company-upload","requestKey":"synthetic-only","fields":{},"file":{}}';
  stamp bigint := 1700000000000;
begin
  if exists (select 1 from partner_hub.supabase_file_transfers) then
    raise exception 'REFUSE_NONEMPTY_TRANSFER_PROBE';
  end if;
  insert into partner_hub.supabase_file_transfers
    (id,user_id,session_hash,intent,payload,file_path,audio_path,created_at,expires_at,retain_until)
  values (original_id,'synthetic-transfer-probe',repeat('a',64),request_intent,null,path,null,
    stamp,stamp+600000,stamp+7980000);
  begin
    update partner_hub.supabase_file_transfers set user_id='other' where id=original_id;
    raise exception 'TRANSFER_UPDATE_WAS_ALLOWED';
  exception when insufficient_privilege or check_violation then null;
  end;
  begin
    delete from partner_hub.supabase_file_transfers where id=original_id;
    raise exception 'TRANSFER_DELETE_WAS_ALLOWED';
  exception when insufficient_privilege or check_violation then null;
  end;
  begin
    insert into partner_hub.supabase_file_transfers
    select other_id,user_id,session_hash,intent,payload,file_path,audio_path,created_at,expires_at,retain_until
    from partner_hub.supabase_file_transfers where id=original_id;
    raise exception 'DUPLICATE_PATH_WAS_ALLOWED';
  exception when unique_violation then null;
  end;
  begin
    insert into partner_hub.supabase_file_transfers
    select other_id,user_id,session_hash,intent,payload,
      replace(file_path,'/staging/','/objects/'),audio_path,created_at,expires_at,retain_until
    from partner_hub.supabase_file_transfers where id=original_id;
    raise exception 'FINAL_PATH_WAS_ALLOWED';
  exception when check_violation then null;
  end;
  begin
    insert into partner_hub.supabase_file_transfers
    select other_id,user_id,session_hash,intent,payload,
      'partner-hub/staging/v1/' || other_id,audio_path,created_at,expires_at,expires_at
    from partner_hub.supabase_file_transfers where id=original_id;
    raise exception 'SHORT_RETENTION_WAS_ALLOWED';
  exception when check_violation then null;
  end;
  if (select count(*) from partner_hub.supabase_file_transfers) <> 1 then
    raise exception 'PROBE_ROW_COUNT_MISMATCH';
  end if;
end;
$$;
select count(*) as synthetic_reservations_before_rollback from partner_hub.supabase_file_transfers;
rollback;
