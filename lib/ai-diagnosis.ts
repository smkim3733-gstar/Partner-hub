import {
  aiDiagnosisRunsCaseIndexSql,
  aiDiagnosisRunsTableSql,
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
  created_at: string;
};

export async function ensureAiDiagnosisTables(db: D1Database) {
  await db.batch([
    db.prepare(aiDiagnosisRunsTableSql),
    db.prepare(aiDiagnosisRunsCaseIndexSql),
  ]);
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean).slice(0, 20)
    : [];
}

export function parseStepZeroResult(rawText: string): StepZeroResult {
  const normalized = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const value = JSON.parse(normalized) as Record<string, unknown>;
  const companyOverview = typeof value.companyOverview === 'string' ? value.companyOverview.trim() : '';
  const nextAction = typeof value.nextAction === 'string' ? value.nextAction.trim() : '';
  const rawCandidates = Array.isArray(value.solutionCandidates) ? value.solutionCandidates : [];
  const solutionCandidates = rawCandidates
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      solution: typeof item.solution === 'string' ? item.solution.trim() : '',
      basis: typeof item.basis === 'string' ? item.basis.trim() : '',
      condition: typeof item.condition === 'string' ? item.condition.trim() : '',
    }))
    .filter((item) => item.solution && item.basis)
    .slice(0, 10);

  if (!companyOverview || !nextAction) throw new Error('Step 0 응답 형식이 올바르지 않습니다.');
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

export async function saveStepZeroRun(run: SavedStepZeroRun, createdByUserId: string) {
  const db = companyFileDatabase();
  await ensureAiDiagnosisTables(db);
  await db.prepare(`
    INSERT INTO ai_diagnosis_runs (
      id, case_id, company, stage, status, instruction_version, model,
      result_json, input_tokens, output_tokens, created_by_user_id, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
  `).bind(
    run.id,
    run.caseId,
    run.company,
    run.stage,
    run.status,
    run.instructionVersion,
    run.model,
    JSON.stringify(run.result),
    run.usage.inputTokens,
    run.usage.outputTokens,
    createdByUserId,
    run.createdAt,
  ).run();
}

export async function readLatestStepZeroRun(caseId: string): Promise<SavedStepZeroRun | null> {
  const db = companyFileDatabase();
  await ensureAiDiagnosisTables(db);
  const row = await db.prepare(`
    SELECT id, case_id, company, stage, status, instruction_version, model,
      result_json, input_tokens, output_tokens, created_at
    FROM ai_diagnosis_runs
    WHERE case_id = ?1 AND stage = 'Step 0'
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(caseId).first<AiDiagnosisRunRow>();
  if (!row) return null;
  return {
    id: row.id,
    caseId: row.case_id,
    company: row.company,
    stage: 'Step 0',
    status: '대표 검토 대기',
    instructionVersion: row.instruction_version,
    model: row.model,
    result: JSON.parse(row.result_json) as StepZeroResult,
    usage: { inputTokens: row.input_tokens, outputTokens: row.output_tokens },
    createdAt: row.created_at,
  };
}
