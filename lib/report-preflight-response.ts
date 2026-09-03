import {
  MAX_AI_SOURCE_BYTES,
  MAX_AI_SOURCE_FILES,
} from './intake-source-policy';
import {
  reportPreflightCheckDefinitions,
  reportPreflightNotices,
  type ReportPreflight,
} from './report-preflight';

type JsonObject = Record<string, unknown>;
type CheckId = keyof typeof reportPreflightCheckDefinitions;

export class ReportPreflightResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ReportPreflightResponseError';
  }
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function boundedText(value: unknown, maxLength: number) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

function safeCount(value: unknown, max: number) {
  return (
    Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max
  );
}

function parseFile(value: unknown): ReportPreflight['files'][number] | null {
  const file = asObject(value);
  if (
    !file ||
    !boundedText(file.id, 120) ||
    !/^[A-Za-z0-9_-]{1,120}$/.test(file.id as string) ||
    !boundedText(file.name, 180) ||
    !safeCount(file.size, 25 * 1024 * 1024) ||
    Number(file.size) === 0 ||
    !boundedText(file.type, 200) ||
    typeof file.imported !== 'boolean'
  )
    return null;
  return {
    id: file.id as string,
    name: file.name as string,
    size: file.size as number,
    type: file.type as string,
    imported: file.imported,
  };
}

function parseCheck(value: unknown): ReportPreflight['checks'][number] | null {
  const check = asObject(value);
  if (
    !check ||
    typeof check.id !== 'string' ||
    !Object.hasOwn(reportPreflightCheckDefinitions, check.id)
  )
    return null;
  const id = check.id as CheckId;
  const definition = reportPreflightCheckDefinitions[id];
  if (
    check.label !== definition.label ||
    check.target !== definition.target ||
    typeof check.passed !== 'boolean' ||
    !boundedText(check.detail, 2_000)
  )
    return null;
  return {
    id,
    label: definition.label,
    passed: check.passed,
    detail: check.detail as string,
    target: definition.target,
  };
}

function invalid(status: number) {
  return new ReportPreflightResponseError(
    '자료 점검 응답 형식이 올바르지 않습니다. 진행을 새로고침한 후 다시 점검해 주세요.',
    status,
  );
}

export async function readReportPreflightResponse(
  response: Response,
  expectedCaseId: string,
  expectedRevision: number,
): Promise<ReportPreflight> {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new ReportPreflightResponseError(
      '자료 점검 응답을 읽지 못했습니다. 진행을 새로고침한 후 다시 점검해 주세요.',
      response.status,
    );
  }

  const payload = asObject(raw);
  if (!response.ok)
    throw new ReportPreflightResponseError(
      boundedText(payload?.error, 1_000)
        ? (payload?.error as string)
        : '자료를 점검하지 못했습니다.',
      response.status,
    );

  if (
    response.status !== 200 ||
    !payload ||
    payload.caseId !== expectedCaseId ||
    payload.revision !== expectedRevision ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0 ||
    !boundedText(payload.checkedAt, 100) ||
    !Number.isFinite(Date.parse(payload.checkedAt as string)) ||
    typeof payload.canGenerate !== 'boolean' ||
    !safeCount(payload.sourceTextChars, 1_000_000) ||
    !safeCount(payload.fileCount, 100) ||
    !safeCount(payload.totalBytes, 100 * 25 * 1024 * 1024) ||
    !safeCount(payload.excludedCount, 1_000) ||
    !boundedText(payload.model, 200) ||
    typeof payload.hasExistingReport !== 'boolean' ||
    !Array.isArray(payload.files) ||
    payload.files.length > 100 ||
    !Array.isArray(payload.checks) ||
    payload.checks.length !==
      Object.keys(reportPreflightCheckDefinitions).length ||
    !Array.isArray(payload.notices) ||
    payload.notices.length !== reportPreflightNotices.length ||
    !payload.notices.every(
      (notice, index) => notice === reportPreflightNotices[index],
    )
  )
    throw invalid(response.status);

  const files = payload.files.map(parseFile);
  const checks = payload.checks.map(parseCheck);
  const checkIds = checks.map((check) => check?.id);
  const totalBytes = files.reduce((sum, file) => sum + (file?.size ?? 0), 0);
  const composition =
    (Number(payload.sourceTextChars) >= 20 || files.length > 0) &&
    files.length <= MAX_AI_SOURCE_FILES &&
    totalBytes <= MAX_AI_SOURCE_BYTES;
  if (
    files.some((file) => file === null) ||
    new Set(files.map((file) => file?.id)).size !== files.length ||
    checks.some((check) => check === null) ||
    new Set(checkIds).size !== checkIds.length ||
    !Object.keys(reportPreflightCheckDefinitions).every((id) =>
      checkIds.includes(id as CheckId),
    ) ||
    payload.fileCount !== files.length ||
    payload.totalBytes !== totalBytes ||
    payload.canGenerate !== checks.every((check) => check?.passed) ||
    (payload.canGenerate && !composition) ||
    checks.find((check) => check?.id === 'composition')?.passed !== composition
  )
    throw invalid(response.status);

  return {
    caseId: payload.caseId as string,
    revision: payload.revision as number,
    checkedAt: payload.checkedAt as string,
    canGenerate: payload.canGenerate,
    sourceTextChars: payload.sourceTextChars as number,
    fileCount: payload.fileCount as number,
    totalBytes: payload.totalBytes as number,
    excludedCount: payload.excludedCount as number,
    model: payload.model as string,
    hasExistingReport: payload.hasExistingReport,
    files: files as ReportPreflight['files'],
    checks: checks as ReportPreflight['checks'],
    notices: [...reportPreflightNotices],
  };
}
