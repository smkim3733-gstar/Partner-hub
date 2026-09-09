-- Pre-onboarding metadata probe. No model call or operating-data migration.
-- Roll back all synthetic records; refuse a populated target.
begin;
set transaction isolation level serializable;
set local search_path = partner_hub, pg_catalog;
set local statement_timeout = '25000ms';
set local lock_timeout = '5000ms';

do $$
declare pending text := '{"_requestFingerprint":"' || repeat('a', 64) || '"}';
  completed text;
begin
  if exists (select 1 from ai_diagnosis_runs) or exists (select 1 from portal_state)
    or exists (select 1 from standalone_admin_accounts) or exists (select 1 from portal_password_accounts) then
    raise exception 'Pre-onboarding probe refused: target already has application data';
  end if;
  perform partner_hub.assert_ai_diagnosis_schema();
  if has_schema_privilege('anon', 'partner_hub', 'USAGE')
    or has_schema_privilege('authenticated', 'partner_hub', 'USAGE')
    or has_table_privilege('anon', 'partner_hub.ai_diagnosis_runs', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    or has_table_privilege('authenticated', 'partner_hub.ai_diagnosis_runs', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    or has_table_privilege('service_role', 'partner_hub.ai_diagnosis_runs', 'DELETE,TRUNCATE') then
    raise exception 'AI run privileges leaked';
  end if;
  completed := json_build_object('_requestFingerprint', repeat('a', 64), '_providerRequestId', 'req_synthetic',
    '_providerModel', 'synthetic-provider-model', '_providerMessageId', 'msg_synthetic',
    'companyOverview', 'Synthetic company overview', 'confirmedStrengths', '[]'::json, 'mainRisks', '[]'::json,
    'solutionCandidates', '[{"solution":"Synthetic candidate","basis":"Needs review","condition":""}]'::json,
    'verificationQuestions', '[]'::json, 'missingDocuments', '[]'::json, 'complianceNotes', '[]'::json,
    'nextAction', 'Representative review required')::text;
  if not partner_hub.valid_ai_pending(pending) or not partner_hub.valid_ai_completed(completed)
    or partner_hub.valid_ai_pending(replace(pending, '{', '{"_requestFingerprint":"duplicate",'))
    or partner_hub.valid_ai_completed(replace(completed, '{', '{"companyOverview":"duplicate",'))
    or partner_hub.valid_ai_completed(replace(completed, 'Representative review required', E'\uFFFD')) then
    raise exception 'AI JSON/text validation failed';
  end if;
  insert into ai_diagnosis_runs values ('migration-ai-run-001', 'migration-ai-case', 'Synthetic company', 'Step 0',
    '생성중', 'synthetic-instruction', 'synthetic-model', pending, 0, 0, 'synthetic-admin', '2026-09-09T00:00:00.000Z');
  begin
    insert into ai_diagnosis_runs values ('migration-ai-run-002', 'migration-ai-case', 'Synthetic company', 'Step 0',
      '생성중', 'synthetic-instruction', 'synthetic-model', pending, 0, 0, 'synthetic-admin', '2026-09-09T00:00:00.000Z');
    raise exception 'Concurrent pending case accepted';
  exception when unique_violation then null;
  end;
  begin
    update ai_diagnosis_runs set status = '생성실패';
    update ai_diagnosis_runs set status = '생성중';
    raise exception 'AI failure revived';
  exception when check_violation then null;
  end;
  if (select status from ai_diagnosis_runs) <> '생성중' then
    raise exception 'AI transition rollback failed';
  end if;
  begin
    update ai_diagnosis_runs set model = 'different-model';
    raise exception 'AI identity changed';
  exception when check_violation then null;
  end;
  begin
    update ai_diagnosis_runs set status = '대표 검토 대기', result_json = completed,
      input_tokens = 1, output_tokens = 4001, created_at = '2026-09-09T00:01:00.000Z';
    raise exception 'AI usage limit bypassed';
  exception when check_violation then null;
  end;
  update ai_diagnosis_runs set status = '대표 검토 대기', result_json = completed,
    input_tokens = 10, output_tokens = 20, created_at = '2026-09-09T00:01:00.000Z';
  begin
    update ai_diagnosis_runs set result_json = result_json;
    raise exception 'Completed AI evidence changed';
  exception when check_violation then null;
  end;
  begin
    delete from ai_diagnosis_runs;
    raise exception 'Durable AI record deleted';
  exception when check_violation then null;
  end;
  insert into ai_diagnosis_runs values ('migration-ai-run-002', 'migration-ai-case', 'Synthetic company', 'Step 0',
    '생성중', 'synthetic-instruction', 'synthetic-model', pending, 0, 0, 'synthetic-admin', '2026-09-09T00:02:00.000Z');
  update ai_diagnosis_runs set status = '생성실패' where id = 'migration-ai-run-002';
end;
$$;
select 'PASS: AI private schema, one pending run, immutable evidence, usage bounds and transition rollback' as result;
rollback;
