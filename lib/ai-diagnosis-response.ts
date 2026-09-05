import type { SavedStepZeroRun, StepZeroResult } from './ai-diagnosis';
import {
  AI_PROVIDER_MESSAGE_ID_LIMIT,
  AI_PROVIDER_REQUEST_ID_LIMIT,
  STEP_ZERO_MAX_OUTPUT_TOKENS,
} from './storage-limits';
import { isSafeStoredText } from './unicode-text';
import { isUtcMillisecondTimestamp } from './utc-timestamp';

type JsonObject = Record<string, unknown>;

export type AiIntegrationReadiness = {
  provider: string;
  directProjectConnection: boolean;
  instructionImported: boolean;
  instructionVersion: string;
  apiKeyConfigured: boolean;
  modelConfigured: boolean;
  model: string | null;
  sourceStorageConfigured: boolean;
  generationEnabled: boolean;
  nextAction: string;
};

export class AiDiagnosisResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AiDiagnosisResponseError';
  }
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function text(value: unknown, maxLength = 12_000) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    isSafeStoredText(value) &&
    value.length <= maxLength
  );
}

function safeInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER) {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= 1 &&
    Number(value) <= maximum
  );
}

function serverError(value: unknown) {
  const payload = asObject(value);
  return text(payload?.error, 1_000) ? (payload?.error as string) : null;
}

async function json(response: Response, fallback: string) {
  try {
    return await response.json();
  } catch {
    throw new AiDiagnosisResponseError(fallback, response.status);
  }
}

export async function readAiIntegrationReadinessResponse(
  response: Response,
): Promise<AiIntegrationReadiness> {
  const raw = await json(response, 'AI 연동 준비상태 응답을 읽지 못했습니다.');
  if (!response.ok)
    throw new AiDiagnosisResponseError(
      serverError(raw) || 'AI 연동 준비상태를 확인하지 못했습니다.',
      response.status,
    );
  const payload = asObject(raw);
  if (
    !payload ||
    !text(payload.provider, 100) ||
    typeof payload.directProjectConnection !== 'boolean' ||
    typeof payload.instructionImported !== 'boolean' ||
    !text(payload.instructionVersion, 100) ||
    typeof payload.apiKeyConfigured !== 'boolean' ||
    typeof payload.modelConfigured !== 'boolean' ||
    (payload.model !== null && !text(payload.model, 200)) ||
    payload.modelConfigured !== (payload.model !== null) ||
    typeof payload.sourceStorageConfigured !== 'boolean' ||
    typeof payload.generationEnabled !== 'boolean' ||
    payload.generationEnabled !==
      (payload.apiKeyConfigured &&
        payload.modelConfigured &&
        payload.sourceStorageConfigured) ||
    !text(payload.nextAction, 500)
  )
    throw new AiDiagnosisResponseError(
      'AI 연동 준비상태 응답 형식이 올바르지 않습니다.',
      response.status,
    );
  return {
    provider: payload.provider as string,
    directProjectConnection: payload.directProjectConnection,
    instructionImported: payload.instructionImported,
    instructionVersion: payload.instructionVersion as string,
    apiKeyConfigured: payload.apiKeyConfigured,
    modelConfigured: payload.modelConfigured,
    model: payload.model as string | null,
    sourceStorageConfigured: payload.sourceStorageConfigured,
    generationEnabled: payload.generationEnabled,
    nextAction: payload.nextAction as string,
  };
}

function parseTextArray(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    value.some((item) => !text(item, 4_000))
  )
    return null;
  return [...value] as string[];
}

