import {
  companyFileCategories,
  MAX_COMPANY_FILE_BYTES,
} from './company-file-policy';
import {
  intakeSourceKind,
  intakeSourceProblem,
  type IntakeSourceOption,
  type IntakeSourcePreview,
} from './intake-source-policy';
import { MAX_TRANSCRIPT_CHARS } from './transcript-policy';

type JsonObject = Record<string, unknown>;

export type IntakeSourceList = {
  files: IntakeSourceOption[];
  hasMore: boolean;
};

export class IntakeSourceResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'IntakeSourceResponseError';
  }
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function boundedText(value: unknown, maxLength: number, allowEmpty = false) {
  return (
    typeof value === 'string' &&
    value.length <= maxLength &&
    (allowEmpty || value.trim().length > 0)
  );
}

function validDate(value: unknown) {
  return (
    boundedText(value, 100) && Number.isFinite(Date.parse(value as string))
  );
}

function parseOption(value: unknown): IntakeSourceOption | null {
  const file = asObject(value);
  if (
    !file ||
    !boundedText(file.id, 120) ||
    !/^[A-Za-z0-9_-]{1,120}$/.test(file.id as string) ||
    !boundedText(file.name, 180) ||
    !companyFileCategories.includes(
      file.category as (typeof companyFileCategories)[number],
    ) ||
    !Number.isSafeInteger(file.size) ||
    Number(file.size) <= 0 ||
    Number(file.size) > MAX_COMPANY_FILE_BYTES ||
    !validDate(file.createdAt) ||
    file.kind !== intakeSourceKind(file.name as string) ||
    file.blockedReason !==
      intakeSourceProblem({
        name: file.name as string,
        size: file.size as number,
      })
  )
    return null;

  return {
    id: file.id as string,
    name: file.name as string,
    category: file.category as string,
    size: file.size as number,
    createdAt: file.createdAt as string,
    kind: file.kind as IntakeSourceOption['kind'],
    blockedReason: file.blockedReason as string,
  };
}

function sameOption(left: IntakeSourceOption, right: IntakeSourceOption) {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.category === right.category &&
    left.size === right.size &&
    left.createdAt === right.createdAt &&
    left.kind === right.kind &&
    left.blockedReason === right.blockedReason
  );
}

async function readJson(response: Response, subject: string) {
  try {
    return await response.json();
  } catch {
    throw new IntakeSourceResponseError(
      `${subject} 응답을 읽지 못했습니다. 자료 목록을 새로고침해 주세요.`,
      response.status,
    );
  }
}

function errorMessage(value: unknown, fallback: string) {
  const payload = asObject(value);
  return boundedText(payload?.error, 1_000)
    ? (payload?.error as string)
    : fallback;
}

function invalid(status: number, subject: string) {
  return new IntakeSourceResponseError(
    `${subject} 응답 형식이 올바르지 않습니다. 자료 목록을 새로고침해 주세요.`,
    status,
  );
}

export async function readIntakeSourceListResponse(
  response: Response,
): Promise<IntakeSourceList> {
  const raw = await readJson(response, '신청자료 목록');
  if (!response.ok)
    throw new IntakeSourceResponseError(
      errorMessage(raw, '신청자료 목록을 불러오지 못했습니다.'),
      response.status,
    );

  const payload = asObject(raw);
  if (
    !payload ||
    !Array.isArray(payload.files) ||
    payload.files.length > 100 ||
    typeof payload.hasMore !== 'boolean'
  )
    throw invalid(response.status, '신청자료 목록');

  const files = payload.files.map(parseOption);
  if (
    files.some((file) => file === null) ||
    new Set(files.map((file) => file?.id)).size !== files.length
  )
    throw invalid(response.status, '신청자료 목록');

  return { files: files as IntakeSourceOption[], hasMore: payload.hasMore };
}

export async function readIntakeSourcePreviewResponse(
  response: Response,
  expectedFile: IntakeSourceOption,
): Promise<IntakeSourcePreview> {
  const raw = await readJson(response, '신청자료 미리보기');
  if (!response.ok)
    throw new IntakeSourceResponseError(
      errorMessage(raw, '자료를 읽지 못했습니다.'),
      response.status,
    );

  const payload = asObject(raw);
  const file = parseOption(payload?.file);
  if (
    !payload ||
    !file ||
    !sameOption(file, expectedFile) ||
    file.blockedReason !== '' ||
    !/^[a-f0-9]{64}$/.test(
      typeof payload.sourceHash === 'string' ? payload.sourceHash : '',
    ) ||
    (file.kind === 'text'
      ? !boundedText(payload.text, MAX_TRANSCRIPT_CHARS, true)
      : payload.text !== undefined)
  )
    throw invalid(response.status, '신청자료 미리보기');

  return {
    file,
    sourceHash: payload.sourceHash as string,
    ...(file.kind === 'text' ? { text: payload.text as string } : {}),
  };
}
