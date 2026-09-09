import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { postgresFixture } from './supabase-postgres-fixture';
import { newConsultingFlow, type ConsultingFlow } from '../lib/consulting-flow';
import * as schema from '../db/schema';

type FlowProbe = Omit<ConsultingFlow, 'jobs'> & { jobs: Array<Record<string, unknown>> };
const time = '2026-09-09T12:00:00.000Z';
const nextTime = '2026-09-09T12:01:00.000Z';
const initial = (): FlowProbe => ({ ...newConsultingFlow('synthetic-flow-case', '가상기업', 'synthetic-partner', '가상담당'), updatedAt: time });
const advance = (value: FlowProbe): FlowProbe => ({ ...structuredClone(value), revision: value.revision + 1, updatedAt: nextTime });
function command(previous: FlowProbe, id = 'synthetic-command-001', action = 'set_ai_policy'): FlowProbe {
  const proposed = advance(previous);
  proposed.commandIds.push(id);
  proposed.audit.push({ id, at: proposed.updatedAt, actor: '가상관리자', action, detail: '합성 검사' });
  proposed.commandReceipts = { ...proposed.commandReceipts, [id]: { actorKey: 'admin:primary', fingerprint: 'a'.repeat(64), actor: '가상관리자', action } };
  return proposed;
}
const raw = (value: unknown) => value === null ? null : typeof value === 'string' ? value : JSON.stringify(value);
async function valid(engine: Awaited<ReturnType<typeof postgresFixture>>['engine'], sql: string, parameters: unknown[]) {
  return (await engine.query<{ valid: boolean }>(sql, parameters)).rows[0].valid;
}

// Compare the explicitly ported guard subset, NOT all FLOW command semantics.
// Fixtures are inserted before triggers, so historical roots/job states can be
// tested without claiming that an initial application INSERT could create them.
const coreTriggers = [
  schema.consultingFlowsIdentityTriggerSql, schema.consultingFlowsTransitionTriggerSql,
  schema.consultingFlowsAuditAppendOnlyTriggerSql, schema.consultingFlowsAuditCardinalityTriggerSql,
  schema.consultingFlowsCommandCardinalityTriggerSql, schema.consultingFlowsCommandAiTransitionTriggerSql,
  schema.consultingFlowsCommandHistoryTriggerSql, schema.consultingFlowsCommandSemanticsTriggerSql,
  schema.consultingFlowsNewCommandEvidenceTriggerSql, schema.consultingFlowsCommandReceiptOriginTriggerSql,
  schema.consultingFlowsNewCommandReceiptTargetTriggerSql, schema.consultingFlowsCommandReceiptTargetHistoryTriggerSql,
  schema.consultingFlowsJobsTransitionTriggerSql, schema.consultingFlowsJobCreationCommandTriggerSql,
  schema.consultingFlowsJobCreationOriginTriggerSql, schema.consultingFlowsJobCreationAuditIdentityTriggerSql,
  schema.consultingFlowsJobTransitionAuditTriggerSql,
];
const jobTriggers = [
  schema.consultingFlowsJobIdentityTriggerSql, schema.consultingFlowsJobStatusTriggerSql,
  schema.consultingFlowsJobLifecycleTriggerSql, schema.consultingFlowsJobTransitionTimestampTriggerSql,
  schema.consultingFlowsSuccessEvidenceTriggerSql, schema.consultingFlowsFailureHistoryTriggerSql,
  schema.consultingFlowsFailureEvidenceTriggerSql,
];
function sqliteAllows(previous: FlowProbe | string, proposed: FlowProbe | string, triggers = [...coreTriggers, ...jobTriggers]) {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(schema.consultingFlowsTableSql);
    const row = typeof previous === 'string' ? JSON.parse(previous) as FlowProbe : previous;
    const next = typeof proposed === 'string' ? JSON.parse(proposed) as FlowProbe : proposed;
    sqlite.prepare('INSERT INTO consulting_flows VALUES (?,?,?,?,?)').run(row.caseId, row.partnerId, row.revision, raw(previous), row.updatedAt);
    triggers.forEach((sql) => sqlite.exec(sql));
    try {
      sqlite.prepare('UPDATE consulting_flows SET case_id=?,partner_id=?,revision=?,payload=?,updated_at=?')
        .run(next.caseId, next.partnerId, next.revision, raw(proposed), next.updatedAt);
      return true;
    } catch { return false; }
  } finally { sqlite.close(); }
}

