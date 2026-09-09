import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import * as schema from '../db/schema';
import { analysisDone, preparationDone, documentsDone, signingPreparationDone, documentsKey, depositReceived,
  type ConsultingFlow, type FlowActor, type FlowCommand, type FlowFile } from '../lib/consulting-flow';
import { postgresFixture } from './supabase-postgres-fixture';
import { manualFlowCommand, manualFlowScenario, manualFlowStamp, type ManualFlowTransition } from './supabase-flow-manual-fixture';
import { flowUploadPurpose } from '../lib/consulting-flow-upload-policy';

type Engine = Awaited<ReturnType<typeof postgresFixture>>['engine'];
const admin: FlowActor = { id: 'synthetic-admin', role: 'admin', name: '김성민 대표' };
const partner: FlowActor = { id: 'synthetic-partner', role: 'partner', name: '가상담당' };
const later = '2026-09-09T15:01:00.000Z';
const body = '합성 검증용 기업 상담 내용입니다. 실제 기업 자료나 외부 AI 요청을 사용하지 않습니다. '.repeat(8).trim();
const raw = JSON.stringify;
function attachment(id: string, purpose: string, name = 'synthetic.pdf', now = manualFlowStamp): FlowFile {
  return { id, name, contentType: name.endsWith('.mp3') ? 'audio/mpeg' : name.endsWith('.txt') ? 'text/plain' : 'application/pdf',
    size: 100, key: `consulting-flow/${id}`, createdAt: now, purpose };
}
async function guard(engine: Engine, transition: ManualFlowTransition) {
  const { previous, proposed } = transition;
  return (await engine.query<{ valid: boolean }>('SELECT partner_hub.flow_command_effect_transition_valid($1,$2,$3,$4,$5,$6) AS valid',
    [raw(previous),raw(proposed),proposed.caseId,proposed.partnerId,proposed.revision,proposed.updatedAt])).rows[0].valid;
}
function oracle(transition: ManualFlowTransition) {
  const { previous, proposed, command } = transition;
  const action = command.type as keyof typeof schema.FLOW_COMMAND_EFFECT_PATHS;
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(schema.consultingFlowsTableSql);
    sqlite.prepare('INSERT INTO consulting_flows VALUES (?,?,?,?,?)').run(previous.caseId,previous.partnerId,previous.revision,raw(previous),previous.updatedAt);
    for (const trigger of [schema.consultingFlowsCommandScopeTriggerSql,schema.consultingFlowsCommandEffectTriggerSql,
      schema.consultingFlowsCommandTargetTriggerSql,...schema.FLOW_COMMAND_EXACT_EFFECT_TRIGGERS[action]]) sqlite.exec(trigger);
    try {
      sqlite.prepare('UPDATE consulting_flows SET revision=?,payload=?,updated_at=?').run(proposed.revision,raw(proposed),proposed.updatedAt);
      return true;
    } catch { return false; }
  } finally { sqlite.close(); }
}
function select(transitions: ManualFlowTransition[], action: string, predicate: (value: ManualFlowTransition) => boolean = () => true) {
  const found = transitions.find((value) => value.command.type === action && predicate(value));
  assert.ok(found, action); return found;
}
type Edit = (flow: ConsultingFlow) => void;
async function rejects(engine: Engine, original: ManualFlowTransition, edits: Array<[string, Edit]>, sqliteParity = true) {
  assert.equal(await guard(engine,original),true,`${original.command.type}: positive control`);
  for (const [label, edit] of edits) {
    const transition = structuredClone(original); edit(transition.proposed);
    assert.equal(await guard(engine,transition),false,`${original.command.type}: ${label}`);
    if (sqliteParity) assert.equal(oracle(transition),false,`SQLite ${original.command.type}: ${label}`);
  }
}

