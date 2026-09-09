-- Pure candidate states and catalogs. No tables, accounts, files or AI writes.
begin;
set local statement_timeout='25s';
set local role service_role;
do $probe$
declare candidate json; changed json;
begin
  if to_regclass('partner_hub.consulting_flows') is not null or to_regprocedure('partner_hub.assert_consulting_flow_schema()') is not null then
    raise exception 'Domain functions are not whole-runtime readiness';
  end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='partner_hub' and p.proname like 'flow_%'
    and (p.prosecdef or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))) then
    raise exception 'Unexpected public function privilege';
  end if;
  if position('''transcript'',updated_at,true' in pg_get_functiondef('partner_hub.flow_recording_effect_valid(json,json,text,text,text)'::regprocedure))=0 then
    raise exception 'Dedicated transcript receipt purpose repair missing';
  end if;
  candidate:='{"schemaVersion":1,"caseId":"synthetic-case","company":"가상기업","partnerId":"synthetic-partner","partnerName":"가상담당",
    "revision":0,"updatedAt":"2026-09-09T12:00:00.000Z","reports":[],"files":[],"analysis":{"reportId":""},"meetings":[],"recordings":[],
    "requests":[],"payments":[],"ai":{"enabled":false,"sourceText":""},"jobs":[],"audit":[],"commandIds":[],"commandReceipts":{}}';
  if not partner_hub.flow_domain_valid(candidate) then raise exception 'Valid initial domain rejected'; end if;
  changed:=partner_hub.flow_json_object_edit(candidate,'{"analysis":{"reportId":"missing-report"}}');
  if partner_hub.flow_domain_valid(changed) then raise exception 'Orphan report accepted'; end if;
  changed:=partner_hub.flow_json_object_edit(candidate,'{"unknown":true}');
  if partner_hub.flow_domain_valid(changed) then raise exception 'Unknown root field accepted'; end if;
  changed:=partner_hub.flow_json_object_edit(candidate,'{"contract":null}');
  if partner_hub.flow_domain_valid(changed) then raise exception 'Null optional object accepted'; end if;
  changed:=partner_hub.flow_json_object_edit(candidate,'{"executionStartedAt":"2026-09-09T12:00:00.000Z"}');
  if partner_hub.flow_domain_valid(changed) then raise exception 'Execution without deposit accepted'; end if;
  if partner_hub.flow_shape_time('"now"') is not null or partner_hub.flow_shape_time('"infinity"') is not null
    or partner_hub.flow_shape_time('"2026-09-09T21:00:00+09:00"') is distinct from partner_hub.flow_shape_time('"2026-09-09T12:00:00Z"') then
    raise exception 'Timestamp semantics mismatch';
  end if;
end;
$probe$;
rollback;