void test('PostgreSQL FLOW JSON history matches SQLite spelling without exposing a partially guarded root', async (t) => {
  const { db, engine, close } = await postgresFixture();
  t.after(close);
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const corpus = [
    ' { "b" : 1, "a" : [ true, null, 1.00, 1e+2, -0 ] } ',
    '{"text":"space  stays \\t \\n \\\" \\\\ end"}',
    '{"text":"\\u0061","other":"a","slash":"\\/"}',
    '[ "가상 😀", { "nested" : "{ [ \\" }" } ]',
    '\r\n [ 0, false, "" ]\t ', '" spaced "', 'null', '1e+10',
  ];
  for (const value of corpus) {
    const expected = sqlite.prepare('SELECT json(?) AS value').get(value)!.value;
    assert.equal(await db.prepare('SELECT partner_hub.flow_json_compact(?1::json) AS value').bind(value).first('value'), expected, value);
  }
  for (const value of ['{"x":1,"x":1}', '{"x":{"a":1,"\\u0061":1}}', '{"x":[{"k":1,"k":2}]}',
    '{"text":"\\ud800"}', '{"text":"\\u0000"}'])
    assert.equal(await valid(engine, 'SELECT partner_hub.flow_json_unique_keys($1::json) AS valid', [value]), false, value);
  assert.equal(await valid(engine, 'SELECT partner_hub.flow_json_unique_keys($1::json) AS valid', ['{"text":"😀","nested":[{},[]]}']), true);
  await engine.exec('SET ROLE service_role');
  assert.equal(await db.prepare("SELECT partner_hub.flow_json_compact(' {\"x\": 1}'::json) AS value").first('value'), '{"x":1}');
  assert.equal(await db.prepare("SELECT to_regclass('partner_hub.consulting_flows')::text AS name").first('name'), null);
  await assert.rejects(db.prepare("INSERT INTO consulting_flows VALUES ('must-not-exist')").run(), /OPERATION_FAILED/);
  await engine.exec('RESET ROLE');
  for (const role of ['anon', 'authenticated']) {
    await engine.exec(`SET ROLE ${role}`);
    await assert.rejects(engine.query("SELECT partner_hub.flow_json_compact('{}'::json)"), /permission denied/);
    await engine.exec('RESET ROLE');
    const privileges = await engine.query<{ allowed: boolean }>(`SELECT bool_or(has_function_privilege($1, p.oid, 'execute')) AS allowed
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='partner_hub' AND p.proname LIKE 'flow_%'`, [role]);
    assert.equal(privileges.rows[0].allowed, false);
  }
});