void test('native report and analysis effects reject stale references, forged author, history edits and extra attachments', async (t) => {
  const { engine, close } = await postgresFixture(); t.after(close);
  const { transitions } = await manualFlowScenario(engine);
  for (const stage of [1,2,3,4,5,6]) {
    const transition = select(transitions,'save_report',(x) => x.command.stage === stage);
    await rejects(engine,transition,[
      ['version',s => { s.reports.at(-1)!.version++; }],
      ['title',s => { s.reports.at(-1)!.title = '변조'; }],
      ['author',s => { s.reports.at(-1)!.createdBy = partner.name; }],
      ['origin',s => { s.reports.at(-1)!.origin = 'ai'; }],
      ['whitespace',s => { s.reports.at(-1)!.body = ` ${s.reports.at(-1)!.body}`; }],
      ['unreferenced attachment',s => { s.files.push(attachment('forged-extra-file','report')); }],
      ...(stage > 1 ? [['stale report', (s: ConsultingFlow) => { s.reports.at(-1)!.sourceReportId = 'stale'; }] as [string,Edit]] : []),
      ...(stage === 4 ? [['stale recording', (s: ConsultingFlow) => { s.reports.at(-1)!.sourceRecordingId = 'stale'; }] as [string,Edit]] : []),
      ...(stage >= 5 ? [['stale documents', (s: ConsultingFlow) => { s.reports.at(-1)!.documentsKey = '[]'; }] as [string,Edit]] : []),
    ]);
  }
  await rejects(engine,select(transitions,'confirm_analysis'),[
    ['wrong report',s => { s.analysis.reportId = 'stale'; }],
    ['other actor stamp',s => { s.analysis.partnerAt = manualFlowStamp; }],
    ['wrong time',s => { s.analysis.adminAt = later; }],
  ]);
});

void test('native meeting, solution and document effects reject forged targets and review state', async (t) => {
  const { engine, close } = await postgresFixture(); t.after(close);
  const { transitions } = await manualFlowScenario(engine);
  await rejects(engine,select(transitions,'book_meeting'),[
    ['creator',s => { s.meetings.at(-1)!.createdBy = 'stranger'; }],
    ['completed on booking',s => { s.meetings.at(-1)!.status = 'completed'; }],
    ['backwards date',s => { s.meetings.at(-1)!.endsAt = s.meetings.at(-1)!.startsAt; }],
    ['first not joint',s => { s.meetings.at(-1)!.attendance = 'partner'; }],
  ]);
  for (const action of ['complete_meeting','cancel_meeting']) await rejects(engine,select(transitions,action),[
    ['location rewrite',s => { s.meetings.at(-1)!.location = '변조'; }],
    ['wrong status',s => { s.meetings.at(-1)!.status = 'scheduled'; }],
    ['time rewrite',s => { s.meetings.at(-1)!.completedAt = later; }],
  ]);
  await rejects(engine,select(transitions,'confirm_solutions'),[
    ['stale report',s => { s.decision!.reportId = 'stale'; }],
    ['duplicate solution',s => { s.decision!.solutions.push(s.decision!.solutions[0]); }],
    ['empty solutions',s => { s.decision!.solutions = []; }],
    ['wrong time',s => { s.decision!.at = later; }],
  ]);
  await rejects(engine,select(transitions,'request_document'),[
    ['premature received',s => { s.requests.at(-1)!.status = 'received'; }],
    ['blank recipient',s => { s.requests.at(-1)!.recipient = ''; }],
    ['invalid due date',s => { s.requests.at(-1)!.dueDate = '2026-02-30'; }],
  ]);
  await rejects(engine,select(transitions,'mark_request_sent'),[
    ['wrong sent time',s => { s.requests.at(-1)!.sentAt = later; }],
    ['changed requirement',s => { s.requests.at(-1)!.required = false; }],
    ['forged audit',s => { s.audit.at(-1)!.detail = '변조'; }],
  ]);
  await rejects(engine,select(transitions,'receive_document'),[
    ['unknown file',s => { s.requests.at(-1)!.fileId = 'unknown'; }],
    ['verified prematurely',s => { s.requests.at(-1)!.verifiedAt = manualFlowStamp; }],
    ['wrong received time',s => { s.requests.at(-1)!.receivedAt = later; }],
    ['wrong purpose',s => { s.files.at(-1)!.purpose = 'report'; }],
  ]);
  await rejects(engine,select(transitions,'review_document'),[
    ['missing verification',s => { delete s.requests.at(-1)!.verifiedAt; }],
    ['switched file',s => { s.requests.at(-1)!.fileId = 'unknown'; }],
    ['wrong review time',s => { s.requests.at(-1)!.reviewedAt = later; }],
    ['needs fix without reason',s => { s.requests.at(-1)!.status = 'needs_fix'; delete s.requests.at(-1)!.verifiedAt; }],
  ]);
});

