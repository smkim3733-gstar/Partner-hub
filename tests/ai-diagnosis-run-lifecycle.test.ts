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
  assert.deepEqual(
    await db
      .prepare('SELECT * FROM ai_diagnosis_runs WHERE id = ?1')
      .bind(runId)
      .first(),
    pending,
  );

  const completed = completedRun(runId, caseId);
  assert.equal(
    await completeStepZeroRequest(completed, 'synthetic-admin', fingerprint),
    true,
  );
  assert.deepEqual(await readLatestStepZeroRun(caseId), completed);
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