void test('PostgreSQL FLOW core insert, envelope and structural boundaries fail closed', async (t) => {
  const { engine, close } = await postgresFixture();
  t.after(close);
  const check = (previous: unknown, proposed: unknown, row = initial()) => valid(engine,
    'SELECT partner_hub.flow_core_transition_valid($1,$2,$3,$4,$5,$6) AS valid',
    [raw(previous), raw(proposed), row.caseId, row.partnerId, row.revision, row.updatedAt]);
  assert.equal(await check(null, initial()), true);
  assert.equal(await check(null, { ...initial(), commandReceipts: {} }), true);
  for (const proposed of [null, 'null', '[]', '{broken', {},
    { ...initial(), revision: 0.5 }, { ...initial(), revision: '0' },
    { ...initial(), caseId: 1 }, { ...initial(), partnerId: 'reassigned' }, { ...initial(), updatedAt: nextTime },
    { ...initial(), jobs: null }, { ...initial(), audit: {} }, { ...initial(), commandIds: {} },
    { ...initial(), commandReceipts: null }, { ...initial(), commandReceipts: [] },
    { ...initial(), commandReceipts: { forged: { actorKey: 'admin:primary', fingerprint: 'x' } } },
    command(initial()), { ...initial(), jobs: [{ id: 'job', status: 'queued', stage: 1, createdAt: time, reason: '' }] },
    JSON.stringify(initial()).replace('"revision":0', '"revision":0,"revision":0'),
    JSON.stringify(initial()).replace('"revision":0', '"revision":0.0'),
    JSON.stringify(initial()).replace('가상기업', '\\ud800'),
  ]) assert.equal(await check(null, proposed), false, raw(proposed) ?? 'SQL NULL');
  const previous = command(initial());
  const proposed = advance(previous);
  assert.equal(await check(previous, proposed, proposed), true);
  assert.equal(await check({ ...initial(), revision: -1 }, initial()), false);
  assert.equal(await check({ ...previous, updatedAt: null }, proposed, proposed), false);
  assert.equal(await check({ ...previous, caseId: 1 }, { ...proposed, caseId: '1' }, { ...proposed, caseId: '1' }), false);
  for (const changed of [
    { ...proposed, revision: previous.revision }, { ...proposed, revision: proposed.revision + 1 },
    { ...proposed, caseId: 'reassigned' }, { ...proposed, partnerId: 'reassigned' },
    { ...proposed, commandIds: [...previous.commandIds, ...previous.commandIds] },
    { ...proposed, audit: [...previous.audit, ...previous.audit] },
    { ...proposed, commandReceipts: { [previous.commandIds[0]]: { ...previous.commandReceipts![previous.commandIds[0]], actor: null } } },
    { ...proposed, commandIds: Array(2001).fill('command') },
    { ...proposed, jobs: Array(2001).fill({}) }, { ...proposed, audit: Array(4001).fill({}) },
  ]) assert.equal(await check(previous, changed, changed as FlowProbe), false);
});