function parseResult(value: unknown): StepZeroResult | null {
  const result = asObject(value);
  if (!result || !text(result.companyOverview) || !text(result.nextAction))
    return null;
  const confirmedStrengths = parseTextArray(result.confirmedStrengths);
  const mainRisks = parseTextArray(result.mainRisks);
  const verificationQuestions = parseTextArray(result.verificationQuestions);
  const missingDocuments = parseTextArray(result.missingDocuments);
  const complianceNotes = parseTextArray(result.complianceNotes);
  if (
    !confirmedStrengths ||
    !mainRisks ||
    !verificationQuestions ||
    !missingDocuments ||
    !complianceNotes ||
    !Array.isArray(result.solutionCandidates) ||
    result.solutionCandidates.length > 10
  )
    return null;
  const solutionCandidates = result.solutionCandidates.map((value) => {
    const item = asObject(value);
    return item &&
      text(item.solution, 4_000) &&
      text(item.basis, 4_000) &&
      typeof item.condition === 'string' &&
      item.condition.length <= 4_000
      ? {
          solution: item.solution as string,
          basis: item.basis as string,
          condition: item.condition,
        }
      : null;
  });
  if (solutionCandidates.some((item) => item === null)) return null;
  return {
    companyOverview: result.companyOverview as string,
    confirmedStrengths,
    mainRisks,
    solutionCandidates:
      solutionCandidates as StepZeroResult['solutionCandidates'],
    verificationQuestions,
    missingDocuments,
    complianceNotes,
    nextAction: result.nextAction as string,
  };
}

function parseRun(
  value: unknown,
  expected: {
    caseId: string;
    company?: string;
    runId?: string;
  },
): SavedStepZeroRun | null {
  const run = asObject(value);
  const usage = run ? asObject(run.usage) : null;
  const result = run ? parseResult(run.result) : null;
  if (
    !run ||
    !text(run.id, 100) ||
    run.caseId !== expected.caseId ||
    (expected.company !== undefined && run.company !== expected.company) ||
    (expected.runId !== undefined && run.id !== expected.runId) ||
    !text(run.company, 100) ||
    run.stage !== 'Step 0' ||
    run.status !== '대표 검토 대기' ||
    !text(run.instructionVersion, 100) ||
    !text(run.model, 200) ||
    (run.providerRequestId !== null &&
      !text(run.providerRequestId, AI_PROVIDER_REQUEST_ID_LIMIT)) ||
    (run.providerModel !== null && !text(run.providerModel, 200)) ||
    (run.providerMessageId !== null &&
      !text(run.providerMessageId, AI_PROVIDER_MESSAGE_ID_LIMIT)) ||
    !result ||
    !usage ||
    !safeInteger(usage.inputTokens) ||
    !safeInteger(usage.outputTokens, STEP_ZERO_MAX_OUTPUT_TOKENS) ||
    !isUtcMillisecondTimestamp(run.createdAt)
  )
    return null;
  return {
    id: run.id as string,
    caseId: run.caseId,
    company: run.company as string,
    stage: 'Step 0',
    status: '대표 검토 대기',
    instructionVersion: run.instructionVersion as string,
    model: run.model as string,
    providerRequestId: run.providerRequestId as string | null,
    providerModel: run.providerModel as string | null,
    providerMessageId: run.providerMessageId as string | null,
    result,
    usage: {
      inputTokens: usage.inputTokens as number,
      outputTokens: usage.outputTokens as number,
    },
    createdAt: run.createdAt,
  };
}

export async function readStepZeroRunResponse(
  response: Response,
  expected: {
    caseId: string;
    company?: string;
    runId?: string;
    requireRun?: boolean;
  },
): Promise<{ run: SavedStepZeroRun | null }> {
  const raw = await json(
    response,
    'Step 0 결과 응답을 읽지 못했습니다. 다시 확인해 주세요.',
  );
  if (!response.ok)
    throw new AiDiagnosisResponseError(
      serverError(raw) || 'Step 0 결과를 확인하지 못했습니다.',
      response.status,
    );
  const payload = asObject(raw);
  if (!payload || !Object.hasOwn(payload, 'run'))
    throw new AiDiagnosisResponseError(
      'Step 0 결과 응답 형식이 올바르지 않습니다.',
      response.status,
    );
  if (payload.run === null) {
    if (!expected.requireRun) return { run: null };
  } else {
    const run = parseRun(payload.run, expected);
    if (run) return { run };
  }
  throw new AiDiagnosisResponseError(
    'Step 0 결과 응답 형식이 올바르지 않습니다.',
    response.status,
  );
}
