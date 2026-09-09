import assert from 'node:assert/strict';
import { test } from 'node:test';
import { env } from 'cloudflare:workers';
import { postgresRuntimeFixture, postgresTestOrigin as origin } from './supabase-runtime-fixture';
import { PORTAL_OWNER_EMAIL } from '../lib/member-email';
import { provisionStandaloneAdmin } from '../lib/standalone-admin-store';
import { objects } from './runtime-mock.mjs';
import type { SavedStepZeroRun } from '../lib/ai-diagnosis';

const { claimStepZeroRequest, completeStepZeroRequest, ensureAiDiagnosisTables, failStepZeroRequest, readLatestStepZeroRun } = await import('../lib/ai-diagnosis');
const { mutatePortalState } = await import('../lib/portal-state');
const { loginPassword } = await import('../lib/password-handlers');
const { storeCompanyUpload } = await import('../lib/company-upload-store');
const { companyFileBucket, ensureCompanyFileTables } = await import('../lib/company-files');
const { requirePortalUser } = await import('../lib/portal-auth');
const { currentFileAccess } = await import('../lib/company-file-access');
const { GET, POST } = await import('../app/api/ai-diagnosis/step-zero/route');

const fingerprint = 'a'.repeat(64);
const result = { companyOverview: '가상 기업 현황', confirmedStrengths: [], mainRisks: ['확인 필요'],
  solutionCandidates: [{ solution: '가상 후보', basis: '추가 확인', condition: '' }],
  verificationQuestions: [], missingDocuments: [], complianceNotes: ['대표 검토 전 내부 초안'], nextAction: '가상 입력을 검토합니다.' };
const claim = (requestId = 'postgres-ai-request-001', caseId = 'postgres-ai-case') => ({
  requestId, caseId, requestFingerprint: fingerprint, company: '진단(가상)', instructionVersion: 'synthetic-v1',
  model: 'synthetic-model', createdByUserId: 'synthetic-admin', createdAt: '2026-09-09T00:00:00.000Z',
});
const run = (id = 'postgres-ai-request-001', caseId = 'postgres-ai-case'): SavedStepZeroRun => ({
  id, caseId, company: '진단(가상)', stage: 'Step 0', status: '대표 검토 대기', instructionVersion: 'synthetic-v1',
  model: 'synthetic-model', providerRequestId: 'req_synthetic', providerModel: 'synthetic-provider-model',
  providerMessageId: 'msg_synthetic', result, usage: { inputTokens: 10, outputTokens: 20 }, createdAt: '2026-09-09T00:01:00.000Z',
});
const envelope = () => ({ ...result, _requestFingerprint: fingerprint, _providerRequestId: 'req_synthetic',
  _providerModel: 'synthetic-provider-model', _providerMessageId: 'msg_synthetic' });

