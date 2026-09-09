import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { postgresFixture } from './supabase-postgres-fixture';
import * as schema from '../db/schema';

type Item = Record<string, unknown>;
type Value = { files: Item[]; jobs: Item[]; ai: { enabled: boolean }; [key: string]: unknown };
type Engine = Awaited<ReturnType<typeof postgresFixture>>['engine'];
const stamp = '2026-09-09T12:01:00.000Z';
const commandId = 'synthetic-effect-command';
const initial = (): Value => ({ caseId: 'synthetic-case', partnerId: 'synthetic-partner', company: '가상기업', partnerName: '가상담당', files: [], jobs: [], ai: { enabled: false } });
const raw = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value);
function withCommand(value: Value | string, action: string, proposed: boolean) {
  // Wrap via text to preserve deliberate escape/key/number spelling in history.
  return raw(value).slice(0, -1) + (proposed
    ? `,"commandIds":["${commandId}"],"commandReceipts":{"${commandId}":{"action":"${action}"}}}`
    : ',"commandIds":[],"commandReceipts":{}}');
}
function sqliteAllows(previous: Value | string, proposed: Value | string, action: string, trigger: string) {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(schema.consultingFlowsTableSql);
    sqlite.prepare('INSERT INTO consulting_flows VALUES (?,?,?,?,?)').run('synthetic-case','synthetic-partner',0,withCommand(previous,action,false),stamp);
    sqlite.exec(trigger);
    try {
      sqlite.prepare('UPDATE consulting_flows SET revision=1,payload=?').run(withCommand(proposed,action,true));
      return true;
    } catch { return false; }
  } finally { sqlite.close(); }
}
const ai = async (engine: Engine, before: unknown, after: unknown, action: string) =>
  (await engine.query<{ valid: boolean }>('SELECT partner_hub.flow_ai_control_effect_valid($1::json,$2::json,$3,$4,$5) AS valid', [raw(before),raw(after),commandId,action,stamp])).rows[0].valid;
const source = async (engine: Engine, before: unknown, after: unknown, action: string) =>
  (await engine.query<{ valid: boolean }>('SELECT partner_hub.flow_source_effect_valid($1::json,$2::json,$3,$4) AS valid', [raw(before),raw(after),action,stamp])).rows[0].valid;
const job = (status = 'queued', id = 'synthetic-job'): Item => ({ id, stage: 1, status, reason: 'original', createdAt: stamp });
const file = (id = 'synthetic-file', purpose = 'source'): Item => ({ id, name: '가상.pdf', purpose, createdAt: stamp, size: 10 });

void test('PostgreSQL top-level JSON editing preserves SQLite key order and untouched escaped/numeric history', async (t) => {
  const { engine, close } = await postgresFixture(); t.after(close);
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  const cases: Array<[string, Item, string[]]> = [
    ['{}',{ status: 'blocked', reason: '가상 사유' },[]],
    [' { "id":"job", "reason":"old", "status":"queued", "extra":{"b":1.00,"a":"\\u0061"} } ',{ status: 'blocked', reason: '가상 사유' },[]],
    ['{"startedAt":"then","id":"job","status":"failed","reason":"old","failureEvidence":{"b":1,"a":2}}',{ status: 'queued', reason: '' },['startedAt','failureEvidence']],
    ['{"reason":"old","id":"job","status":"failed"}',{ status: 'queued', reason: '' },['reason']],
    ['{"reason":"old","text":"braces { [ , : \\" quotes ","items":[{"nested":"x"}]}',{ reason: 'new', next: null },[]],
    ['{"\\u0069d":"job","reason":"old","status":"queued"}',{ reason: 'new' },[]],
    ['{"\\u0072eason":"old","id":"job","status":"queued"}',{ reason: 'new' },[]],
    ['{"\\u0072eason":"old","id":"job","status":"queued"}',{ reason: 'new' },['reason']],
    ['{"reason":"old","status":"queued","keep":null}',{},['reason','status']],
  ];
  for (const [original, replacements, removed] of cases) {
    const parameters: string[] = [original];
    let sql = '?';
    if (removed.length) { sql = `json_remove(${sql},${removed.map(() => '?').join(',')})`; parameters.push(...removed.map((key) => `$.${key}`)); }
    for (const [key, value] of Object.entries(replacements)) {
      sql = `json_set(${sql},?,json(?))`; parameters.push(`$.${key}`,JSON.stringify(value));
    }
    const expected = sqlite.prepare(`SELECT json(${sql}) AS value`).get(...parameters)!.value;
    const actual = (await engine.query<{ value: string }>('SELECT partner_hub.flow_json_object_edit($1::json,$2::json,$3)::text AS value',
      [original,JSON.stringify(replacements),removed])).rows[0].value;
    assert.equal(actual, expected, original);
  }
  for (const original of ['null','[]','{"id":1,"id":2}','{"nested":{"a":1,"\\u0061":2}}']) {
    assert.equal((await engine.query<{ value: null }>('SELECT partner_hub.flow_json_object_edit($1::json,\'{}\'::json)::text AS value',[original])).rows[0].value,null);
  }
});