void test('native contract, deposit and aftercare effects enforce amount, evidence, dates and threshold', async (t) => {
  const { engine, close } = await postgresFixture(); t.after(close);
  const { transitions } = await manualFlowScenario(engine);
  await rejects(engine,select(transitions,'record_contract'),[
    ['stale report',s => { s.contract!.reportId = 'stale'; }],
    ['wrong recorder',s => { s.contract!.recordedBy = 'stranger'; }],
    ['unknown signed file',s => { s.contract!.signedFileId = 'unknown'; }],
    ['unsigned purpose',s => { s.files.at(-1)!.purpose = 'report'; }],
    ['future signing',s => { s.contract!.signedAt = '2026-09-10'; }],
    ['zero amount',s => { s.contract!.expectedDepositWon = 0; }],
    ['fractional amount',s => { s.contract!.expectedDepositWon = 1.5; }],
    ['too large amount',s => { s.contract!.expectedDepositWon = 1000000000001; }],
  ]);
  const partial = select(transitions,'confirm_payment');
  await rejects(engine,partial,[
    ['premature execution',s => { s.executionStartedAt = manualFlowStamp; }],
    ['zero amount',s => { s.payments.at(-1)!.amountWon = 0; }],
    ['fractional amount',s => { s.payments.at(-1)!.amountWon = 0.5; }],
    ['forged confirmer',s => { s.payments.at(-1)!.confirmedBy = partner.name; }],
    ['future payment',s => { s.payments.at(-1)!.receivedAt = '2026-09-10'; }],
    ['empty reference',s => { s.payments.at(-1)!.reference = ''; }],
  ]);
  await rejects(engine,select(transitions,'confirm_payment',x => x.command.amountWon === 600000),[
    ['missing execution',s => { delete s.executionStartedAt; }],
    ['wrong execution',s => { s.executionStartedAt = later; }],
    ['altered prior payment',s => { s.payments[0].amountWon++; }],
  ]);
  await rejects(engine,select(transitions,'start_aftercare'),[
    ['wrong time',s => { s.aftercare!.at = later; }],
    ['empty summary',s => { s.aftercare!.summary = ''; }],
    ['invalid date',s => { s.aftercare!.nextDate = '2026-02-29'; }],
    ['blank owner',s => { s.aftercare!.owner = ' '; }],
  ]);
});

void test('native recording and transcript effects protect evidence history, file roles and queued job linkage', async (t) => {
  const { engine, close } = await postgresFixture(); t.after(close);
  const { transitions } = await manualFlowScenario(engine);
  await rejects(engine,select(transitions,'save_recording'),[
    ['wrong consent time',s => { s.recordings.at(-1)!.consentAt = later; }],
    ['wrong job source',s => { s.jobs.at(-1)!.sourceRecordingId = 'stale'; }],
    ['wrong report source',s => { s.jobs.at(-1)!.sourceReportId = 'stale'; }],
    ['fake queue despite disabled',s => { s.jobs.at(-1)!.status = 'queued'; s.jobs.at(-1)!.reason = ''; }],
    ['extra file',s => { s.files.push(attachment('unreferenced-recording','recording')); }],
  ]);
  await rejects(engine,select(transitions,'save_transcript'),[
    ['old review time',s => { s.recordings.at(-1)!.transcriptReviewedAt = later; }],
    ['removed job',s => { s.jobs.pop(); }],
    ['changed job reason',s => { s.jobs.at(-1)!.reason = '변조'; }],
    ['changed unrelated job',s => { s.jobs[0].reason = '변조'; }],
  ]);
  const changed = structuredClone(select(transitions,'save_transcript'));
  changed.proposed.recordings.at(-1)!.transcriptFileId = 'forged-without-upload';
  assert.equal(await guard(engine,changed),false,'new attachment reference requires its file');
});