void test('PostgreSQL AI requests keep case locks, exact retries, final evidence and stale failure receipts', async (t) => {
  const { db, engine } = await postgresRuntimeFixture(t);
  await engine.exec('SET ROLE service_role');
  assert.deepEqual(await claimStepZeroRequest(claim()), { state: 'claimed' });
  assert.deepEqual(await claimStepZeroRequest(claim()), { state: 'pending' });
  assert.deepEqual(await claimStepZeroRequest({ ...claim(), requestFingerprint: 'b'.repeat(64) }), { state: 'conflict' });
  assert.deepEqual(await claimStepZeroRequest(claim('postgres-ai-competing-001')), { state: 'pending' });
  assert.equal(await completeStepZeroRequest(run(), 'other-admin', fingerprint), false);
  assert.equal(await completeStepZeroRequest(run(), claim().createdByUserId, 'b'.repeat(64)), false);
  assert.equal(await completeStepZeroRequest(run(), claim().createdByUserId, fingerprint), true);
  assert.equal(await completeStepZeroRequest(run(), claim().createdByUserId, fingerprint), false);
  assert.deepEqual(await readLatestStepZeroRun(claim().caseId), run());
  assert.deepEqual(await claimStepZeroRequest(claim()), { state: 'completed', run: run() });
  await assert.rejects(db.prepare('UPDATE ai_diagnosis_runs SET status = status').run(), /OPERATION_FAILED/);
  await assert.rejects(db.prepare('DELETE FROM ai_diagnosis_runs').run(), /OPERATION_FAILED/);
  await assert.rejects(engine.exec('TRUNCATE partner_hub.ai_diagnosis_runs'), /permission denied/);
  const stale = claim('postgres-ai-stale-001', 'postgres-ai-stale-case');
  assert.deepEqual(await claimStepZeroRequest(stale), { state: 'claimed' });
  await failStepZeroRequest(stale.requestId, 'other-admin', fingerprint);
  assert.deepEqual(await claimStepZeroRequest(stale), { state: 'pending' });
  assert.deepEqual(await claimStepZeroRequest({ ...stale, requestId: 'postgres-ai-stale-002', createdAt: '2026-09-09T00:04:59.999Z' }), { state: 'pending' });
  assert.deepEqual(await claimStepZeroRequest({ ...stale, requestId: 'postgres-ai-stale-002', createdAt: '2026-09-09T00:05:00.000Z' }), { state: 'claimed' });
  assert.deepEqual(await claimStepZeroRequest(stale), { state: 'failed' });
  await failStepZeroRequest('postgres-ai-stale-002', stale.createdByUserId, fingerprint);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM ai_diagnosis_runs WHERE status = '생성실패'").first('n'), 2);
  await engine.exec('RESET ROLE');
  await engine.exec('ALTER TABLE partner_hub.ai_diagnosis_runs DISABLE TRIGGER ai_diagnosis_runs_guard');
  await assert.rejects(ensureAiDiagnosisTables(db), /OPERATION_FAILED/);
});

