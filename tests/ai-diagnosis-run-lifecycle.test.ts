import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  claimStepZeroRequest,
  completeStepZeroRequest,
  ensureAiDiagnosisTables,
  failStepZeroRequest,
  readLatestStepZeroRun,
  type SavedStepZeroRun,
} from '../lib/ai-diagnosis';
import { companyFileDatabase } from '../lib/company-files';

const fingerprint = 'a'.repeat(64);

function claimInput(id: string, caseId: string) {
  return {
    requestId: id,
    requestFingerprint: fingerprint,
    caseId,
    company: '가상 진단기업',
    instructionVersion: 'test-instruction-v1',
    model: 'synthetic-model',
    createdByUserId: 'synthetic-admin',
    createdAt: '2026-09-05T00:00:00.000Z',
  };
}

function completedRun(id: string, caseId: string): SavedStepZeroRun {
  return {
    id,
    caseId,
    company: '가상 진단기업',
    stage: 'Step 0',
    status: '대표 검토 대기',
    instructionVersion: 'test-instruction-v1',
    model: 'synthetic-model',
    result: {
      companyOverview: '가상 기업 현황',
      confirmedStrengths: [],
      mainRisks: ['확인 필요'],
      solutionCandidates: [],
      verificationQuestions: [],
      missingDocuments: [],
      complianceNotes: ['대표 검토 전 내부 초안'],
      nextAction: '대표가 결과를 검토합니다.',
    },
    usage: { inputTokens: 10, outputTokens: 20 },
    createdAt: '2026-09-05T00:01:00.000Z',
  };
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(target);
      return /\.(?:ts|tsx)$/.test(entry.name) ? [target] : [];
    }),
  );
  return nested.flat();
}

