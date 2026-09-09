begin;
set local role service_role;
set local statement_timeout='25s';
do $$
declare initial json; proposed json; forged json; stored text; rejected boolean:=false;
  stamp text:='2026-09-10T00:00:00.000Z';
begin
  -- Initial target only. Never touch an existing operational FLOW dataset.
  if exists(select 1 from partner_hub.consulting_flows) then raise exception 'probe requires empty FLOW root'; end if;
  perform partner_hub.assert_consulting_flow_schema();
  initial:='{"schemaVersion":1,"caseId":"synthetic-root-probe","company":"가상기업","partnerId":"synthetic-partner","partnerName":"가상담당","revision":0,"updatedAt":"","reports":[],"files":[],"analysis":{"reportId":""},"meetings":[],"recordings":[],"requests":[],"payments":[],"ai":{"enabled":false,"sourceText":""},"jobs":[],"audit":[],"commandIds":[]}'::json;
  proposed:=partner_hub.flow_json_object_edit(initial,json_build_object('revision',1,'updatedAt',stamp,
    'ai',json_build_object('enabled',false,'sourceText','실제 업무 자료가 아닌 롤백 검사용 합성 입력입니다.'),
    'commandIds',json_build_array('synthetic-root-command'),
    'commandReceipts',json_build_object('synthetic-root-command',json_build_object('actorKey','admin:primary','fingerprint',repeat('a',64),'actor','김성민 대표','action','save_source')),
    'audit',json_build_array(json_build_object('id','synthetic-root-command','at',stamp,'actor','김성민 대표','action','save_source','detail','합성 자료 입력'))));
  insert into partner_hub.consulting_flows values ('synthetic-root-probe','synthetic-partner',0,initial::text,'');
  update partner_hub.consulting_flows set revision=1,payload=proposed::text,updated_at=stamp where case_id='synthetic-root-probe';
  -- Exercise deferred constraints before ROLLBACK; rollback alone never fires them.
  set constraints all immediate;
  select payload into stored from partner_hub.consulting_flows where case_id='synthetic-root-probe';
  if stored is distinct from proposed::text then raise exception 'payload text was rewritten'; end if;
  forged:=partner_hub.flow_json_object_edit(proposed,json_build_object('revision',2,'company','위조 회사'));
  begin
    update partner_hub.consulting_flows set revision=2,payload=forged::text where case_id='synthetic-root-probe';
  exception when check_violation then rejected:=true;
  end;
  if not rejected then raise exception 'uncommanded business rewrite accepted'; end if;
  if (select payload from partner_hub.consulting_flows where case_id='synthetic-root-probe') is distinct from stored then raise exception 'failed update was not atomic'; end if;
  if partner_hub.flow_dashboard_payload(proposed)::jsonb ?| array['files','audit','jobs','commandReceipts','commandIds']
    or partner_hub.flow_dashboard_payload(proposed)::jsonb #> '{ai,sourceText}' is not null then raise exception 'projection leaked hidden fields'; end if;
  if has_table_privilege('anon','partner_hub.consulting_flows','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    or has_table_privilege('authenticated','partner_hub.consulting_flows','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    or has_function_privilege('anon','partner_hub.flow_root_transition_valid(text,text,text,text,bigint,text)','EXECUTE')
    or has_function_privilege('authenticated','partner_hub.flow_root_transition_valid(text,text,text,text,bigint,text)','EXECUTE')
    or has_table_privilege('service_role','partner_hub.consulting_flows','TRUNCATE') then raise exception 'unsafe FLOW privileges'; end if;
end;
$$;
rollback;
