import {
  aiDiagnosisRunsCaseIndexSql,
  aiDiagnosisRunsCreatedAtInsertTriggerSql,
  aiDiagnosisRunsCreatedAtUpdateTriggerSql,
  aiDiagnosisRunsFieldEnvelopeTriggerSql,
  aiDiagnosisRunsFieldTextTriggerSql,
  aiDiagnosisRunsIdentityTriggerSql,
  aiDiagnosisRunsInsertEnvelopeTriggerSql,
  aiDiagnosisRunsNoDeleteTriggerSql,
  aiDiagnosisRunsPendingCaseIndexSql,
  aiDiagnosisRunsPendingEnvelopeTriggerSql,
  aiDiagnosisRunsResultEnvelopeTriggerSql,
  aiDiagnosisRunsResultTextTriggerSql,
  aiDiagnosisRunsTableSql,
  aiDiagnosisRunsTransitionTriggerSql,
  aiDiagnosisRunsUsageEnvelopeTriggerSql,
} from '@/db/schema';
import { companyFileDatabase } from '@/lib/company-files';
import {
  AI_PROVIDER_REQUEST_ID_LIMIT,
  AI_DIAGNOSIS_RUN_FIELD_LIMITS,
  STEP_ZERO_PENDING_LIMIT_BYTES,
  STEP_ZERO_MAX_OUTPUT_TOKENS,
  STEP_ZERO_PENDING_STALE_MS,
  STEP_ZERO_RESULT_LIMIT_BYTES,
} from '@/lib/storage-limits';
import { isSafeStoredText } from '@/lib/unicode-text';
import { isUtcMillisecondTimestamp } from '@/lib/utc-timestamp';

export type StepZeroResult = {
  companyOverview: string;
  confirmedStrengths: string[];
  mainRisks: string[];
  solutionCandidates: Array<{
    solution: string;
    basis: string;
    condition: string;
  }>;
  verificationQuestions: string[];
  missingDocuments: string[];
  complianceNotes: string[];
  nextAction: string;
};

export type SavedStepZeroRun = {
  id: string;
  caseId: string;
  company: string;
  stage: 'Step 0';
  status: '대표 검토 대기';
  instructionVersion: string;
  model: string;
  providerRequestId: string | null;
  result: StepZeroResult;
  usage: { inputTokens: number; outputTokens: number };
  createdAt: string;
};

type AiDiagnosisRunRow = {
  id: string;
  case_id: string;
  company: string;
  stage: string;
  status: string;
  instruction_version: string;
  model: string;
  result_json: string;
  input_tokens: number;
  output_tokens: number;
  created_by_user_id: string;
  created_at: string;
};

export async function ensureAiDiagnosisTables(db: D1Database) {
  await db.batch([
    db.prepare(aiDiagnosisRunsTableSql),
    db.prepare(aiDiagnosisRunsCaseIndexSql),
    db.prepare(aiDiagnosisRunsPendingCaseIndexSql),
    db.prepare(aiDiagnosisRunsInsertEnvelopeTriggerSql),
    db.prepare(aiDiagnosisRunsPendingEnvelopeTriggerSql),
    db.prepare(aiDiagnosisRunsFieldEnvelopeTriggerSql),
    db.prepare(aiDiagnosisRunsCreatedAtInsertTriggerSql),
    db.prepare(aiDiagnosisRunsCreatedAtUpdateTriggerSql),
    db.prepare(aiDiagnosisRunsUsageEnvelopeTriggerSql),
    db.prepare(aiDiagnosisRunsFieldTextTriggerSql),
    db.prepare(aiDiagnosisRunsIdentityTriggerSql),
    db.prepare(aiDiagnosisRunsTransitionTriggerSql),
    db.prepare(aiDiagnosisRunsResultEnvelopeTriggerSql),
    db.prepare(aiDiagnosisRunsResultTextTriggerSql),
    db.prepare(aiDiagnosisRunsNoDeleteTriggerSql),
  ]);
}

function boundedIdentity(value: string, maximum: number) {
  return (
    value.length > 0 &&
    value === value.trim() &&
    isSafeStoredText(value) &&
    Array.from(value).length <= maximum
  );
}