void test('PostgreSQL AI schema rejects malformed, duplicated, oversized and mutable evidence directly', async (t) => {
  const { db } = await postgresRuntimeFixture(t);
  await ensureAiDiagnosisTables(db);
  const insert = (payload: string, field = 'company', fieldValue = '진단(가상)') => db.prepare(`INSERT INTO ai_diagnosis_runs
    (id, case_id, company, stage, status, instruction_version, model, result_json, created_by_user_id, created_at)
    VALUES (?1, 'postgres-ai-case', ?2, 'Step 0', '생성중', 'synthetic-v1', 'synthetic-model', ?3, 'synthetic-admin', ?4)`)
    .bind(field === 'id' ? fieldValue : claim().requestId, field === 'company' ? fieldValue : claim().company,
      payload, field === 'created_at' ? fieldValue : claim().createdAt).run();
  const pending = JSON.stringify({ _requestFingerprint: fingerprint });
  for (const payload of ['{broken', 'null', '[]', '{}', JSON.stringify({ _requestFingerprint: 1 }),
    JSON.stringify({ _requestFingerprint: 'A'.repeat(64) }),
    `{"_requestFingerprint":"${fingerprint}","_requestFingerprint":"${fingerprint}"}`, pending + ' '.repeat(256)])
    await assert.rejects(insert(payload), /OPERATION_FAILED/);
  for (const [field, value] of [['id', 'too-short'], ['id', 'invalid request id'], ['company', ' padded '],
    ['company', '가'.repeat(101)], ['company', 'bad\u0001text'], ['company', 'bad\ufffdtext'],
    ['created_at', '2026-02-30T00:00:00.000Z'], ['created_at', '2026-09-09T00:00:00Z']])
    await assert.rejects(insert(pending, field, value), /OPERATION_FAILED/);
  await insert(pending);
  await assert.rejects(insert(pending, 'id', 'postgres-ai-competing-001'), /OPERATION_FAILED/);
  const complete = (payload: string, input = 1, output = 1, createdAt = run().createdAt) => db.prepare(`UPDATE ai_diagnosis_runs
    SET status = '대표 검토 대기', result_json = ?1, input_tokens = ?2, output_tokens = ?3, created_at = ?4`)
    .bind(payload, input, output, createdAt).run();
  const valid = JSON.stringify(envelope());
  const malformed = [
    { _requestFingerprint: 'b'.repeat(64) }, { _providerRequestId: null }, { _providerModel: ' ' },
    { _providerMessageId: 'x'.repeat(513) }, { companyOverview: '\ufffd' }, { companyOverview: 'x'.repeat(12001) },
    { confirmedStrengths: {} }, { confirmedStrengths: [null] }, { mainRisks: Array(21).fill('위험') },
    { complianceNotes: ['\u0080'] }, { missingDocuments: [' padded '] }, { verificationQuestions: ['x'.repeat(4001)] },
    { solutionCandidates: [{ solution: '후보', basis: '근거' }] },
    { solutionCandidates: [{ solution: '후보', basis: '근거', condition: '', extra: true }] },
    { solutionCandidates: Array(11).fill({ solution: '후보', basis: '근거', condition: '' }) },
    { nextAction: 1 }, { unexpected: 'hidden value' },
    Object.fromEntries(['confirmedStrengths', 'mainRisks', 'verificationQuestions', 'missingDocuments', 'complianceNotes']
      .map((key) => [key, Array(20).fill('가'.repeat(1100))])),
  ];
  for (const mutation of malformed) await assert.rejects(complete(JSON.stringify({ ...envelope(), ...mutation })), /OPERATION_FAILED/);
  for (const payload of ['[]', 'null', '{broken', valid.replace('가상 기업 현황', '\\ud800'),
    valid.replace('가상 기업 현황', '\\u0000'), valid.replace('{', '{"companyOverview":"duplicate",'),
    valid.replace('"solution":"가상 후보"', '"solution":"가상 후보","solution":"duplicate"')])
    await assert.rejects(complete(payload), /OPERATION_FAILED/);
  for (const [input, output] of [[0, 1], [1, 0], [1, 4001], [Number.MAX_SAFE_INTEGER + 1, 1]])
    await assert.rejects(complete(valid, input, output), /OPERATION_FAILED/);
  await assert.rejects(complete(valid, 1, 1, '2026-09-08T23:59:59.999Z'), /OPERATION_FAILED/);
  await assert.rejects(db.prepare("UPDATE ai_diagnosis_runs SET model = 'changed'").run(), /OPERATION_FAILED/);
  await assert.rejects(db.prepare("UPDATE ai_diagnosis_runs SET status = '생성실패', result_json = '{}'").run(), /OPERATION_FAILED/);
  await assert.rejects(db.batch([
    db.prepare("UPDATE ai_diagnosis_runs SET status = '생성실패'"),
    db.prepare("UPDATE ai_diagnosis_runs SET status = '생성중'"),
  ]), /OPERATION_FAILED/);
  assert.equal(await db.prepare('SELECT status FROM ai_diagnosis_runs').first('status'), '생성중');
  await complete(JSON.stringify({ ...envelope(), companyOverview: '😀'.repeat(12000), nextAction: '줄1\n줄2\t확인' }), Number.MAX_SAFE_INTEGER, 4000);
  assert.equal(await db.prepare('SELECT input_tokens FROM ai_diagnosis_runs').first('input_tokens'), Number.MAX_SAFE_INTEGER);
});