void test('real application branches preserve revisions, document resubmission and completed contract meeting', async (t) => {
  const { engine, close } = await postgresFixture(); t.after(close);
  const { transitions } = await manualFlowScenario(engine);
  let sequence = 0;
  async function apply(previous: ConsultingFlow, command: FlowCommand, actor = admin, upload?: FlowFile) {
    const transition = manualFlowCommand(previous,command,actor,`synthetic-branch-${++sequence}`,later,upload);
    assert.equal(await guard(engine,transition),true,`${command.type} branch ${sequence}`);
    assert.equal(oracle(transition),true,`SQLite ${command.type} branch ${sequence}`);
    return transition.proposed;
  }
  const initialReport = select(transitions,'save_report',x => x.command.stage === 1).proposed;
  const revision = await apply(initialReport,{type:'save_report',stage:1,body});
  assert.equal(revision.reports.at(-1)!.version,2);
  assert.deepEqual(revision.analysis,{reportId:revision.reports.at(-1)!.id});
  const ppt = select(transitions,'save_report',x => x.command.stage === 3).proposed;
  const reused = await apply(ppt,{type:'save_report',stage:3,fileId:ppt.reports.at(-1)!.fileId});
  assert.equal(reused.files.length,ppt.files.length);
  let flow = select(transitions,'review_document').proposed;
  const requestId = flow.requests[0].id;
  flow = await apply(flow,{type:'review_document',requestId,approved:false,note:'다시 확인 필요'});
  assert.equal(flow.requests[0].verifiedAt,undefined);
  flow = await apply(flow,{type:'receive_document',requestId,fileId:flow.requests[0].fileId,note:'보완 접수'},partner);
  assert.equal(flow.requests[0].reviewedAt,undefined);
  flow = await apply(flow,{type:'receive_document',requestId,fileId:flow.requests[0].fileId,note:'접수 메모 보완'},partner);
  flow = await apply(flow,{type:'review_document',requestId,approved:true});
  assert.equal(flow.requests[0].verifiedAt,later);
  let contract = select(transitions,'record_contract').previous;
  contract = await apply(contract,{type:'complete_meeting',meetingId:contract.meetings.at(-1)!.id},partner);
  contract = await apply(contract,{type:'record_contract',meetingId:contract.meetings.at(-1)!.id,signedAt:'2026-09-10',
    expectedDepositWon:1,signedConfirmed:true},partner,attachment('branch-signed-file','signed_contract','synthetic.pdf',later));
  assert.equal(contract.contract!.recordedBy,partner.name);
  contract = await apply(contract,{type:'confirm_payment',amountWon:1,receivedAt:'2026-09-10',reference:'합성 입금',paymentConfirmed:true});
  const execution = contract.executionStartedAt;
  contract = await apply(contract,{type:'confirm_payment',amountWon:1000000000000,receivedAt:'2026-09-10',reference:'추가 합성 입금',paymentConfirmed:true});
  assert.equal(contract.executionStartedAt,execution);
});

void test('real recording branches support audio-only, two files, transcript upload and disabled failed job preservation', async (t) => {
  const { engine, close } = await postgresFixture(); t.after(close);
  const { transitions } = await manualFlowScenario(engine);
  const before = select(transitions,'save_recording').previous;
  let sequence = 0;
  async function check(previous: ConsultingFlow, command: FlowCommand, upload?: FlowFile, audio?: FlowFile) {
    const transition = manualFlowCommand(previous,command,partner,`synthetic-recording-${++sequence}`,later,upload,audio);
    assert.equal(await guard(engine,transition),true,`recording branch ${sequence}`);
    assert.equal(oracle(transition),true,`SQLite recording branch ${sequence}`);
    return transition.proposed;
  }
  const command = {type:'save_recording',meetingId:before.meetings.at(-1)!.id,recordingConsent:true,privacyMasked:true};
  const audio = attachment('branch-audio-file','recording','synthetic.mp3',later);
  let flow = await check(before,command,audio);
  assert.equal(flow.recordings.at(-1)!.fileId,flow.recordings.at(-1)!.audioFileId);
  assert.match(flow.jobs.at(-1)!.reason,/전사문 대기/);
  flow = await check(flow,{type:'save_transcript',recordingId:flow.recordings.at(-1)!.id,transcript:body,recordingConsent:true,privacyMasked:true},
    attachment('branch-transcript-file',flowUploadPurpose({type:'save_transcript'})!,'synthetic.txt',later));
  const job = flow.jobs.at(-1)!;
  job.status = 'failed'; job.reason = '합성 실패'; // Synthetic prior internal-result state; not a write through production guards.
  const failed = await check(flow,{type:'save_transcript',recordingId:flow.recordings.at(-1)!.id,transcript:`${body} 보완`,recordingConsent:true,privacyMasked:true});
  assert.deepEqual(failed.jobs,flow.jobs);
  const paired = await check(before,{...command,transcript:body},attachment('branch-paired-doc','recording','synthetic.txt',later),audio);
  assert.equal(paired.files.length,before.files.length+2);
  assert.equal(paired.recordings.at(-1)!.transcriptFileId,'branch-paired-doc');
  const audioOnly = await check(before,command,undefined,audio);
  assert.equal(audioOnly.recordings.at(-1)!.fileId,undefined);
  assert.equal(audioOnly.recordings.at(-1)!.audioFileId,audio.id);
});