function assertValidStepZeroClaimInput(input: StepZeroClaimInput) {
  if (
    !/^[A-Za-z0-9_-]{16,100}$/.test(input.requestId) ||
    !/^[0-9a-f]{64}$/.test(input.requestFingerprint) ||
    !boundedIdentity(input.caseId, AI_DIAGNOSIS_RUN_FIELD_LIMITS.caseId) ||
    !boundedIdentity(input.company, AI_DIAGNOSIS_RUN_FIELD_LIMITS.company) ||
    !boundedIdentity(
      input.instructionVersion,
      AI_DIAGNOSIS_RUN_FIELD_LIMITS.instructionVersion,
    ) ||
    !boundedIdentity(input.model, AI_DIAGNOSIS_RUN_FIELD_LIMITS.model) ||
    !boundedIdentity(
      input.createdByUserId,
      AI_DIAGNOSIS_RUN_FIELD_LIMITS.actorId,
    ) ||
    !isUtcMillisecondTimestamp(input.createdAt)
  )
    throw new Error('AI 진단 실행 신원 형식이 올바르지 않습니다.');
}

export function serializeStepZeroPendingEnvelope(requestFingerprint: string) {
  if (!/^[0-9a-f]{64}$/.test(requestFingerprint))
    throw new Error('AI 진단 요청 지문 형식이 올바르지 않습니다.');
  const envelope = JSON.stringify({ _requestFingerprint: requestFingerprint });
  if (new TextEncoder().encode(envelope).length > STEP_ZERO_PENDING_LIMIT_BYTES)
    throw new Error('AI 진단 요청 잠금 허용 용량을 초과했습니다.');
  return envelope;
}

function boundedText(value: unknown, maxLength: number, allowEmpty = false) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (
    (!normalized && !allowEmpty) ||
    !isSafeStoredText(normalized) ||
    Array.from(normalized).length > maxLength
  )
    return null;
  return normalized;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value) || value.length > 20) return null;
  const normalized = value.map((item) => boundedText(item, 4_000));
  return normalized.some((item) => item === null)
    ? null
    : (normalized as string[]);
}

export function parseStepZeroResult(rawText: string): StepZeroResult {
  const normalized = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const parsed = JSON.parse(normalized) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Step 0 응답 형식이 올바르지 않습니다.');
  const value = parsed as Record<string, unknown>;
  const companyOverview = boundedText(value.companyOverview, 12_000);
  const nextAction = boundedText(value.nextAction, 12_000);
  const confirmedStrengths = stringArray(value.confirmedStrengths);
  const mainRisks = stringArray(value.mainRisks);
  const verificationQuestions = stringArray(value.verificationQuestions);
  const missingDocuments = stringArray(value.missingDocuments);
  const complianceNotes = stringArray(value.complianceNotes);
  const rawCandidates = value.solutionCandidates;
  const solutionCandidates =
    Array.isArray(rawCandidates) && rawCandidates.length <= 10
      ? rawCandidates.map((item) => {
          if (
            !item ||
            typeof item !== 'object' ||
            Array.isArray(item) ||
            Object.keys(item).length !== 3 ||
            !['solution', 'basis', 'condition'].every((key) => key in item)
          )
            return null;
          const candidate = item as Record<string, unknown>;
          const solution = boundedText(candidate.solution, 4_000);
          const basis = boundedText(candidate.basis, 4_000);
          const condition = boundedText(candidate.condition, 4_000, true);
          return solution && basis && condition !== null
            ? { solution, basis, condition }
            : null;
        })
      : null;

  if (
    !companyOverview ||
    !nextAction ||
    !confirmedStrengths ||
    !mainRisks ||
    !solutionCandidates ||
    solutionCandidates.some((item) => item === null) ||
    !verificationQuestions ||
    !missingDocuments ||
    !complianceNotes
  )
    throw new Error('Step 0 응답 형식이 올바르지 않습니다.');

  const result: StepZeroResult = {
    companyOverview,
    confirmedStrengths,
    mainRisks,
    solutionCandidates:
      solutionCandidates as StepZeroResult['solutionCandidates'],
    verificationQuestions,
    missingDocuments,
    complianceNotes,
    nextAction,
  };
  const storedEnvelope = JSON.stringify({
    ...result,
    _requestFingerprint: '0'.repeat(64),
  });
  if (
    new TextEncoder().encode(storedEnvelope).length >
    STEP_ZERO_RESULT_LIMIT_BYTES
  )
    throw new Error('Step 0 응답 허용 용량을 초과했습니다.');
  return result;
}

type StepZeroClaimInput = {
  requestId: string;
  requestFingerprint: string;
  caseId: string;
  company: string;
  instructionVersion: string;
  model: string;
  createdByUserId: string;
  createdAt: string;
};

