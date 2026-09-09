-- Variables and catalogs only. No FLOW root, actual contract, account or file.
-- This tests command effects, not the still-missing full domain/auth guard.
begin;
set local statement_timeout = '25s';
set local role service_role;
do $probe$
declare original json; commanded json; changed json; payment json; item json;
  command_id text := 'synthetic-command-001'; stamp text := '2026-09-09T15:01:00.000Z';
begin
  if to_regclass('partner_hub.consulting_flows') is not null
    or to_regprocedure('partner_hub.assert_consulting_flow_schema()') is not null then
    raise exception 'Command effects do not establish whole FLOW readiness';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='partner_hub' and p.proname in ('flow_js_trim','flow_text_valid','flow_integer_valid','flow_date_only_valid',
      'flow_business_context','flow_attachment_effect_valid','flow_business_effect_valid','flow_recording_effect_valid','flow_command_effect_transition_valid')) <> 9 then
    raise exception 'Missing business effect functions';
  end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='partner_hub' and p.proname like 'flow_%' and (p.prosecdef
      or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))) then
    raise exception 'Unexpected browser/security-definer privilege';
  end if;
  original := '{"schemaVersion":1,"caseId":"synthetic-case","company":"가상기업","partnerId":"synthetic-partner","partnerName":"가상담당",
    "revision":0,"updatedAt":"2026-09-09T12:00:00.000Z","reports":[],"files":[],"analysis":{"reportId":""},"meetings":[],"recordings":[],
    "requests":[],"payments":[],"ai":{"enabled":false,"sourceText":""},"jobs":[],"audit":[],"commandIds":[],"commandReceipts":{},
    "contract":{"expectedDepositWon":1000000}}';
  payment := json_build_object('id',command_id || '-payment','amountWon',400000,'receivedAt','2026-09-10',
    'reference','합성 입금','confirmedBy','김성민 대표','recordedAt',stamp);
  commanded := partner_hub.flow_json_object_edit(original,json_build_object('revision',1,'updatedAt',stamp,
    'payments',json_build_array(payment),'commandIds',json_build_array(command_id),
    'commandReceipts',json_build_object(command_id,json_build_object('actorKey','admin:primary','fingerprint',repeat('a',64),'actor','김성민 대표','action','confirm_payment')),
    'audit',json_build_array(json_build_object('id',command_id,'at',stamp,'actor','김성민 대표','action','confirm_payment','detail','계약금 일부 입금 확인 · 잔액 대기'))));
  if not partner_hub.flow_command_effect_transition_valid(original::text,commanded::text,'synthetic-case','synthetic-partner',1,stamp) then
    raise exception 'Valid partial payment/Korea date boundary rejected';
  end if;
  changed := partner_hub.flow_json_object_edit(commanded,json_build_object('executionStartedAt',stamp));
  if partner_hub.flow_command_effect_transition_valid(original::text,changed::text,'synthetic-case','synthetic-partner',1,stamp) then
    raise exception 'Partial payment started execution';
  end if;
  foreach item in array array[
    partner_hub.flow_json_object_edit(payment,'{"amountWon":0}'),
    partner_hub.flow_json_object_edit(payment,'{"amountWon":1.5}'),
    partner_hub.flow_json_object_edit(payment,'{"amountWon":1000000000001}'),
    partner_hub.flow_json_object_edit(payment,'{"receivedAt":"2026-09-11"}'),
    partner_hub.flow_json_object_edit(payment,'{"receivedAt":"2026-02-30"}'),
    partner_hub.flow_json_object_edit(payment,'{"confirmedBy":"stranger"}')
  ] loop
    changed := partner_hub.flow_json_object_edit(commanded,json_build_object('payments',json_build_array(item)));
    if partner_hub.flow_command_effect_transition_valid(original::text,changed::text,'synthetic-case','synthetic-partner',1,stamp) then
      raise exception 'Malformed payment accepted';
    end if;
  end loop;
  if not partner_hub.flow_date_only_valid('2024-02-29') or partner_hub.flow_date_only_valid('2026-02-29')
    or partner_hub.flow_integer_valid('1e0',1,1000000000000)
    or partner_hub.flow_js_trim(chr(65279)||'한글'||chr(12288)) <> '한글' then raise exception 'Scalar semantics mismatch'; end if;
end;
$probe$;
rollback;
