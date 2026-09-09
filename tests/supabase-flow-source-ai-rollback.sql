-- Initial empty target only. Synthetic source and ledgers always rolled back.
begin;
set local statement_timeout = '25s';
set local role service_role;
do $probe$
declare original json; proposed json; changed json; imported json;
  command_id text := 'synthetic-effects-probe'; stamp text := '2026-09-09T12:01:00.000Z';
begin
  if exists(select 1 from partner_hub.company_file_objects) or exists(select 1 from partner_hub.portal_state)
    or to_regclass('partner_hub.consulting_flows') is not null then raise exception 'effect probe requires empty staged target'; end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='partner_hub' and p.proname in ('flow_json_object_edit','flow_ai_control_effect_valid','flow_intake_origin_valid','flow_source_effect_valid')) <> 4 then
    raise exception 'missing source/AI effects'; end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='partner_hub' and p.proname like 'flow_%' and (p.prosecdef
      or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))) then
    raise exception 'unexpected browser/security-definer privileges'; end if;
  original := '{"caseId":"synthetic-case","partnerId":"synthetic-partner","company":"가상기업","partnerName":"가상담당","ai":{"enabled":false},"jobs":[],"files":[]}';
  proposed := json_build_object('ai',json_build_object('enabled',false),'jobs',json_build_array(json_build_object(
    'id',command_id || '-job','stage',1,'status','blocked','reason','김성민 대표의 외부 AI 자동생성 승인이 필요합니다.','createdAt',stamp)));
  if not partner_hub.flow_ai_control_effect_valid(original,proposed,command_id,'queue_report1',stamp) then raise exception 'queue effect rejected'; end if;
  changed := partner_hub.flow_json_object_edit(proposed,json_build_object('jobs',json_build_array(
    partner_hub.flow_json_object_edit(proposed -> 'jobs' -> 0,'{"reason":"wrong"}'))));
  if partner_hub.flow_ai_control_effect_valid(original,changed,command_id,'queue_report1',stamp) then raise exception 'wrong queue reason accepted'; end if;
  insert into partner_hub.company_file_objects values ('synthetic-source-effect-probe','synthetic/source-effect-probe','가상.pdf','가상기업','재무자료','가상자료','가상담당',
    'synthetic-user','synthetic@example.invalid','application/pdf',100,stamp);
  imported := json_build_object('id','synthetic-imported','purpose','source','createdAt',stamp,'intakeFileId','synthetic-source-effect-probe',
    'intakeSourceHash',repeat('a',64),'sourceReviewedAt',stamp,'sourceReviewedBy','synthetic-admin');
  proposed := partner_hub.flow_json_object_edit(original,json_build_object('files',json_build_array(imported)));
  if partner_hub.flow_source_effect_valid(original,proposed,'import_intake_source',stamp) then raise exception 'unproved source accepted'; end if;
  insert into partner_hub.company_file_storage_keys select id,storage_key from partner_hub.company_file_objects where id='synthetic-source-effect-probe';
  insert into partner_hub.company_file_metadata select id,original_name,company,category,title,assigned_trainee,uploaded_by_user_id,uploaded_by_email,content_type,size_bytes,created_at
    from partner_hub.company_file_objects where id='synthetic-source-effect-probe';
  insert into partner_hub.company_file_object_integrity values ('synthetic-source-effect-probe','metadata',null,'application/pdf');
  if not partner_hub.flow_source_effect_valid(original,proposed,'import_intake_source',stamp) then raise exception 'proved legacy source rejected'; end if;
  changed := partner_hub.flow_json_object_edit(original,'{"partnerName":"다른담당"}');
  if partner_hub.flow_source_effect_valid(changed,proposed,'import_intake_source',stamp) then raise exception 'wrong owner accepted'; end if;
  insert into partner_hub.company_file_assignments values ('synthetic-source-effect-probe','synthetic-partner');
  if not partner_hub.flow_source_effect_valid(changed,proposed,'import_intake_source',stamp) then raise exception 'stable owner rename rejected'; end if;
  changed := partner_hub.flow_json_object_edit(proposed,json_build_object('files',json_build_array(
    partner_hub.flow_json_object_edit(imported,'{"purpose":"source_archived"}'))));
  if not partner_hub.flow_source_effect_valid(proposed,changed,'exclude_source',stamp) then raise exception 'archive effect rejected'; end if;
  if partner_hub.flow_source_effect_valid(changed,proposed,'exclude_source',stamp) then raise exception 'archive reversal accepted'; end if;
end;
$probe$;
rollback;