void test('AI policy changes every queued job exactly and report queue adds one exact command-bound job', async (t) => {
  const { engine, close } = await postgresFixture(); t.after(close);
  const before = initial(); before.ai.enabled = true;
  before.jobs = ['queued','processing','failed','complete','blocked','queued'].map((status,index) => job(status,`job-${index}`));
  const after = structuredClone(before); after.ai.enabled = false;
  after.jobs.filter((item) => item.status === 'queued').forEach((item) => { item.status = 'blocked'; item.reason = '대표가 자동생성을 중지했습니다.'; });
  async function check(value: Value, expected: boolean) {
    assert.equal(await ai(engine,before,value,'set_ai_policy'),expected);
    assert.equal(sqliteAllows(before,value,'set_ai_policy',schema.consultingFlowsSetAiPolicyJobsTriggerSql),expected);
  }
  await check(after,true);
  for (const change of [
    (v: Value) => { v.jobs[0].reason = 'wrong'; },
    (v: Value) => { v.jobs[5] = before.jobs[5]; },
    (v: Value) => { v.jobs[1].reason = 'unrelated'; },
    (v: Value) => { v.jobs.reverse(); },
    (v: Value) => { v.jobs.push(job()); },
    (v: Value) => { v.jobs[0].extra = null; },
  ]) { const changed = structuredClone(after); change(changed); await check(changed,false); }
  assert.equal(await ai(engine,after,{ ...after,ai:{enabled:true} },'set_ai_policy'),true,'enabling preserves existing jobs');
  for (const enabled of [false,true]) {
    const old = initial(); old.ai.enabled = enabled; old.jobs = [job('complete')];
    const next = structuredClone(old); next.jobs.push({ id: `${commandId}-job`,stage:1,status:enabled?'queued':'blocked',
      reason:enabled?'':'김성민 대표의 외부 AI 자동생성 승인이 필요합니다.',createdAt:stamp });
    assert.equal(await ai(engine,old,next,'queue_report1'),true);
    assert.equal(sqliteAllows(old,next,'queue_report1',schema.consultingFlowsQueueReportJobEffectTriggerSql),true);
    for (const change of [
      (v: Value) => { v.jobs[1].id = 'wrong'; }, (v: Value) => { v.jobs[1].stage = 4; },
      (v: Value) => { v.jobs[1].status = 'processing'; }, (v: Value) => { v.jobs[1].reason = 'wrong'; },
      (v: Value) => { v.jobs[1].createdAt = 'wrong'; }, (v: Value) => { v.jobs[1].extra = null; },
      (v: Value) => { v.jobs[0].reason = 'changed'; }, (v: Value) => { v.jobs.push(job()); },
    ]) {
      const changed = structuredClone(next); change(changed);
      assert.equal(await ai(engine,old,changed,'queue_report1'),false);
      assert.equal(sqliteAllows(old,changed,'queue_report1',schema.consultingFlowsQueueReportJobEffectTriggerSql),false);
    }
  }
  for (const value of [null,[],{}, { ...after,jobs:[null] },{ ...after,ai:{enabled:0} }]) assert.equal(await ai(engine,before,value,'set_ai_policy'),false);
  assert.equal(await ai(engine,before,after,'unknown'),false);
});

