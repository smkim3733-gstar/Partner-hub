import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { postgresFixture } from './supabase-postgres-fixture';
import * as schema from '../db/schema';
import { applyFlowCommand, newConsultingFlow, type ConsultingFlow, type FlowActor, type FlowCommand, type FlowFile } from '../lib/consulting-flow';
import { flowFileStorageKey } from '../lib/consulting-flow-file-policy';

type Action = keyof typeof schema.FLOW_COMMAND_EFFECT_PATHS;
type Item = Record<string, unknown>;
type Collection = 'reports' | 'meetings' | 'recordings' | 'requests' | 'payments';
type Probe = Item & {
  caseId: string; partnerId: string; revision: number; updatedAt: string;
  commandIds: string[]; commandReceipts: Record<string, Item>; audit: Item[];
  reports: Item[]; meetings: Item[]; recordings: Item[]; requests: Item[];
  payments: Item[]; files: Item[]; jobs: Item[]; ai: Item;
};
const time = '2026-09-09T12:00:00.000Z';
const stamp = '2026-09-09T12:01:00.000Z';
const id = 'synthetic-command-001';
const actions = Object.keys(schema.FLOW_COMMAND_EFFECT_PATHS) as Action[];
const collections: Collection[] = ['reports', 'meetings', 'recordings', 'requests', 'payments'];
const initial = (): Probe => ({ ...newConsultingFlow('synthetic-case', '가상기업', 'synthetic-partner', '가상담당'),
  updatedAt: time, commandReceipts: {} }) as unknown as Probe;
const raw = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value);
function command(previous: Probe, action: string, targetId?: string): Probe {
  const proposed = structuredClone(previous);
  proposed.revision++; proposed.updatedAt = stamp;
  proposed.commandIds.push(id);
  proposed.commandReceipts[id] = { actorKey: 'admin:primary', fingerprint: 'a'.repeat(64), actor: '가상관리자', action, ...(targetId ? { targetId } : {}) };
  proposed.audit.push({ id, at: stamp, actor: '가상관리자', action, detail: '합성 검사' });
  return proposed;
}
function setPath(value: Item, path: string, replacement: unknown) {
  const parts = path.replace(/^\$\./, '').split('.');
  let target = value;
  for (const part of parts.slice(0, -1)) target = target[part] as Item;
  target[parts.at(-1)!] = replacement;
}
function sqliteAllows(previous: Probe | string, proposed: Probe | string, triggers: string[]) {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(schema.consultingFlowsTableSql);
    const before = typeof previous === 'string' ? JSON.parse(previous) as Probe : previous;
    const after = typeof proposed === 'string' ? JSON.parse(proposed) as Probe : proposed;
    sqlite.prepare('INSERT INTO consulting_flows VALUES (?,?,?,?,?)')
      .run(before.caseId, before.partnerId, before.revision, raw(previous), before.updatedAt);
    triggers.forEach((sql) => sqlite.exec(sql));
    try {
      sqlite.prepare('UPDATE consulting_flows SET revision=?,payload=?,updated_at=?')
        .run(after.revision, raw(proposed), after.updatedAt);
      return true;
    } catch { return false; }
  } finally { sqlite.close(); }
}
type Engine = Awaited<ReturnType<typeof postgresFixture>>['engine'];
async function valid(engine: Engine, sql: string, args: unknown[]) {
  return (await engine.query<{ valid: boolean }>(sql, args)).rows[0].valid;
}
const scope = (engine: Engine, before: unknown, after: unknown, action: string) =>
  valid(engine, 'SELECT partner_hub.flow_command_scope_valid($1::json,$2::json,$3) AS valid', [raw(before), raw(after), action]);
const targets = (engine: Engine, before: unknown, after: unknown, action: string) =>
  valid(engine, 'SELECT partner_hub.flow_command_targets_valid($1::json,$2::json,$3,$4,$5) AS valid', [raw(before), raw(after), id, action, stamp]);
