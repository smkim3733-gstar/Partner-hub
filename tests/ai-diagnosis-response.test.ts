import assert from 'node:assert/strict';
import test from 'node:test';
import { GET as readiness } from '../app/api/ai-diagnosis/readiness/route';
import { GET as latestRun } from '../app/api/ai-diagnosis/step-zero/route';
import {
  AiDiagnosisResponseError,
  readAiIntegrationReadinessResponse,
  readStepZeroRunResponse,
} from '../lib/ai-diagnosis-response';

const ownerHeaders = {
  'oai-authenticated-user-id': 'local-owner',
  'oai-authenticated-user-email': 'seedy@sites.test',
};
const readinessPayload = {
  provider: 'Anthropic Claude API',
  directProjectConnection: false,
  instructionImported: true,
  instructionVersion: 'v-test',
  apiKeyConfigured: false,
  modelConfigured: false,
  model: null,
  sourceStorageConfigured: true,
  generationEnabled: false,
  nextAction: 'Anthropic API 키 연결 필요',
};
const run = {
  id: 'step-zero-request-1',
  caseId: 'case-1',
  company: '가상기업 (가상)',
  stage: 'Step 0',
  status: '대표 검토 대기',
  instructionVersion: 'v-test',
  model: 'claude-test',
  result: {
    companyOverview: '확인된 가상 현황',
    confirmedStrengths: ['가상 강점'],
    mainRisks: ['확인 필요'],
    solutionCandidates: [
      { solution: '후보', basis: '가상 근거', condition: '' },
    ],
    verificationQuestions: ['확인 질문'],
    missingDocuments: [],
    complianceNotes: ['대표 검토 전'],
    nextAction: '근거 확인',
  },
  usage: { inputTokens: 10, outputTokens: 20 },
  createdAt: '2026-09-03T00:00:00.000Z',
};

void test('real readiness and latest-run routes pass client response guards', async () => {
  const readinessResult = await readAiIntegrationReadinessResponse(
    await readiness(
      new Request('http://localhost/api/ai-diagnosis/readiness', {
        headers: ownerHeaders,
      }),
    ),
  );
  const runResult = await readStepZeroRunResponse(
    await latestRun(
      new Request(
        'http://localhost/api/ai-diagnosis/step-zero?caseId=no-saved-run',
        { headers: ownerHeaders },
      ),
    ),
    { caseId: 'no-saved-run' },
  );

  assert.equal(typeof readinessResult.generationEnabled, 'boolean');
  assert.equal(runResult.run, null);
  for (const query of [
    '?caseId=first&caseId=second',
    `?caseId=${'x'.repeat(121)}`,
  ])
    assert.equal(
      (
        await latestRun(
          new Request(`http://localhost/api/ai-diagnosis/step-zero${query}`, {
            headers: ownerHeaders,
          }),
        )
      ).status,
      400,
    );
});

void test('readiness response returns only validated public fields', async () => {
  const result = await readAiIntegrationReadinessResponse(
    Response.json({ ...readinessPayload, secret: 'must-not-escape' }),
  );

  assert.deepEqual(result, readinessPayload);
  assert.equal(Object.hasOwn(result, 'secret'), false);
});

void test('readiness cannot enable generation with inconsistent prerequisites', async () => {
  for (const body of [
    { ...readinessPayload, generationEnabled: true },
    { ...readinessPayload, modelConfigured: true },
    { ...readinessPayload, instructionVersion: '' },
    { ...readinessPayload, apiKeyConfigured: 'yes' },
  ])
    await assert.rejects(
      readAiIntegrationReadinessResponse(Response.json(body)),
      /응답 형식이 올바르지 않습니다/,
    );
});

void test('valid Step 0 response preserves a matching run and explicit empty state', async () => {
  assert.deepEqual(
    await readStepZeroRunResponse(Response.json({ run }), {
      caseId: run.caseId,
      company: run.company,
      runId: run.id,
      requireRun: true,
    }),
    { run },
  );
  assert.deepEqual(
    await readStepZeroRunResponse(Response.json({ run: null }), {
      caseId: run.caseId,
    }),
    { run: null },
  );
});

void test('mismatched or malformed Step 0 results never reach the screen', async () => {
  for (const value of [
    { ...run, caseId: 'another-case' },
    { ...run, status: '완료' },
    { ...run, usage: { inputTokens: -1, outputTokens: 20 } },
    { ...run, createdAt: 'not-a-date' },
    { ...run, result: { ...run.result, mainRisks: [3] } },
    { ...run, model: '손상�모델' },
    { ...run, result: { ...run.result, mainRisks: ['손상\u0001위험'] } },
  ])
    await assert.rejects(
      readStepZeroRunResponse(Response.json({ run: value }), {
        caseId: run.caseId,
      }),
      /응답 형식이 올바르지 않습니다/,
    );
  await assert.rejects(
    readStepZeroRunResponse(Response.json({ run: null }), {
      caseId: run.caseId,
      requireRun: true,
    }),
    /응답 형식이 올바르지 않습니다/,
  );
});

void test('AI response failures retain HTTP status and safe recovery text', async () => {
  await assert.rejects(
    readStepZeroRunResponse(
      Response.json(
        { error: '생성 입력을 다시 확인해 주세요.' },
        { status: 409 },
      ),
      { caseId: run.caseId },
    ),
    (error: unknown) =>
      error instanceof AiDiagnosisResponseError &&
      error.status === 409 &&
      error.message === '생성 입력을 다시 확인해 주세요.',
  );
  await assert.rejects(
    readAiIntegrationReadinessResponse(
      new Response('<html>denied</html>', { status: 403 }),
    ),
    (error: unknown) =>
      error instanceof AiDiagnosisResponseError &&
      error.status === 403 &&
      /응답을 읽지 못했습니다/.test(error.message),
  );
});