void test('PostgreSQL FLOW command/audit/history guards agree with selected original SQLite triggers', async (t) => {
  const { engine, close } = await postgresFixture();
  t.after(close);
  async function compare(previous: FlowProbe | string, proposed: FlowProbe | string, expected: boolean, label: string) {
    const row = typeof proposed === 'string' ? JSON.parse(proposed) as FlowProbe : proposed;
    assert.equal(sqliteAllows(previous, proposed), expected, `SQLite: ${label}`);
    const actual = await valid(engine, 'SELECT partner_hub.flow_core_transition_valid($1,$2,$3,$4,$5,$6) AS valid',
      [raw(previous), raw(proposed), row.caseId, row.partnerId, row.revision, row.updatedAt]);
    assert.equal(actual, expected, `PostgreSQL: ${label}`);
  }
  const old = command(initial());
  const next = command(old, 'synthetic-command-002');
  await compare(initial(), old, true, 'first guarded command');
  await compare(old, next, true, 'second command');
  await compare(old, advance(old), true, 'core layer only: domain/no-command rules still required');
  const mutations: Array<[string, (next: FlowProbe) => void]> = [
    ['erase command prefix', (f) => { f.commandIds.shift(); }],
    ['reorder commands', (f) => { f.commandIds.reverse(); }],
    ['erase audit prefix', (f) => { f.audit.shift(); }],
    ['change audit history', (f) => { f.audit[0].detail = 'changed'; }],
    ['extra audit', (f) => { f.audit.push({ ...f.audit[1], id: 'unrelated' }); }],
    ['missing new audit', (f) => { f.audit.pop(); }],
    ['stale command timestamp', (f) => { f.audit[1].at = time; }],
    ['user command cannot be AI result', (f) => { f.audit[1].action = 'ai_result'; f.commandReceipts![f.commandIds[1]].action = 'ai_result'; }],
    ['missing new receipt', (f) => { delete f.commandReceipts![f.commandIds[1]]; }],
    ['missing old receipt', (f) => { delete f.commandReceipts![f.commandIds[0]]; }],
    ['receipt without new command', (f) => { f.commandReceipts!['forged'] = f.commandReceipts![f.commandIds[1]]; }],
    ['receipt actor mismatch', (f) => { f.commandReceipts![f.commandIds[1]].actor = 'other'; }],
    ['receipt action mismatch', (f) => { f.commandReceipts![f.commandIds[1]].action = 'other'; }],
    ['unneeded receipt target', (f) => { f.commandReceipts![f.commandIds[1]].targetId = 'meeting'; }],
    ['missing needed receipt target', (f) => { f.audit[1].action = 'complete_meeting'; f.commandReceipts![f.commandIds[1]].action = 'complete_meeting'; }],
    ['two new commands', (f) => { f.commandIds.push('synthetic-command-003'); }],
  ];
  for (const field of ['actorKey', 'fingerprint', 'actor', 'action', 'targetId'] as const)
    mutations.push([`immutable receipt ${field}`, (f) => { f.commandReceipts![f.commandIds[0]][field] = 'changed'; }]);
  for (const [label, mutate] of mutations) {
    const changed = structuredClone(next); mutate(changed);
    await compare(old, changed, false, label);
  }
  const targeted = command(old, 'synthetic-command-002', 'complete_meeting');
  targeted.commandReceipts![targeted.commandIds[1]].targetId = 'synthetic-meeting';
  await compare(old, targeted, true, 'target shape, not yet target domain authority');
  await compare(old, JSON.stringify(next, null, 2), true, 'whitespace-only serialization');
  const rawNext = JSON.stringify(next);
  const auditText = JSON.stringify(next.audit[0]);
  await compare(old, rawNext.replace(auditText, JSON.stringify(Object.fromEntries(Object.entries(next.audit[0]).reverse()))), false, 'audit key order');
  await compare(old, rawNext.replace('합성 검사', '\\ud569성 검사'), false, 'audit escape spelling');
  const legacy = structuredClone(old);
  delete legacy.commandReceipts![legacy.commandIds[0]].actor;
  delete legacy.commandReceipts![legacy.commandIds[0]].action;
  await compare(legacy, command(legacy, 'synthetic-command-002'), true, 'legacy receipt preserved');
});