void test('retry changes exactly one eligible job and appends immutable failure evidence before clearing it', async (t) => {
  const { engine, close } = await postgresFixture(); t.after(close);
  for (const status of ['blocked','failed','processing']) for (const hasEvidence of [false,true]) {
    const before = initial(); before.ai.enabled = true;
    before.jobs = [job(status),job('failed','other-job')];
    before.jobs[0].startedAt = '2026-09-09T11:00:00.000Z';
    if (hasEvidence) { before.jobs[0].failureEvidence = { auditId:'failure',observedAt:stamp }; before.jobs[0].failureEvidenceHistory = [{ auditId:'earlier' }]; }
    const after = structuredClone(before); const next = after.jobs[0];
    if (hasEvidence) next.failureEvidenceHistory = [...next.failureEvidenceHistory as Item[],next.failureEvidence];
    delete next.failureEvidence; delete next.startedAt; next.status = 'queued'; next.reason = '';
    assert.equal(await ai(engine,before,after,'retry_job'),true,`${status}/${hasEvidence}`);
    assert.equal(sqliteAllows(before,after,'retry_job',schema.consultingFlowsRetryJobEffectTriggerSql),true);
    for (const change of [
      (v: Value) => { v.jobs[0].reason = 'wrong'; }, (v: Value) => { v.jobs[0].startedAt = null; },
      (v: Value) => { v.jobs[0].stage = 4; }, (v: Value) => { v.jobs[1].status='queued'; v.jobs[1].reason=''; },
      (v: Value) => { v.jobs[1].reason='unrelated'; }, (v: Value) => { v.jobs.reverse(); },
      (v: Value) => { v.jobs[0].failureEvidence = null; },
    ]) {
      const changed = structuredClone(after); change(changed);
      assert.equal(await ai(engine,before,changed,'retry_job'),false);
      assert.equal(sqliteAllows(before,changed,'retry_job',schema.consultingFlowsRetryJobEffectTriggerSql),false);
    }
    if (hasEvidence) for (const history of [[],[{auditId:'forged'}],null,[{auditId:'earlier'},{auditId:'failure'}, {auditId:'failure'}]]) {
      const changed = structuredClone(after); changed.jobs[0].failureEvidenceHistory=history;
      assert.equal(await ai(engine,before,changed,'retry_job'),false);
    }
    assert.equal(await ai(engine,before,before,'retry_job'),false,'no selected retry');
  }
  const before = initial(); before.ai.enabled=true; before.jobs=[job('failed')];
  before.jobs[0].failureEvidence={auditId:'last'};
  before.jobs[0].failureEvidenceHistory=Array.from({length:20},(_,index)=>({auditId:`prior-${index}`}));
  const after=structuredClone(before); after.jobs[0].status='queued'; after.jobs[0].reason='';
  after.jobs[0].failureEvidenceHistory=[...after.jobs[0].failureEvidenceHistory as Item[],after.jobs[0].failureEvidence]; delete after.jobs[0].failureEvidence;
  assert.equal(await ai(engine,before,after,'retry_job'),false,'history capacity');
});