export type StepZeroClaim =
  | { state: 'claimed' }
  | { state: 'pending' | 'conflict' | 'failed' }
  | { state: 'completed'; run: SavedStepZeroRun };

function safeTokenCount(value: unknown, maximum = Number.MAX_SAFE_INTEGER) {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= 1 &&
    Number(value) <= maximum
  );
}

function runFromRow(row: AiDiagnosisRunRow): SavedStepZeroRun | null {
  try {
    const providerRequestId = storedProviderRequestId(row);
    assertValidStepZeroClaimInput({
      requestId: row.id,
      requestFingerprint: storedFingerprint(row),
      caseId: row.case_id,
      company: row.company,
      instructionVersion: row.instruction_version,
      model: row.model,
      createdByUserId: row.created_by_user_id,
      createdAt: row.created_at,
    });
    if (
      row.stage !== 'Step 0' ||
      row.status !== '대표 검토 대기' ||
      (providerRequestId !== null &&
        !boundedIdentity(providerRequestId, AI_PROVIDER_REQUEST_ID_LIMIT)) ||
      !safeTokenCount(row.input_tokens) ||
      !safeTokenCount(row.output_tokens, STEP_ZERO_MAX_OUTPUT_TOKENS)
    )
      return null;
    return {
      id: row.id,
      caseId: row.case_id,
      company: row.company,
      stage: 'Step 0',
      status: '대표 검토 대기',
      instructionVersion: row.instruction_version,
      model: row.model,
      providerRequestId,
      result: parseStepZeroResult(row.result_json),
      usage: { inputTokens: row.input_tokens, outputTokens: row.output_tokens },
      createdAt: row.created_at,
    };
  } catch {
    return null;
  }
}

async function diagnosisRun(id: string) {
  const db = companyFileDatabase();
  await ensureAiDiagnosisTables(db);
  return db
    .prepare(`
    SELECT id, case_id, company, stage, status, instruction_version, model,
      result_json, input_tokens, output_tokens, created_by_user_id, created_at
    FROM ai_diagnosis_runs WHERE id = ?1
  `)
    .bind(id)
    .first<AiDiagnosisRunRow>();
}

function storedFingerprint(row: AiDiagnosisRunRow) {
  try {
    const value = JSON.parse(row.result_json) as Record<string, unknown>;
    return typeof value._requestFingerprint === 'string'
      ? value._requestFingerprint
      : '';
  } catch {
    return '';
  }
}

function storedProviderRequestId(row: AiDiagnosisRunRow) {
  try {
    const value = JSON.parse(row.result_json) as Record<string, unknown>;
    if (value._providerRequestId === undefined) return null;
    return typeof value._providerRequestId === 'string'
      ? value._providerRequestId
      : '';
  } catch {
    return '';
  }
}

export async function claimStepZeroRequest(
  input: StepZeroClaimInput,
): Promise<StepZeroClaim> {
  assertValidStepZeroClaimInput(input);
  const db = companyFileDatabase();
  await ensureAiDiagnosisTables(db);
  const staleBefore = new Date(
    Date.parse(input.createdAt) - STEP_ZERO_PENDING_STALE_MS,
  ).toISOString();
  await db
    .prepare(`
      UPDATE ai_diagnosis_runs SET status = '생성실패'
      WHERE case_id = ?1 AND stage = 'Step 0' AND status = '생성중'
        AND created_at <= ?2
    `)
    .bind(input.caseId, staleBefore)
    .run();
  const result = await db
    .prepare(`
    INSERT INTO ai_diagnosis_runs (
      id, case_id, company, stage, status, instruction_version, model,
      result_json, input_tokens, output_tokens, created_by_user_id, created_at
    ) SELECT ?1, ?2, ?3, 'Step 0', '생성중', ?4, ?5, ?6, 0, 0, ?7, ?8
    WHERE NOT EXISTS (
      SELECT 1 FROM ai_diagnosis_runs
      WHERE case_id = ?2 AND stage = 'Step 0' AND status = '생성중'
    )
    ON CONFLICT(id) DO NOTHING
  `)
    .bind(
      input.requestId,
      input.caseId,
      input.company,
      input.instructionVersion,
      input.model,
      serializeStepZeroPendingEnvelope(input.requestFingerprint),
      input.createdByUserId,
      input.createdAt,
    )
    .run();
  if (result.meta.changes === 1) return { state: 'claimed' };

  const existing = await diagnosisRun(input.requestId);
  if (!existing) return { state: 'pending' };
  if (
    existing.case_id !== input.caseId ||
    existing.company !== input.company ||
    existing.stage !== 'Step 0' ||
    existing.instruction_version !== input.instructionVersion ||
    existing.model !== input.model ||
    existing.created_by_user_id !== input.createdByUserId ||
    storedFingerprint(existing) !== input.requestFingerprint
  )
    return { state: 'conflict' };
  if (existing.status === '대표 검토 대기') {
    const run = runFromRow(existing);
    return run ? { state: 'completed', run } : { state: 'conflict' };
  }
  if (existing.status === '생성실패') return { state: 'failed' };
  return existing.status === '생성중'
    ? { state: 'pending' }
    : { state: 'conflict' };
}