void test('PostgreSQL AI HTTP paths combine real admin auth, evidence, replay and revoked consent without provider network', async (t) => {
  const { db } = await postgresRuntimeFixture(t);
  await ensureCompanyFileTables(db);
  const password = 'Synthetic PostgreSQL AI administrator!';
  await provisionStandaloneAdmin(db, { email: PORTAL_OWNER_EMAIL, password });
  const login = await loginPassword(new Request(`${origin}/api/auth/login`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email: PORTAL_OWNER_EMAIL, password }),
  }));
  assert.equal(login.status, 200, await login.clone().text());
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const request = (method: string, requestId = claim().requestId, authenticated = true) => new Request(`${origin}/api/ai-diagnosis/step-zero?caseId=${claim().caseId}`, {
    method, headers: { origin, 'content-type': 'application/json', ...(authenticated ? { cookie } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify({ requestId, caseId: claim().caseId, company: claim().company, pilotMode: true,
      consentConfirmed: true, pilotContext: '업종: 가상 제조업\n요청사항: 가상 정책자금 검토\n모든 수치는 확인 필요' }) } : {}),
  });
  const member = { id: 'ai-partner', name: '가상 담당자', email: 'ai-partner@example.test', status: '활성' };
  const assessment = { id: 'ai-assessment', caseId: claim().caseId, company: claim().company, identityStatus: '일치',
    hasConsultationEvidence: true, privacyMasked: true, personalDataConsent: true, thirdPartyAiConsent: true,
    transcriptConsent: true, level: 'A', decision: '1차 초안 생성 가능', status: '사전점검 완료', updatedAt: '가상 판정 완료' };
  const state = { version: 1, consultationNumber: 0, members: [member],
    cases: [{ id: claim().caseId, company: claim().company, trainee: member.name, partnerMemberId: member.id }],
    tasks: [], timeline: [], schedule: [], companyDocuments: [] as unknown[], diagnosisAssessments: [assessment] };
  await mutatePortalState(() => state);
  const user = await requirePortalUser(request('GET'), state);
  const bucket = companyFileBucket();
  t.after(() => objects.clear());
  for (const category of ['사업자등록증', '재무제표']) {
    const file = await storeCompanyUpload(db, bucket, user, `ai-source-${category}`, {
      originalName: 'synthetic.pdf', company: claim().company, category, title: category, assignedTrainee: member.name,
      partnerMemberId: member.id, caseId: claim().caseId, contentType: 'application/pdf', sizeBytes: 4,
    }, new Uint8Array(4).buffer, [], async () => (await currentFileAccess(request('GET'), user)).payload);
    state.companyDocuments.push({ id: `document-${category}`, company: claim().company, caseId: claim().caseId,
      category, status: '검토완료', storageFileId: file.id, assignedTrainee: member.name, partnerMemberId: member.id });
  }
  await mutatePortalState(() => state);
  const runtime = env as unknown as Record<string, unknown>;
  const keys = ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'ANTHROPIC_EXTERNAL_PROCESSING_ENABLED'];
  const previous = keys.map((key) => [key, runtime[key]] as const);
  t.after(() => { for (const [key, value] of previous) { if (value === undefined) delete runtime[key]; else runtime[key] = value; } });
  Object.assign(runtime, { ANTHROPIC_API_KEY: 'synthetic-not-a-key', ANTHROPIC_MODEL: 'synthetic-model', ANTHROPIC_EXTERNAL_PROCESSING_ENABLED: 'true' });
  let calls = 0;
  let revokeConsent = false;
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    assert.equal(input, 'https://api.anthropic.com/v1/messages');
    calls++;
    if (revokeConsent) await mutatePortalState(() => ({ ...state, diagnosisAssessments: [{ ...assessment, thirdPartyAiConsent: false }] }));
    return Response.json({ id: 'msg_synthetic', type: 'message', role: 'assistant', model: 'synthetic-provider-model',
      stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(result) }], usage: { input_tokens: 10, output_tokens: 20 } },
    { headers: { 'request-id': 'req_synthetic' } });
  });
  assert.equal((await GET(request('GET', undefined, false))).status, 401);
  const spoofed = request('GET', undefined, false);
  spoofed.headers.set('oai-authenticated-user-email', PORTAL_OWNER_EMAIL);
  spoofed.headers.set('oai-authenticated-user-id', 'spoofed');
  assert.equal((await GET(spoofed)).status, 401);
  const crossSite = request('POST'); crossSite.headers.set('origin', 'https://other.example.test');
  assert.equal((await POST(crossSite)).status, 403);
  const completed = await POST(request('POST'));
  assert.equal(completed.status, 201, await completed.clone().text());
  assert.equal((await POST(request('POST'))).status, 200);
  assert.equal(calls, 1, 'exact replay must not call the provider twice');
  const read = await GET(request('GET'));
  assert.equal(read.status, 200); assert.match(read.headers.get('cache-control')!, /no-store/);
  revokeConsent = true;
  const revoked = await POST(request('POST', 'postgres-ai-request-002'));
  assert.equal(revoked.status, 409, await revoked.clone().text());
  assert.equal(calls, 2);
  assert.equal(await db.prepare('SELECT status FROM ai_diagnosis_runs WHERE id = ?1').bind('postgres-ai-request-002').first('status'), '생성실패');
  assert.equal((await POST(request('POST', 'postgres-ai-request-003'))).status, 403);
  assert.equal(calls, 2, 'revoked consent blocks subsequent external processing');
});