void test('AI diagnosis runs preserve one durable forward lifecycle', async () => {
  const db = companyFileDatabase();
  await ensureAiDiagnosisTables(db);
  const runId = 'diagnosis-lifecycle-completed';
  const caseId = 'diagnosis-lifecycle-case';
  assert.deepEqual(await claimStepZeroRequest(claimInput(runId, caseId)), {
    state: 'claimed',
  });
  const pending = await db
    .prepare('SELECT * FROM ai_diagnosis_runs WHERE id = ?1')
    .bind(runId)
    .first();
  assert.ok(pending);

  await assert.rejects(
    db
      .prepare(
        `INSERT INTO ai_diagnosis_runs
          (id, case_id, company, stage, status, instruction_version, model,
           result_json, input_tokens, output_tokens, created_by_user_id, created_at)
         VALUES (?1, ?2, '가상 진단기업', 'Step 1', '생성중', 'v1', 'model', ?3, 0, 0, 'admin', ?4)`,
      )
      .bind(
        'diagnosis-invalid-insert',
        'diagnosis-invalid-case',
        JSON.stringify({ _requestFingerprint: fingerprint }),
        '2026-09-05T00:00:00.000Z',
      )
      .run(),
    /insert envelope is invalid/,
  );
  await assert.rejects(
    db
      .prepare(
        `INSERT INTO ai_diagnosis_runs
          (id, case_id, company, stage, status, instruction_version, model,
           result_json, input_tokens, output_tokens, created_by_user_id, created_at)
         VALUES (?1, ?2, '가상 진단기업', 'Step 0', '생성중', 'v1', 'model',
           ?3, 0, 0, 'admin', '2026-02-30T00:00:00.000Z')`,
      )
      .bind(
        'diagnosis-invalid-date',
        'diagnosis-invalid-date-case',
        JSON.stringify({ _requestFingerprint: fingerprint }),
      )
      .run(),
    /timestamp envelope|insert envelope is invalid/,
  );
  for (const [index, resultJson] of [
    JSON.stringify({ _requestFingerprint: fingerprint, unexpected: true }),
    `{${' '.repeat(300)}"_requestFingerprint":"${fingerprint}"}`,
  ].entries())
    await assert.rejects(
      db
        .prepare(
          `INSERT INTO ai_diagnosis_runs
            (id, case_id, company, stage, status, instruction_version, model,
             result_json, input_tokens, output_tokens, created_by_user_id, created_at)
           VALUES (?1, ?2, '가상 진단기업', 'Step 0', '생성중', 'v1',
             'model', ?3, 0, 0, 'admin', '2026-09-05T00:00:00.000Z')`,
        )
        .bind(
          `diagnosis-invalid-pending-${index}`,
          `diagnosis-invalid-pending-case-${index}`,
          resultJson,
        )
        .run(),
      /pending envelope is invalid/,
    );
  await assert.rejects(
    db
      .prepare('UPDATE ai_diagnosis_runs SET case_id = ?1 WHERE id = ?2')
      .bind('another-case', runId)
      .run(),
    /identity is immutable/,
  );
  await assert.rejects(
    db
      .prepare(
        "UPDATE ai_diagnosis_runs SET status = '대표 검토 대기' WHERE id = ?1",
      )
      .bind(runId)
      .run(),
    /result envelope is invalid/,
  );
  assert.deepEqual(
    await db
      .prepare('SELECT * FROM ai_diagnosis_runs WHERE id = ?1')
      .bind(runId)
      .first(),
    pending,
  );

  const validEnvelope = {
    ...completedRun(runId, caseId).result,
    _requestFingerprint: fingerprint,
  };
  for (const invalidEnvelope of [
    { ...validEnvelope, mainRisks: [3] },
    { ...validEnvelope, unexpected: true },
  ])
    await assert.rejects(
      db
        .prepare(
          `UPDATE ai_diagnosis_runs SET status = '대표 검토 대기',
            result_json = ?1, input_tokens = 10, output_tokens = 20,
            created_at = '2026-09-05T00:01:00.000Z' WHERE id = ?2`,
        )
        .bind(JSON.stringify(invalidEnvelope), runId)
        .run(),
      /result envelope is invalid/,
    );
  await assert.rejects(
    db
      .prepare(
        `UPDATE ai_diagnosis_runs SET status = '대표 검토 대기',
          result_json = ?1, input_tokens = 10, output_tokens = 20,
          created_at = '2026-09-05T00:01:00.000Z' WHERE id = ?2`,
      )
      .bind(
        JSON.stringify({ ...validEnvelope, mainRisks: ['손상\ud800문자열'] }),
        runId,
      )
      .run(),
    /text envelope is invalid/,
  );
  for (const [inputTokens, outputTokens] of [
    [0, 20],
    [10, 0],
    [10, 4_001],
  ])
    await assert.rejects(
      db
        .prepare(
          `UPDATE ai_diagnosis_runs SET status = '대표 검토 대기',
            result_json = ?1, input_tokens = ?2, output_tokens = ?3,
            created_at = '2026-09-05T00:01:00.000Z' WHERE id = ?4`,
        )
        .bind(JSON.stringify(validEnvelope), inputTokens, outputTokens, runId)
        .run(),
      /usage envelope|transition is invalid/,
    );
  assert.deepEqual(
    await db
      .prepare('SELECT * FROM ai_diagnosis_runs WHERE id = ?1')
      .bind(runId)
      .first(),
    pending,
  );

  const completed = completedRun(runId, caseId);
  for (const invalid of [
    { ...completed, createdAt: '2026-02-30T00:01:00.000Z' },
    { ...completed, usage: { inputTokens: -1, outputTokens: 20 } },
    { ...completed, usage: { inputTokens: 0, outputTokens: 20 } },
    { ...completed, usage: { inputTokens: 10, outputTokens: 0 } },
    { ...completed, usage: { inputTokens: 10, outputTokens: 4_001 } },
  ])
    await assert.rejects(
      completeStepZeroRequest(invalid, 'synthetic-admin', fingerprint),
      /완료 메타데이터 형식이 올바르지 않습니다/,
    );
  assert.equal(
    await completeStepZeroRequest(completed, 'synthetic-admin', fingerprint),
    true,
  );
  assert.deepEqual(await readLatestStepZeroRun(caseId), completed);
  assert.deepEqual(
    await claimStepZeroRequest({
      ...claimInput(runId, caseId),
      model: 'another-model',
    }),
    { state: 'conflict' },
  );
  await assert.rejects(
    db
      .prepare("UPDATE ai_diagnosis_runs SET status = '생성실패' WHERE id = ?1")
      .bind(runId)
      .run(),
    /transition is invalid/,
  );
  await assert.rejects(
    db.prepare('DELETE FROM ai_diagnosis_runs WHERE id = ?1').bind(runId).run(),
    /run is durable/,
  );

  const failedId = 'diagnosis-lifecycle-failed';
  const failedCaseId = 'diagnosis-lifecycle-failed-case';
  assert.deepEqual(
    await claimStepZeroRequest(claimInput(failedId, failedCaseId)),
    { state: 'claimed' },
  );
  await failStepZeroRequest(failedId, 'synthetic-admin', fingerprint);
  await assert.rejects(
    db
      .prepare("UPDATE ai_diagnosis_runs SET status = '생성중' WHERE id = ?1")
      .bind(failedId)
      .run(),
    /transition is invalid/,
  );
});