const boundary = (engine: Engine, before: unknown, after: unknown, row: Pick<ConsultingFlow, 'caseId' | 'partnerId' | 'revision' | 'updatedAt'>) =>
  valid(engine, 'SELECT partner_hub.flow_command_boundary_valid($1,$2,$3,$4,$5,$6) AS valid',
    [before === null ? null : raw(before), raw(after), row.caseId, row.partnerId, row.revision, row.updatedAt]);

void test('PostgreSQL command rule catalog covers every existing effect, state scope and target rule', async (t) => {
  const { engine, close } = await postgresFixture(); t.after(close);
  const expected = Object.fromEntries(actions.map((action) => [action, {
    effects: schema.FLOW_COMMAND_EFFECT_PATHS[action].map((path) => path.slice(2)),
    scope: schema.FLOW_COMMAND_STATE_SCOPE_PATHS[action].map((path) => path.slice(2)),
    targets: schema.FLOW_COMMAND_TARGET_RULES[action],
  }]));
  const actual = (await engine.query<{ rules: unknown }>('SELECT partner_hub.flow_command_rules() AS rules')).rows[0].rules;
  assert.equal(actions.length, 21);
  assert.deepEqual(actual, expected);
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  for (const value of ['null', 'false', 'true', '"x"', '[]', '{}', '1', '1.0', '1e0', '-0', ' 1\r\n', ' 1.0\t', '9223372036854775807', '9223372036854775808']) {
    const actualType = (await engine.query<{ tag: string }>('SELECT partner_hub.flow_json_type_tag($1::json) AS tag', [value])).rows[0].tag;
    const sqliteType = sqlite.prepare('SELECT json_type(?) AS tag').get(value)!.tag;
    assert.equal(actualType, sqliteType === 'text' ? 'string' : sqliteType === 'true' || sqliteType === 'false' ? 'boolean' : sqliteType, value);
  }
});

void test('all 21 command scopes and required effects agree with original SQLite across 18 state paths', async (t) => {
  const { engine, close } = await postgresFixture(); t.after(close);
  const changes: Record<string, unknown> = {
    '$.company': '다른기업', '$.partnerName': '다른담당', '$.reports': [{ id: 'changed' }], '$.files': [{ id: 'changed' }],
    '$.analysis': { reportId: 'changed' }, '$.meetings': [{ id: 'changed' }], '$.recordings': [{ id: 'changed' }],
    '$.requests': [{ id: 'changed' }], '$.decision': { note: 'changed' }, '$.contract': { meetingId: 'changed' },
    '$.payments': [{ id: 'changed' }], '$.executionStartedAt': stamp, '$.aftercare': { summary: 'changed' },
    '$.ai.enabled': true, '$.ai.approvedAt': stamp, '$.ai.approvedBy': 'changed', '$.ai.sourceText': 'changed', '$.jobs': [{ id: 'changed' }],
  };
  const triggers = [schema.consultingFlowsCommandScopeTriggerSql, schema.consultingFlowsCommandEffectTriggerSql];
  for (const action of actions) {
    const before = initial();
    assert.equal(await scope(engine, before, command(before, action), action), false, `${action}: no effect`);
    for (const [path, replacement] of Object.entries(changes)) {
      const after = command(before, action); setPath(after, path, replacement);
      const allowed: readonly string[] = schema.FLOW_COMMAND_STATE_SCOPE_PATHS[action];
      const effect = schema.FLOW_COMMAND_EFFECT_PATHS[action].some((effectPath) => path === effectPath || path.startsWith(`${effectPath}.`));
      const expected = allowed.includes(path) && effect;
      assert.equal(sqliteAllows(before, after, triggers), expected, `SQLite ${action}: ${path}`);
      assert.equal(await scope(engine, before, after, action), expected, `PostgreSQL ${action}: ${path}`);
    }
  }
  const before = initial(); const after = command(before, 'set_ai_policy');
  after.ai.enabled = true; after.jobs.push({ id: 'allowed-secondary-change' });
  assert.equal(await scope(engine, before, after, 'set_ai_policy'), true);
  after.ai.sourceText = 'unrelated change';
  assert.equal(await scope(engine, before, after, 'set_ai_policy'), false);
  assert.equal(await scope(engine, before, after, 'unknown'), false);
  assert.equal(await scope(engine, before, after, 'SET_AI_POLICY'), false);
});