void test('manual source effects append at most one new source and archive exactly one original without rewriting history', async (t) => {
  const { engine, close } = await postgresFixture(); t.after(close);
  const before=initial(); before.files=[file('first'),file('second')];
  const after=structuredClone(before); after.files.push(file('new'));
  assert.equal(await source(engine,before,before,'save_source'),true,'text-only effect checked by boundary layer');
  assert.equal(await source(engine,before,after,'save_source'),true);
  for(const change of [
    (v:Value)=>{v.files.push(file('extra'));}, (v:Value)=>{v.files[0].name='rewrite.pdf';},
    (v:Value)=>{v.files[2].purpose='report';}, (v:Value)=>{v.files[2].createdAt='wrong';},
    (v:Value)=>{v.files[2].intakeFileId='must-use-import';}, (v:Value)=>{v.files[2].intakeFileId=null;},
  ]) {const changed=structuredClone(after);change(changed);
    assert.equal(await source(engine,before,changed,'save_source'),false);
    assert.equal(sqliteAllows(before,changed,'save_source',schema.consultingFlowsSaveSourceEffectTriggerSql),false);
  }
  const archived=structuredClone(before); archived.files[1].purpose='source_archived';
  assert.equal(await source(engine,before,archived,'exclude_source'),true);
  assert.equal(sqliteAllows(before,archived,'exclude_source',schema.consultingFlowsExcludeSourceEffectTriggerSql),true);
  for(const change of [
    (v:Value)=>{v.files[0].purpose='source_archived';}, (v:Value)=>{v.files[1].name='changed';},
    (v:Value)=>{v.files.reverse();}, (v:Value)=>{v.files[1].extra=null;}, (v:Value)=>{v.files.pop();},
  ]) {const changed=structuredClone(archived);change(changed);
    assert.equal(await source(engine,before,changed,'exclude_source'),false);
    assert.equal(sqliteAllows(before,changed,'exclude_source',schema.consultingFlowsExcludeSourceEffectTriggerSql),false);
  }
  assert.equal(await source(engine,before,before,'exclude_source'),false);
  assert.equal(await source(engine,archived,before,'exclude_source'),false,'no archive reversal');
});

