-- Pure variables and catalogs only. No root, account, file or business writes.
begin;
set local statement_timeout = '25s';
set local role service_role;
do $probe$
declare original json; commanded json; changed json;
  command_id text := 'synthetic-command-001'; stamp text := '2026-09-09T12:01:00.000Z';
begin
  if to_regclass('partner_hub.consulting_flows') is not null
    or to_regprocedure('partner_hub.assert_consulting_flow_schema()') is not null then
    raise exception 'Command-only probe must not be treated as whole FLOW readiness';
  end if;
  if (select count(*) from jsonb_object_keys(partner_hub.flow_command_rules())) <> 21 then raise exception 'incomplete command catalog'; end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='partner_hub' and p.proname in ('flow_command_rules','flow_json_path_equal','flow_json_type_tag',
      'flow_command_scope_valid','flow_command_targets_valid','flow_command_boundary_valid')) <> 6 then raise exception 'missing command functions'; end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='partner_hub' and p.proname like 'flow_%' and
      (p.prosecdef or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))) then
    raise exception 'unexpected browser/security-definer function privilege';
  end if;
  original := '{"caseId":"synthetic-case","partnerId":"synthetic-partner","revision":0,"updatedAt":"2026-09-09T12:00:00.000Z",
    "company":"가상기업","partnerName":"가상담당","reports":[],"files":[],"analysis":{"reportId":""},"meetings":[],"recordings":[],
    "requests":[{"id":"target","status":"received","title":"가상서류"}],"payments":[],"ai":{"enabled":false,"sourceText":""},"audit":[],"jobs":[],"commandIds":[]}'::jsonb::json;
  commanded := (original::jsonb || jsonb_build_object('revision',1,'updatedAt',stamp,'commandIds',jsonb_build_array(command_id),
    'audit',jsonb_build_array(jsonb_build_object('id',command_id,'at',stamp,'actor','가상관리자','action','review_document','detail','합성 검사')),
    'commandReceipts',jsonb_build_object(command_id,jsonb_build_object('actorKey','admin:primary','fingerprint',repeat('a',64),'actor','가상관리자','action','review_document','targetId','target')),
    'requests',jsonb_build_array(jsonb_build_object('id','target','status','verified','title','가상서류','reviewedAt',stamp))))::json;
  if not partner_hub.flow_command_boundary_valid(original::text,commanded::text,'synthetic-case','synthetic-partner',1,stamp)
    then raise exception 'valid command boundary rejected'; end if;
  changed := jsonb_set(commanded::jsonb,'{payments}','[{"id":"forged-payment"}]')::json;
  if partner_hub.flow_command_boundary_valid(original::text,changed::text,'synthetic-case','synthetic-partner',1,stamp)
    then raise exception 'out-of-scope payment accepted'; end if;
  changed := jsonb_set(commanded::jsonb,'{requests,0,title}','"rewritten"')::json;
  if partner_hub.flow_command_boundary_valid(original::text,changed::text,'synthetic-case','synthetic-partner',1,stamp)
    then raise exception 'immutable request property rewrite accepted'; end if;
  changed := jsonb_set(commanded::jsonb,array['commandReceipts',command_id,'targetId'],'"wrong-target"')::json;
  if partner_hub.flow_command_boundary_valid(original::text,changed::text,'synthetic-case','synthetic-partner',1,stamp)
    then raise exception 'wrong receipt target accepted'; end if;
  changed := jsonb_set(commanded::jsonb,'{requests,0,reviewedAt}','null')::json;
  if partner_hub.flow_command_boundary_valid(original::text,changed::text,'synthetic-case','synthetic-partner',1,stamp)
    then raise exception 'missing review timestamp accepted'; end if;
  if partner_hub.flow_command_boundary_valid(null,commanded::text,'synthetic-case','synthetic-partner',1,stamp)
    then raise exception 'initial command injection accepted'; end if;
end;
$probe$;
rollback;