void test('append command targets preserve ordered history and bind exactly one new row to the command ID', async (t) => {
  const { engine, close } = await postgresFixture(); t.after(close);
  for (const action of actions) for (const collection of collections) {
    const rule = schema.FLOW_COMMAND_TARGET_RULES[action][collection];
    if (rule?.kind !== 'append') continue;
    const before = initial();
    for (const name of collections) before[name] = [{ id: `${name}-a`, note: 'unchanged' }, { id: `${name}-b`, note: 'unchanged' }];
    const after = command(before, action);
    after[collection].push({ id: `${id}-${rule.idSuffix}`, note: 'new' });
    assert.equal(await targets(engine, before, after, action), true, action);
    assert.equal(sqliteAllows(before, after, [schema.consultingFlowsCommandTargetTriggerSql]), true);
    const attacks: Array<(value: Probe) => void> = [
      (v) => { v[collection].at(-1)!.id = 'wrong-command-row'; },
      (v) => { v[collection].push({ id: 'extra-row' }); },
      (v) => { v[collection].shift(); },
      (v) => { v[collection][0].note = 'rewritten'; },
      (v) => { [v[collection][0], v[collection][1]] = [v[collection][1], v[collection][0]]; },
      (v) => { v[collection][0] = { note: 'unchanged', id: `${collection}-a` }; },
      (v) => { v[collections.find((name) => name !== collection)!][0].note = 'unrelated'; },
    ];
    for (const attack of attacks) {
      const changed = structuredClone(after); attack(changed);
      assert.equal(sqliteAllows(before, changed, [schema.consultingFlowsCommandTargetTriggerSql]), false, action);
      assert.equal(await targets(engine, before, changed, action), false, action);
    }
    // Even malformed historical roots are rejected, not accepted as safe append.
    const duplicateBefore = structuredClone(before); duplicateBefore[collection][0].id = `${id}-${rule.idSuffix}`;
    const duplicateAfter = command(duplicateBefore, action); duplicateAfter[collection].push({ id: `${id}-${rule.idSuffix}` });
    assert.equal(await targets(engine, duplicateBefore, duplicateAfter, action), false);
  }
});