void test('intake source origin uses actual private company ledgers, stable ownership and submitted draft links', async (t) => {
  const { engine, close } = await postgresFixture(); t.after(close);
  await engine.exec('SET ROLE service_role');
  let sequence=0;
  async function seed(options: { assignment?:string; linkedCase?:string; upload?:'pending'|'deleted'; metadata?:boolean|'mismatch'; integrity?:boolean|'etag'|'wrong-mime'; key?:boolean|'wrong' } = {}) {
    const sourceId=`synthetic-source-${++sequence}`;
    await engine.query(`INSERT INTO partner_hub.company_file_objects VALUES ($1,$2,'가상.pdf','가상기업','재무자료','가상자료','가상담당','synthetic-user','synthetic@example.invalid','application/pdf',100,$3)`,[sourceId,`synthetic/${sourceId}`,stamp]);
    if(options.key!==false) await engine.query("INSERT INTO partner_hub.company_file_storage_keys SELECT id,CASE WHEN $2::boolean THEN storage_key||'-wrong' ELSE storage_key END FROM partner_hub.company_file_objects WHERE id=$1",[sourceId,options.key==='wrong']);
    if(options.metadata!==false) await engine.query(`INSERT INTO partner_hub.company_file_metadata SELECT id,original_name,company,category,CASE WHEN $2::boolean THEN 'wrong title' ELSE title END,assigned_trainee,uploaded_by_user_id,uploaded_by_email,content_type,size_bytes,created_at FROM partner_hub.company_file_objects WHERE id=$1`,[sourceId,options.metadata==='mismatch']);
    if(options.integrity!==false) await engine.query('INSERT INTO partner_hub.company_file_object_integrity VALUES ($1,$2,$3,$4)',[sourceId,options.integrity==='etag'?'etag':'metadata',options.integrity==='etag'?'synthetic-etag':null,options.integrity==='wrong-mime'?'text/plain':'application/pdf']);
    if(options.assignment!==undefined) await engine.query('INSERT INTO partner_hub.company_file_assignments VALUES ($1,$2)',[sourceId,options.assignment]);
    if(options.linkedCase) await engine.query('INSERT INTO partner_hub.company_file_case_links VALUES ($1,$2)',[sourceId,options.linkedCase]);
    if(options.upload) await engine.query('INSERT INTO partner_hub.company_file_upload_requests VALUES ($1,$2,$3,$4,$5,$6)',['synthetic-owner',sourceId,'a'.repeat(64),sourceId,stamp,options.upload]);
    return { ...file(`imported-${sourceId}`),intakeFileId:sourceId,intakeSourceHash:'b'.repeat(64),sourceReviewedAt:stamp,sourceReviewedBy:'synthetic-admin' };
  }
  async function check(imported: Item, expected: boolean, before=initial()) {
    const after=structuredClone(before); after.files.push(imported);
    assert.equal(await source(engine,before,after,'import_intake_source'),expected,JSON.stringify(imported));
  }
  const legacy=await seed(); await check(legacy,true);
  await check(await seed({integrity:'etag'}),true);
  await check(legacy,false,{...initial(),partnerName:'다른담당'});
  await check(legacy,false,{...initial(),company:'다른기업'});
  const assigned=await seed({assignment:'synthetic-partner',linkedCase:'synthetic-case'});
  await check(assigned,true,{...initial(),partnerName:'담당 이름 변경'});
  await check(assigned,false,{...initial(),partnerId:'reassigned'});
  for(const options of [{assignment:''},{assignment:'other'},{linkedCase:'other-case'},{upload:'deleted' as const},{metadata:false},{integrity:false},{key:false}]) await check(await seed(options),false);
  for(const options of [{metadata:'mismatch' as const},{integrity:'wrong-mime' as const},{key:'wrong' as const}]) await check(await seed(options),false);
  for(const change of [
    {intakeFileId:'absent'}, {intakeFileId:null}, {intakeSourceHash:'f'.repeat(63)}, {intakeSourceHash:'A'.repeat(64)},
    {sourceReviewedAt:'old'}, {sourceReviewedBy:' '}, {sourceReviewedBy:null}, {purpose:'report'}, {createdAt:'old'},
  ]) await check({...assigned,...change},false);
  const draft=await seed({assignment:'synthetic-partner',linkedCase:'case-draft-synthetic',upload:'pending'});
  const before={...initial(),caseId:'case-draft-synthetic'}; await check(draft,false,before);
  await engine.query('INSERT INTO partner_hub.portal_state VALUES ($1,$2,$3)',[schema.portalStateId,JSON.stringify({companyDocuments:[{storageFileId:draft.intakeFileId,caseId:before.caseId}]}),stamp]);
  await check(draft,true,before);
  for(const documents of [null,{},[null],[{storageFileId:draft.intakeFileId,caseId:'other'}]]) {
    await engine.query('UPDATE partner_hub.portal_state SET payload=$1',[JSON.stringify({companyDocuments:documents})]); await check(draft,false,before);
  }
  const linked=JSON.stringify([{storageFileId:draft.intakeFileId,caseId:before.caseId}]);
  await engine.query('UPDATE partner_hub.portal_state SET payload=$1',[`{"companyDocuments":${linked},"companyDocuments":${linked}}`]);
  await check(draft,false,before);
  const legacyDraft=await seed({linkedCase:before.caseId}); await check(legacyDraft,true,before);
});

void test('source/AI effect remote rollback probe runs against the full PostgreSQL fixture', async (t) => {
  const { engine, close } = await postgresFixture(); t.after(close);
  await engine.exec(await readFile(new URL('./supabase-flow-source-ai-rollback.sql',import.meta.url),'utf8'));
  assert.equal((await engine.query<{ n:number }>('SELECT count(*)::integer AS n FROM partner_hub.company_file_objects')).rows[0].n,0);
});