void test('PostgreSQL FLOW job lifecycle and evidence archival match SQLite across every status pair', async (t) => {
  const { engine, close } = await postgresFixture();
  t.after(close);
  const states = ['queued', 'processing', 'blocked', 'failed', 'complete'] as const;
  type Status = typeof states[number];
  const evidence = { auditId: 'synthetic-audit', providerRequestId: 'synthetic-provider' };
  function job(status: Status): Record<string, unknown> {
    return { id: 'synthetic-command-001-job', stage: 1, status, reason: ['failed', 'blocked'].includes(status) ? '합성 사유' : '', createdAt: time,
      ...(['processing', 'failed', 'complete'].includes(status) ? { startedAt: time } : {}),
      ...(status === 'failed' ? { failureEvidence: evidence } : {}),
      ...(status === 'complete' ? { completedAt: nextTime, reportId: 'synthetic-report', evidence } : {}) };
  }
  async function compare(previous: Record<string, unknown>, proposed: Record<string, unknown>, expected: boolean, label: string, sqliteExpected = expected) {
    const before = { ...initial(), jobs: [previous] };
    const after = { ...advance(before), jobs: [proposed] };
    assert.equal(sqliteAllows(before, after, [schema.consultingFlowsJobsTransitionTriggerSql, ...jobTriggers]), sqliteExpected, `SQLite subset: ${label}`);
    assert.equal(await valid(engine, 'SELECT partner_hub.flow_core_job_transition_valid($1::json,$2::json,$3) AS valid',
      [raw(previous), raw(proposed), nextTime]), expected, `PostgreSQL: ${label}`);
  }
  for (const oldStatus of states) for (const newStatus of states) {
    const previous = job(oldStatus);
    const proposed = oldStatus === newStatus ? structuredClone(previous) : job(newStatus);
    if (oldStatus !== newStatus && newStatus === 'processing') proposed.startedAt = nextTime;
    if (oldStatus === 'processing' && newStatus === 'blocked') proposed.startedAt = previous.startedAt;
    if (oldStatus === 'failed' && newStatus === 'queued') proposed.failureEvidenceHistory = [evidence];
    const expected = oldStatus === newStatus || (oldStatus === 'queued' && ['processing', 'blocked'].includes(newStatus))
      || (['blocked', 'failed'].includes(oldStatus) && newStatus === 'queued') || oldStatus === 'processing';
    await compare(previous, proposed, expected, `${oldStatus} -> ${newStatus}`);
  }
  const processing = job('processing');
  const complete = job('complete');
  for (const field of ['id', 'stage', 'createdAt', 'sourceRecordingId', 'sourceReportId', 'startedAt', 'completedAt', 'reportId', 'reason']) {
    const changed = { ...complete, [field]: field === 'stage' ? 4 : 'changed' };
    // reportId is domain-bound in a later layer, but cannot change once complete.
    await compare(complete, changed, false, `completed immutable ${field}`);
  }
  for (const field of ['completedAt', 'reportId', 'evidence']) {
    const changed = { ...complete }; delete changed[field];
    // The isolated SQLite lifecycle trigger can yield SQL UNKNOWN for missing
    // reportId/evidence. Its application/full-schema checks are separate. The
    // native core must explicitly reject absence, not reproduce this SQL hole.
    await compare(processing, changed, false, `completion requires ${field}`, field !== 'completedAt');
  }
  await compare(processing, { ...complete, completedAt: time }, false, 'completion timestamp');
  await compare(job('queued'), processing, false, 'start timestamp');
  await compare(processing, { ...job('blocked'), startedAt: time }, true, 'blocked keeps attempt start');
  await compare({ ...job('blocked'), startedAt: time }, job('blocked'), true, 'blocked may clear attempt start');
  const failed = { ...job('failed'), failureEvidenceHistory: [{ auditId: 'older', providerRequestId: 'old-request' }] };
  const retry = { ...job('queued'), failureEvidenceHistory: [...failed.failureEvidenceHistory, evidence] };
  await compare(failed, retry, true, 'retry archives exact failure once');
  await compare(failed, job('queued'), false, 'retry cannot erase history');
  await compare(failed, { ...retry, failureEvidenceHistory: [...retry.failureEvidenceHistory, evidence] }, false, 'retry cannot duplicate archive');
  await compare(failed, { ...retry, failureEvidence: null }, false, 'null is not absence');
  await compare(failed, { ...retry, failureEvidenceHistory: [evidence, ...failed.failureEvidenceHistory] }, false, 'archive order');
  await compare(complete, { ...complete, evidence: { providerRequestId: 'synthetic-provider', auditId: 'synthetic-audit' } }, false, 'success evidence key order');
  await compare(failed, { ...retry, failureEvidenceHistory: [...failed.failureEvidenceHistory, { providerRequestId: 'synthetic-provider', auditId: 'synthetic-audit' }] }, false, 'archived failure key order');
});