void test('update command targets bind one selected row, protect typed properties and enforce status/timestamp rules', async (t) => {
  const { engine, close } = await postgresFixture(); t.after(close);
  const updates: Partial<Record<Action, Item>> = {
    complete_meeting: { status: 'completed', completedAt: stamp, note: 'done' },
    cancel_meeting: { status: 'cancelled', note: 'cancelled' },
    save_transcript: { transcript: '가상 전사문 수정', transcriptReviewedAt: stamp, transcriptReviewedBy: 'synthetic-partner' },
    mark_request_sent: { sentAt: stamp }, receive_document: { status: 'received', fileId: 'file', receivedAt: stamp },
    review_document: { status: 'verified', reviewedAt: stamp, verifiedAt: stamp },
    record_contract: { status: 'completed', completedAt: stamp },
  };
  for (const action of actions) for (const collection of collections) {
    const rule = schema.FLOW_COMMAND_TARGET_RULES[action][collection];
    if (rule?.kind !== 'update') continue;
    const before = initial();
    before[collection] = ['older', 'target'].map((id) => ({ id, stage: 1, status: 'scheduled', note: 'before', origin: { b: 1, a: 2 } }));
    const after = command(before, action, 'target');
    Object.assign(after[collection][1], updates[action]);
    if (action === 'record_contract') after.contract = { meetingId: 'target' };
    assert.equal(await targets(engine, before, after, action), true, action);
    assert.equal(sqliteAllows(before, after, [schema.consultingFlowsCommandTargetTriggerSql]), true, action);
    const attacks: Array<(value: Probe) => void> = [
      (v) => { v[collection][1].stage = 2; },
      (v) => { v[collection][1].missingProperty = null; },
      (v) => { v[collection][1].origin = { a: 2, b: 1 }; },
      (v) => { v[collection][1].id = 'swapped-target'; },
      (v) => { Object.assign(v[collection][0], updates[action]); },
      (v) => { v[collection].push({ id: 'extra' }); },
      (v) => { v[collection].shift(); },
    ];
    for (const attack of attacks) {
      const changed = structuredClone(after); attack(changed);
      assert.equal(sqliteAllows(before, changed, [schema.consultingFlowsCommandTargetTriggerSql]), false, action);
      assert.equal(await targets(engine, before, changed, action), false, action);
    }
    const numberRetyped = raw(after).replace('"id":"target","stage":1,', '"id":"target","stage":1.0,');
    assert.notEqual(numberRetyped, raw(after));
    assert.equal(sqliteAllows(before, numberRetyped, [schema.consultingFlowsCommandTargetTriggerSql]), false, action);
    assert.equal(await targets(engine, before, numberRetyped, action), false, action);
    // Receipt target binding also ports checks formerly in exact-effect guards.
    for (const targetId of ['older', 'absent', null, 7, '']) {
      const changed = structuredClone(after); changed.commandReceipts[id].targetId = targetId;
      assert.equal(await targets(engine, before, changed, action), false, `${action}: receipt target`);
    }
    const unchanged = command(before, action, 'target');
    if (action === 'record_contract') unchanged.contract = { meetingId: 'target' };
    assert.equal(await targets(engine, before, unchanged, action), false, `${action}: unchanged scheduled target`);
    if (action === 'record_contract') {
      const completedBefore = structuredClone(before); completedBefore[collection][1].status = 'completed';
      const completedAfter = command(completedBefore, action, 'target'); completedAfter.contract = { meetingId: 'target' };
      assert.equal(await targets(engine, completedBefore, completedAfter, action), true, 'already-completed contract target');
      completedAfter.contract = { meetingId: 'nonexistent' };
      assert.equal(await targets(engine, completedBefore, completedAfter, action), false, 'zero-change target mismatch');
    }
    if (action === 'save_transcript') {
      const older = command(before, action, 'older'); Object.assign(older[collection][0], updates[action]);
      assert.equal(await targets(engine, before, older, action), false, 'only latest recording');
    }
    const required = action === 'complete_meeting' ? ['status', 'completedAt'] : action === 'cancel_meeting' || action === 'receive_document' || action === 'record_contract' ? ['status']
      : action === 'save_transcript' ? ['transcriptReviewedAt'] : action === 'mark_request_sent' ? ['sentAt'] : ['status', 'reviewedAt'];
    for (const field of required) for (const replacement of [undefined, null, 'wrong', 7]) {
      const changed = structuredClone(after); changed[collection][1][field] = replacement;
      assert.equal(await targets(engine, before, changed, action), false, `${action}: ${field}`);
    }
  }
});

