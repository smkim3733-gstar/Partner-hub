-- Pure-function / catalog probe. No business rows, accounts, objects or AI calls.
-- Valid only while FLOW root writes have intentionally not been exposed.
begin;
set local statement_timeout = '25s';
set local role service_role;
do $probe$
declare
  original text := '{"caseId":"synthetic-flow-case","partnerId":"synthetic-partner","revision":0,"updatedAt":"2026-09-09T12:00:00.000Z","audit":[],"commandIds":[],"jobs":[]}';
  commanded text; processing text; changed text;
  stamp text := '2026-09-09T12:01:00.000Z';
  command_id text := 'synthetic-command-001';
begin
  if to_regclass('partner_hub.consulting_flows') is not null then
    raise exception 'FLOW core-only probe is not a whole-runtime readiness check';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='partner_hub' and p.proname in ('flow_json_compact', 'flow_json_unique_keys',
      'flow_json_field_equal', 'flow_json_array_prefix', 'flow_core_shape_valid',
      'flow_core_job_transition_valid', 'flow_core_transition_valid')) <> 7 then
    raise exception 'missing native core functions';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='partner_hub' and p.proname like 'flow_%' and
      (p.prosecdef or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))) then
    raise exception 'unexpected browser or security-definer function privilege';
  end if;
  if partner_hub.flow_json_compact(' { "b":1.00, "a":"space  stays \u0061" }'::json)
    is distinct from '{"b":1.00,"a":"space  stays \u0061"}' then raise exception 'JSON spelling drift'; end if;
  if partner_hub.flow_json_unique_keys('{"items":[{"a":1,"\u0061":2}]}'::json)
    or partner_hub.flow_json_unique_keys('{"text":"\ud800"}'::json)
    or partner_hub.flow_json_unique_keys('{"text":"\u0000"}'::json) then raise exception 'invalid JSON accepted'; end if;
  if not partner_hub.flow_core_transition_valid(null,original,'synthetic-flow-case','synthetic-partner',0,'2026-09-09T12:00:00.000Z')
    then raise exception 'empty initial core rejected'; end if;
  commanded := (original::jsonb || jsonb_build_object('revision',1,'updatedAt',stamp,
    'commandIds',jsonb_build_array(command_id),
    'audit',jsonb_build_array(jsonb_build_object('id',command_id,'at',stamp,'actor','가상관리자','action','queue_report1','detail','합성 검사')),
    'commandReceipts',jsonb_build_object(command_id,jsonb_build_object('actorKey','admin:primary','fingerprint',repeat('a',64),'actor','가상관리자','action','queue_report1')),
    'jobs',jsonb_build_array(jsonb_build_object('id',command_id||'-job','stage',1,'status','queued','reason','','createdAt',stamp))))::text;
  if not partner_hub.flow_core_transition_valid(original,commanded,'synthetic-flow-case','synthetic-partner',1,stamp)
    then raise exception 'new command/job core rejected'; end if;
  if partner_hub.flow_core_transition_valid(null,commanded,'synthetic-flow-case','synthetic-partner',1,stamp)
    then raise exception 'initial command bypass accepted'; end if;
  processing := jsonb_set(jsonb_set(jsonb_set(commanded::jsonb,'{revision}','2'),'{jobs,0,status}','"processing"'),'{jobs,0,startedAt}',to_jsonb(stamp))::text;
  if not partner_hub.flow_core_transition_valid(commanded,processing,'synthetic-flow-case','synthetic-partner',2,stamp)
    then raise exception 'internal job start core rejected'; end if;
  changed := jsonb_set(processing::jsonb,array['commandReceipts',command_id,'fingerprint'],to_jsonb(repeat('b',64)))::text;
  if partner_hub.flow_core_transition_valid(commanded,changed,'synthetic-flow-case','synthetic-partner',2,stamp)
    then raise exception 'receipt rewrite accepted'; end if;
  changed := jsonb_set(processing::jsonb,'{audit,0,detail}','"rewritten"')::text;
  if partner_hub.flow_core_transition_valid(commanded,changed,'synthetic-flow-case','synthetic-partner',2,stamp)
    then raise exception 'audit rewrite accepted'; end if;
  changed := jsonb_set(processing::jsonb,'{jobs,0,stage}','4')::text;
  if partner_hub.flow_core_transition_valid(commanded,changed,'synthetic-flow-case','synthetic-partner',2,stamp)
    then raise exception 'job identity rewrite accepted'; end if;
end;
$probe$;
rollback;