export async function completeStepZeroRequest(
  run: SavedStepZeroRun,
  createdByUserId: string,
  requestFingerprint: string,
) {
  try {
    assertValidStepZeroClaimInput({
      requestId: run.id,
      requestFingerprint,
      caseId: run.caseId,
      company: run.company,
      instructionVersion: run.instructionVersion,
      model: run.model,
      createdByUserId,
      createdAt: run.createdAt,
    });
    if (
      run.stage !== 'Step 0' ||
      run.status !== '대표 검토 대기' ||
      typeof run.providerRequestId !== 'string' ||
      !boundedIdentity(run.providerRequestId, AI_PROVIDER_REQUEST_ID_LIMIT) ||
      !safeTokenCount(run.usage.inputTokens) ||
      !safeTokenCount(run.usage.outputTokens, STEP_ZERO_MAX_OUTPUT_TOKENS)
    )
      throw new Error('invalid completion metadata');
  } catch {
    throw new Error('AI 진단 완료 메타데이터 형식이 올바르지 않습니다.');
  }
  const resultEnvelope = JSON.stringify({
    ...parseStepZeroResult(JSON.stringify(run.result)),
    _requestFingerprint: requestFingerprint,
    _providerRequestId: run.providerRequestId,
  });
  if (
    new TextEncoder().encode(resultEnvelope).length >
    STEP_ZERO_RESULT_LIMIT_BYTES
  )
    throw new Error('AI 진단 완료 결과 허용 용량을 초과했습니다.');
  const db = companyFileDatabase();
  await ensureAiDiagnosisTables(db);
  const result = await db
    .prepare(`
    UPDATE ai_diagnosis_runs SET status = ?1, instruction_version = ?2,
      model = ?3, result_json = ?4, input_tokens = ?5, output_tokens = ?6,
      created_at = ?7
    WHERE id = ?8 AND case_id = ?9 AND company = ?10
      AND created_by_user_id = ?11 AND status = '생성중'
      AND json_extract(result_json, '$._requestFingerprint') = ?12
  `)
    .bind(
      run.status,
      run.instructionVersion,
      run.model,
      resultEnvelope,
      run.usage.inputTokens,
      run.usage.outputTokens,
      run.createdAt,
      run.id,
      run.caseId,
      run.company,
      createdByUserId,
      requestFingerprint,
    )
    .run();
  return result.meta.changes === 1;
}

export async function failStepZeroRequest(
  requestId: string,
  createdByUserId: string,
  requestFingerprint: string,
) {
  const db = companyFileDatabase();
  await ensureAiDiagnosisTables(db);
  await db
    .prepare(`
    UPDATE ai_diagnosis_runs SET status = '생성실패'
    WHERE id = ?1 AND created_by_user_id = ?2 AND status = '생성중'
      AND json_extract(result_json, '$._requestFingerprint') = ?3
  `)
    .bind(requestId, createdByUserId, requestFingerprint)
    .run();
}

export async function readLatestStepZeroRun(
  caseId: string,
): Promise<SavedStepZeroRun | null> {
  const db = companyFileDatabase();
  await ensureAiDiagnosisTables(db);
  const row = await db
    .prepare(`
    SELECT id, case_id, company, stage, status, instruction_version, model,
      result_json, input_tokens, output_tokens, created_by_user_id, created_at
    FROM ai_diagnosis_runs
    WHERE case_id = ?1 AND stage = 'Step 0' AND status = '대표 검토 대기'
    ORDER BY created_at DESC
    LIMIT 1
  `)
    .bind(caseId)
    .first<AiDiagnosisRunRow>();
  if (!row) return null;
  return runFromRow(row);
}