void test('command boundaries reject malformed JSON, history injection and command/effect mismatches', async (t) => {
  const { engine, close } = await postgresFixture(); t.after(close);
  const before = initial(); const after = command(before, 'save_source'); after.ai.sourceText = '가상 근거자료';
  assert.equal(await boundary(engine, null, before, before), true);
  assert.equal(await boundary(engine, before, after, after), true);
  assert.equal(await boundary(engine, null, after, after), false);
  for (const value of [null, [], {}, '{broken', 'null', '[]',
    raw(after).replace('"sourceText":"가상 근거자료"', '"sourceText":"가상 근거자료","sourceText":"forged"'),
    raw(after).replace('가상 근거자료', '\\u0000'), raw(after).replace('가상 근거자료', '\\ud800')])
    assert.equal(await boundary(engine, before, value, after), false, raw(value));
  for (const attack of [
    (v: Probe) => { v.audit[0].action = 'review_document'; },
    (v: Probe) => { v.commandReceipts[id].action = 'unknown'; v.audit[0].action = 'unknown'; },
    (v: Probe) => { v.commandReceipts = {}; },
    (v: Probe) => { v.commandIds.push('extra-command'); },
    (v: Probe) => { v.ai.sourceText = ''; },
    (v: Probe) => { v.payments.push({ id: 'forged-payment' }); },
    (v: Probe) => { v.company = 'different-company'; },
  ]) {
    const changed = structuredClone(after); attack(changed);
    assert.equal(await boundary(engine, before, changed, after), false);
  }
  assert.equal(await boundary(engine, before, after, { ...after, revision: 2 }), false);
  const continued = structuredClone(after); continued.revision++; continued.updatedAt = stamp;
  assert.equal(await boundary(engine, after, continued, continued), true);
  continued.commandReceipts[id].fingerprint = 'b'.repeat(64);
  assert.equal(await boundary(engine, after, continued, continued), false);
  for (const malformed of [null, {}, [null], [{ id: 1 }], [{ id: 'same' }, { id: 'same' }]]) {
    const changed = structuredClone(after); changed.requests = malformed as Item[];
    assert.equal(await boundary(engine, before, changed, after), false);
  }
});