void test('PostgreSQL FLOW core binds new jobs to new commands and counts internal AI audit separately', async (t) => {
  const { engine, close } = await postgresFixture();
  t.after(close);
  const check = async (previous: FlowProbe, proposed: FlowProbe, expected: boolean) => {
    assert.equal(sqliteAllows(previous, proposed), expected);
    assert.equal(await valid(engine, 'SELECT partner_hub.flow_core_transition_valid($1,$2,$3,$4,$5,$6) AS valid',
      [raw(previous), raw(proposed), proposed.caseId, proposed.partnerId, proposed.revision, proposed.updatedAt]), expected);
  };
  const queued = command(initial(), 'synthetic-command-001', 'queue_report1');
  queued.jobs = [{ id: 'synthetic-command-001-job', stage: 1, status: 'queued', reason: '', createdAt: nextTime }];
  await check(initial(), queued, true);
  await check(initial(), { ...queued, jobs: [{ ...queued.jobs[0], id: 'unrelated-job' }] }, false);
  await check(initial(), { ...queued, jobs: [{ ...queued.jobs[0], failureEvidenceHistory: [] }] }, false);
  await check(initial(), { ...queued, jobs: [{ ...queued.jobs[0], createdAt: time }] }, false);
  await check(initial(), { ...queued, jobs: [{ ...queued.jobs[0], sourceRecordingId: 'unneeded-source' }] }, false);
  const wrongAction = structuredClone(queued);
  wrongAction.audit[0].action = 'set_ai_policy';
  wrongAction.commandReceipts![wrongAction.commandIds[0]].action = 'set_ai_policy';
  await check(initial(), wrongAction, false);
  const processing = advance(queued);
  processing.jobs[0] = { ...processing.jobs[0], status: 'processing', startedAt: nextTime };
  await check(queued, processing, true);
  await check(queued, { ...command(queued, 'synthetic-command-002'), jobs: processing.jobs }, false);
  await check(processing, { ...advance(processing), jobs: [] }, false);
  const failed = advance(processing);
  failed.jobs[0] = { ...failed.jobs[0], status: 'failed', reason: '합성 실패', failureEvidence: { auditId: 'synthetic-failure' } };
  await check(processing, failed, false);
  failed.audit.push({ id: `${String(failed.jobs[0].id)}-${nextTime}`, at: nextTime, actor: '보고서 자동생성', action: 'ai_result', detail: '합성 실패' });
  await check(processing, failed, true);
  for (const field of ['id', 'at', 'actor', 'action'] as const) {
    const changed = structuredClone(failed); changed.audit.at(-1)![field] = 'changed';
    await check(processing, changed, false);
  }
  const retry = command(failed, 'synthetic-command-002', 'retry_job');
  retry.jobs[0] = { ...queued.jobs[0], failureEvidenceHistory: [failed.jobs[0].failureEvidence] };
  await check(failed, retry, true);
  const unloggedRetry = { ...advance(failed), jobs: retry.jobs };
  await check(failed, unloggedRetry, false);
  await check(processing, { ...command(processing, 'synthetic-command-002'), jobs: failed.jobs, audit: [...failed.audit,
    { id: 'synthetic-command-002', at: nextTime, actor: '가상관리자', action: 'set_ai_policy', detail: '합성 검사' }] }, false);
  const report4 = command(initial(), 'synthetic-command-001', 'save_recording');
  report4.recordings = ['earlier-recording', 'latest-recording'].map((id) => ({ id, meetingId: 'synthetic-meeting', transcript: '가상 전사', consentAt: time, createdAt: time }));
  report4.reports = ['earlier-report', 'latest-report'].map((id) => ({ id, stage: 1, version: 1, title: '합성 보고', body: '합성 본문', createdAt: time, createdBy: '가상관리자', origin: 'manual' }));
  report4.jobs = [{ ...queued.jobs[0], stage: 4, sourceRecordingId: 'latest-recording', sourceReportId: 'latest-report' }];
  await check(initial(), report4, true);
  await check(initial(), { ...report4, jobs: [{ ...report4.jobs[0], sourceRecordingId: 'earlier-recording' }] }, false);
  await check(initial(), { ...report4, jobs: [{ ...report4.jobs[0], sourceReportId: 'earlier-report' }] }, false);
  await check(initial(), { ...report4, recordings: [] }, false);
  await check(initial(), { ...report4, reports: [] }, false);
});

void test('remote FLOW core-only read-only probe runs on the complete PostgreSQL migration fixture', async (t) => {
  const { engine, close } = await postgresFixture();
  t.after(close);
  await engine.exec(await readFile(new URL('./supabase-flow-core-probe.sql', import.meta.url), 'utf8'));
  assert.equal((await engine.query<{ n: number }>('SELECT count(*)::integer AS n FROM partner_hub.portal_state')).rows[0].n, 0);
});
