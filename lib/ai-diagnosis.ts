import {
  aiDiagnosisRunsCaseIndexSql,
  aiDiagnosisRunsIdentityTriggerSql,
  aiDiagnosisRunsInsertEnvelopeTriggerSql,
  aiDiagnosisRunsNoDeleteTriggerSql,
  aiDiagnosisRunsPendingCaseIndexSql,
  aiDiagnosisRunsTableSql,
  aiDiagnosisRunsTransitionTriggerSql,
} from '@/db/schema';
import { companyFileDatabase } from '@/lib/company-files';

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
    db.prepare(aiDiagnosisRunsIdentityTriggerSql),
    db.prepare(aiDiagnosisRunsTransitionTriggerSql),
    db.prepare(aiDiagnosisRunsNoDeleteTriggerSql),
  ]);
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 20)
    : [];
}

export function parseStepZeroResult(rawText: string): StepZeroResult {
  const normalized = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const value = JSON.parse(normalized) as Record<string, unknown>;
  const companyOverview =
    typeof value.companyOverview === 'string'
      ? value.companyOverview.trim()
      : '';
  const nextAction =
    typeof value.nextAction === 'string' ? value.nextAction.trim() : '';
  const rawCandidates = Array.isArray(value.solutionCandidates)
    ? value.solutionCandidates
    : [];
  const solutionCandidates = rawCandidates
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item),
    )
    .map((item) => ({
      solution: typeof item.solution === 'string' ? item.solution.trim() : '',
      basis: typeof item.basis === 'string' ? item.basis.trim() : '',
      condition:
        typeof item.condition === 'string' ? item.condition.trim() : '',
    }))
    .filter((item) => item.solution && item.basis)
    .slice(0, 10);

  if (!companyOverview || !nextAction)
    throw new Error('Step 0 응답 형식이 올바르지 않습니다.');
  return {
    companyOverview,
    confirmedStrengths: stringArray(value.confirmedStrengths),
    mainRisks: stringArray(value.mainRisks),
    solutionCandidates,
    verificationQuestions: stringArray(value.verificationQuestions),
    missingDocuments: stringArray(value.missingDocuments),
    complianceNotes: stringArray(value.complianceNotes),
    nextAction,
  };
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
      JSON.stringify({ _requestFingerprint: input.requestFingerprint }),
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