void test('real application commands through all manual FLOW stages pass the native command boundary composition', async (t) => {
  const { engine, close } = await postgresFixture(); t.after(close);
  let flow: ConsultingFlow = { ...newConsultingFlow('synthetic-case', '가상기업', 'synthetic-partner', '가상담당'), updatedAt: time };
  const admin: FlowActor = { id: 'synthetic-admin', role: 'admin', name: '가상관리자' };
  const partner: FlowActor = { id: 'synthetic-partner', role: 'partner', name: '가상담당' };
  const body = '가상 기업에 대한 합성 검사입니다. 실제 기업 자료나 AI 제공자 호출 없이 검증합니다. '.repeat(8);
  let sequence = 0;
  const seen = new Set<string>();
  function file(purpose: string, name = 'synthetic.pdf'): FlowFile {
    const fileId = `synthetic-file-${++sequence}`;
    return { id: fileId, key: flowFileStorageKey(fileId), purpose, name, contentType: 'application/pdf', size: 100, createdAt: stamp };
  }
  async function apply(command: FlowCommand, actor = admin, upload?: FlowFile, intakeCategory?: string) {
    const commandId = `synthetic-app-command-${++sequence}`;
    const after = applyFlowCommand(flow, { transcriptReviewed: true, ...command }, actor, { commandId, now: stamp, upload, intakeCategory });
    const targetId = command.meetingId ?? command.requestId ?? command.recordingId;
    after.commandReceipts = { ...flow.commandReceipts, [commandId]: {
      actorKey: actor.role === 'admin' ? 'admin:primary' : `member:${actor.id}`, fingerprint: 'a'.repeat(64),
      actor: actor.name, action: command.type,
      ...(['complete_meeting','cancel_meeting','mark_request_sent','receive_document','review_document','record_contract','save_transcript'].includes(command.type) ? { targetId: String(targetId) } : {}),
    } };
    assert.equal(await boundary(engine, flow, after, after), true, command.type);
    // Keep the original SQLite command boundary subset as an independent oracle.
    assert.equal(sqliteAllows(flow as unknown as Probe, after as unknown as Probe, [schema.consultingFlowsCommandScopeTriggerSql,
      schema.consultingFlowsCommandEffectTriggerSql, schema.consultingFlowsCommandTargetTriggerSql]), true, `SQLite ${command.type}`);
    flow = after; seen.add(command.type);
  }
  await apply({ type: 'save_source', sourceText: body, privacyMasked: true });
  const source = { ...file('source'), intakeFileId: 'synthetic-intake-file', intakeCaseId: flow.caseId, intakeCategory: '재무자료', intakeReviewedAt: stamp };
  await apply({ type: 'import_intake_source', intakeFileId: source.intakeFileId, contentReviewed: true, fileConsent: true, privacyMasked: true }, admin, source, '재무자료');
  await apply({ type: 'exclude_source', fileId: source.id });
  await apply({ type: 'queue_report1' }); // blocked while AI is disabled; no provider call.
  await apply({ type: 'set_ai_policy', enabled: true, thirdPartyConsent: true, privacyMasked: true, costConsent: true });
  await apply({ type: 'retry_job', jobId: flow.jobs[0].id, costConsent: true });
  await apply({ type: 'set_ai_policy', enabled: false });
  await apply({ type: 'save_report', stage: 1, body });
  await apply({ type: 'confirm_analysis', reportId: flow.reports[0].id });
  await apply({ type: 'confirm_analysis', reportId: flow.reports[0].id }, partner);
  const meeting = { type: 'book_meeting', kind: 'first', attendance: 'both', startsAt: '2026-09-09T01:00:00Z', endsAt: '2026-09-09T02:00:00Z', location: '가상 상담실' };
  await apply(meeting);
  await apply({ type: 'cancel_meeting', meetingId: flow.meetings[0].id, note: '가상 취소' });
  await apply(meeting);
  await apply({ type: 'save_report', stage: 2, body });
  await apply({ type: 'save_report', stage: 3 }, admin, file('report', 'synthetic.pptx'));
  await apply({ type: 'complete_meeting', meetingId: flow.meetings.at(-1)!.id });
  await apply({ type: 'save_recording', meetingId: flow.meetings.at(-1)!.id, transcript: body, recordingConsent: true, privacyMasked: true }, partner);
  await apply({ type: 'save_transcript', recordingId: flow.recordings[0].id, transcript: `${body} 가상 보완`, recordingConsent: true, privacyMasked: true }, partner);
  await apply({ type: 'save_report', stage: 4, body });
  await apply({ type: 'confirm_solutions', reportId: flow.reports.at(-1)!.id, solutions: ['정책자금 사전진단'], documentsNeeded: true, reviewConfirmed: true, note: '가상 추가 확인' });
  await apply({ type: 'request_document', title: '가상 확인자료', recipient: '가상담당', channel: '이메일', required: true, dueDate: '2026-09-10' });
  await apply({ type: 'mark_request_sent', requestId: flow.requests[0].id, sentConfirmed: true }, partner);
  await apply({ type: 'receive_document', requestId: flow.requests[0].id }, partner, file('requested_document'));
  await apply({ type: 'review_document', requestId: flow.requests[0].id, approved: true });
  await apply({ type: 'save_report', stage: 5, body });
  await apply({ type: 'save_report', stage: 6, body });
  await apply({ ...meeting, kind: 'contract', startsAt: '2026-09-09T03:00:00Z', endsAt: '2026-09-09T04:00:00Z' });
  await apply({ type: 'record_contract', meetingId: flow.meetings.at(-1)!.id, signedAt: '2026-09-09', expectedDepositWon: 1000000, signedConfirmed: true }, admin, file('signed_contract'));
  await apply({ type: 'confirm_payment', amountWon: 400000, receivedAt: '2026-09-09', reference: '가상 부분입금', paymentConfirmed: true });
  await apply({ type: 'confirm_payment', amountWon: 600000, receivedAt: '2026-09-09', reference: '가상 잔금', paymentConfirmed: true });
  await apply({ type: 'start_aftercare', summary: '가상 수행 확인', owner: '가상관리자', nextDate: '2026-10-01', deliveryConfirmed: true });
  assert.deepEqual([...seen].sort(), [...actions].sort());
  // No root or HTTP/Storage integration is implied by this pure-function test.
  assert.equal((await engine.query<{ name: string | null }>("SELECT to_regclass('partner_hub.consulting_flows')::text AS name")).rows[0].name, null);
});

void test('remote command boundary probe has server-only function privileges and leaves no business writes', async (t) => {
  const { engine, close } = await postgresFixture(); t.after(close);
  await engine.exec(await readFile(new URL('./supabase-flow-commands-probe.sql', import.meta.url), 'utf8'));
  assert.equal((await engine.query<{ n: number }>('SELECT count(*)::integer AS n FROM partner_hub.portal_state')).rows[0].n, 0);
});