void test('native prerequisites, Unicode text, integer and date helpers agree with application semantics', async (t) => {
  const { engine, close } = await postgresFixture(); t.after(close);
  const { transitions } = await manualFlowScenario(engine);
  for (const flow of transitions.map(x => x.proposed)) {
    const value = (await engine.query<{ context: Record<string,unknown> }>('SELECT partner_hub.flow_business_context($1::json) AS context',[raw(flow)])).rows[0].context;
    assert.deepEqual([value.analysisDone,value.preparationDone,value.documentsDone,value.signingReady,value.documentsKey,Number(value.paid)],
      [analysisDone(flow),preparationDone(flow),documentsDone(flow),signingPreparationDone(flow),documentsKey(flow),depositReceived(flow)]);
  }
  for (const value of [' x ','\tx\n','\u00a0x\u3000','\ufeffx\u2029','\u200bx\u200b','🙂','한글']) {
    const result = (await engine.query<{ trimmed:string; valid:boolean }>('SELECT partner_hub.flow_js_trim($1) AS trimmed, partner_hub.flow_text_valid(to_json($1::text),1,2) AS valid',[value])).rows[0];
    assert.equal(result.trimmed,value.trim());
    assert.equal(result.valid,value === value.trim() && Array.from(value).length >= 1 && Array.from(value).length <= 2);
  }
  for (const [value,valid] of [['2024-02-29',true],['2026-02-29',false],['2026-13-01',false],['2026-9-01',false],['2026-09-09',true]] as const)
    assert.equal((await engine.query<{valid:boolean}>('SELECT partner_hub.flow_date_only_valid($1) AS valid',[value])).rows[0].valid,valid);
  for (const [value,valid] of [['1',true],['1000000000000',true],['1000000000001',false],['0',false],['-1',false],['1.0',false],['1e0',false],['"1"',false],['null',false]] as const)
    assert.equal((await engine.query<{valid:boolean}>('SELECT partner_hub.flow_integer_valid($1::json,1,1000000000000) AS valid',[value])).rows[0].valid,valid);
});

void test('remote business effect probe keeps helpers private and leaves no FLOW root or business writes', async (t) => {
  const { engine, close } = await postgresFixture(); t.after(close);
  const probe = await readFile(new URL('./supabase-flow-business-probe.sql',import.meta.url),'utf8');
  await engine.exec(probe);
  assert.equal((await engine.query<{name:string|null}>("SELECT to_regclass('partner_hub.consulting_flows')::text AS name")).rows[0].name,null);
});

void test('native business effects reject missing prerequisites, wrong actor class and malformed collections', async (t) => {
  const { engine, close } = await postgresFixture(); t.after(close);
  const { transitions } = await manualFlowScenario(engine);
  const cases: Array<[ManualFlowTransition,Edit]> = [
    [select(transitions,'save_report',x => x.command.stage === 2),s => { delete s.analysis.partnerAt; }],
    [select(transitions,'save_report',x => x.command.stage === 5),s => { s.requests[0].status = 'needs_fix'; }],
    [select(transitions,'book_meeting'),s => { delete s.analysis.adminAt; }],
    [select(transitions,'complete_meeting'),s => { s.reports.find(r => r.stage === 2)!.sourceReportId = 'stale'; }],
    [select(transitions,'record_contract'),s => { s.requests[0].status = 'received'; }],
    [select(transitions,'record_contract'),s => { s.reports.find(r => r.stage === 6)!.documentsKey = '[]'; }],
    [select(transitions,'start_aftercare'),s => { s.payments[0].amountWon = 1; }],
    [select(transitions,'start_aftercare'),s => { delete s.executionStartedAt; }],
  ];
  for (const [original,edit] of cases) {
    const transition = structuredClone(original); edit(transition.previous); edit(transition.proposed);
    assert.equal(await guard(engine,transition),false,`${transition.command.type}: prerequisite`);
  }
  for (const action of ['save_report','confirm_solutions','request_document','review_document','confirm_payment','start_aftercare']) {
    const transition = structuredClone(select(transitions,action));
    transition.proposed.commandReceipts![transition.commandId].actorKey = `member:${partner.id}`;
    transition.proposed.commandReceipts![transition.commandId].actor = partner.name;
    transition.proposed.audit.at(-1)!.actor = partner.name;
    assert.equal(await guard(engine,transition),false,`${action}: administrator required`);
  }
  const before = select(transitions,'save_report').previous;
  for (const replacement of [null,{},[null],[{id:'duplicate'},{id:'duplicate'}]]) {
    const changed = {...before,reports:replacement};
    const context = (await engine.query<{value:unknown}>('SELECT partner_hub.flow_business_context($1::json) AS value',[raw(changed)])).rows[0].value;
    assert.equal(context,null);
  }
  for (const value of [null,[],{},'wrong']) {
    const result = (await engine.query<{value:boolean}>("SELECT partner_hub.flow_business_effect_valid($1::json,$1::json,'synthetic-malformed','save_report',$2) AS value",[raw(value),manualFlowStamp])).rows[0].value;
    assert.equal(result,false);
  }
});
