import {
  aiDiagnosisRunsCaseIndexSql,
  aiDiagnosisRunsIdentityTriggerSql,
  aiDiagnosisRunsInsertEnvelopeTriggerSql,
  aiDiagnosisRunsNoDeleteTriggerSql,
  aiDiagnosisRunsPendingCaseIndexSql,
  aiDiagnosisRunsPendingEnvelopeTriggerSql,
  aiDiagnosisRunsResultEnvelopeTriggerSql,
  aiDiagnosisRunsTableSql,
  aiDiagnosisRunsTransitionTriggerSql,
} from '@/db/schema';
import { companyFileDatabase } from '@/lib/company-files';
import {
  STEP_ZERO_PENDING_LIMIT_BYTES,
  STEP_ZERO_RESULT_LIMIT_BYTES,
} from '@/lib/storage-limits';

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
    db.prepare(aiDiagnosisRunsIdentityTriggerSql),
    db.prepare(aiDiagnosisRunsTransitionTriggerSql),
    db.prepare(aiDiagnosisRunsResultEnvelopeTriggerSql),
    db.prepare(aiDiagnosisRunsNoDeleteTriggerSql),
  ]);
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
  if ((!normalized && !allowEmpty) || Array.from(normalized).length > maxLength)
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

function runFromRow(row: AiDiagnosisRunRow): SavedStepZeroRun {
  return {
    id: row.id,
    caseId: row.case_id,
    company: row.company,
    stage: 'Step 0',
    status: '대표 검토 대기',
    instructionVersion: row.instruction_version,
    model: row.model,
    result: parseStepZeroResult(row.result_json),
    usage: { inputTokens: row.input_tokens, outputTokens: row.output_tokens },
    createdAt: row.created_at,
  };
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

export async function claimStepZeroRequest(
  input: StepZeroClaimInput,
): Promise<StepZeroClaim> {
  const db = companyFileDatabase();
  await ensureAiDiagnosisTables(db);
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
    existing.created_by_user_id !== input.createdByUserId ||
    storedFingerprint(existing) !== input.requestFingerprint
  )
    return { state: 'conflict' };
  return existing.status === '대표 검토 대기'
    ? { state: 'completed', run: runFromRow(existing) }
    : existing.status === '생성실패'
      ? { state: 'failed' }
      : { state: 'pending' };
}

export async function completeStepZeroRequest(
  run: SavedStepZeroRun,
  createdByUserId: string,
  requestFingerprint: string,
) {
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
      JSON.stringify({
        ...run.result,
        _requestFingerprint: requestFingerprint,
      }),
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
      result_json, input_tokens, output_tokens, created_at
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