void test('AI diagnosis run identity fields stay within the API envelope', async () => {
  const db = companyFileDatabase();
  await ensureAiDiagnosisTables(db);
  const base = claimInput(
    'diagnosis-field-boundary',
    'diagnosis-field-boundary-case',
  );
  const invalidClaims = [
    { ...base, requestId: 'unsafe request id' },
    { ...base, caseId: '가'.repeat(121) },
    { ...base, company: '가'.repeat(101) },
    { ...base, instructionVersion: 'v'.repeat(101) },
    { ...base, model: 'm'.repeat(201) },
    { ...base, createdByUserId: 'u'.repeat(257) },
    { ...base, company: '손상\ud800기업' },
    { ...base, model: '손상\u0001모델' },
    { ...base, createdAt: '2026-02-30T00:00:00.000Z' },
  ];
  for (const input of invalidClaims)
    await assert.rejects(
      claimStepZeroRequest(input),
      /실행 신원 형식이 올바르지 않습니다/,
    );

  const directBase = {
    id: 'diagnosis-direct-field-boundary',
    caseId: 'diagnosis-direct-field-case',
    company: '가상 진단기업',
    instructionVersion: 'v1',
    model: 'model',
    actorId: 'admin',
  };
  for (const values of [
    { ...directBase, id: 'unsafe id' },
    { ...directBase, caseId: '가'.repeat(121) },
    { ...directBase, company: '가'.repeat(101) },
    { ...directBase, instructionVersion: 'v'.repeat(101) },
    { ...directBase, model: 'm'.repeat(201) },
    { ...directBase, actorId: 'u'.repeat(257) },
  ])
    await assert.rejects(
      db
        .prepare(
          `INSERT INTO ai_diagnosis_runs
            (id, case_id, company, stage, status, instruction_version, model,
             result_json, input_tokens, output_tokens, created_by_user_id, created_at)
           VALUES (?1, ?2, ?3, 'Step 0', '생성중', ?4, ?5, ?6, 0, 0, ?7,
             '2026-09-05T00:00:00.000Z')`,
        )
        .bind(
          values.id,
          values.caseId,
          values.company,
          values.instructionVersion,
          values.model,
          JSON.stringify({ _requestFingerprint: fingerprint }),
          values.actorId,
        )
        .run(),
      /field envelope is invalid/,
    );

  for (const values of [
    { ...directBase, company: '손상\u0001기업' },
    { ...directBase, model: '손상�모델' },
  ])
    await assert.rejects(
      db
        .prepare(
          `INSERT INTO ai_diagnosis_runs
            (id, case_id, company, stage, status, instruction_version, model,
             result_json, input_tokens, output_tokens, created_by_user_id, created_at)
           VALUES (?1, ?2, ?3, 'Step 0', '생성중', ?4, ?5, ?6, 0, 0, ?7,
             '2026-09-05T00:00:00.000Z')`,
        )
        .bind(
          values.id,
          values.caseId,
          values.company,
          values.instructionVersion,
          values.model,
          JSON.stringify({ _requestFingerprint: fingerprint }),
          values.actorId,
        )
        .run(),
      /text envelope is invalid/,
    );
});

void test('application code has one AI diagnosis run writer and no deleter', async () => {
  const files = (
    await Promise.all(
      ['app', 'lib'].map((root) => sourceFiles(path.resolve(root))),
    )
  ).flat();
  const writers: string[] = [];
  const deleters: string[] = [];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const relative = path.relative(process.cwd(), file).replaceAll('\\', '/');
    if (/\b(?:INSERT\s+INTO|UPDATE)\s+ai_diagnosis_runs\b/i.test(source))
      writers.push(relative);
    if (/\bDELETE\s+FROM\s+ai_diagnosis_runs\b/i.test(source))
      deleters.push(relative);
  }

  assert.deepEqual(writers, ['lib/ai-diagnosis.ts']);
  assert.deepEqual(deleters, []);
});
