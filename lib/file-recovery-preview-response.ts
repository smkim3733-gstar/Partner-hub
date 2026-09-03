import {
  companyFileCategories,
  MAX_COMPANY_FILE_BYTES,
} from './company-file-policy';
import type { RecoveryPreview } from './file-recovery';
import { isValidLoginEmail } from './member-email';

type JsonObject = Record<string, unknown>;

export class FileRecoveryPreviewResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'FileRecoveryPreviewResponseError';
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

const idPattern = /^[A-Za-z0-9_-]{1,120}$/;
const revisionPattern = /^[a-f0-9]{64}$/;

export async function readFileRecoveryPreviewResponse(
  response: Response,
  expectedFileId: string,
): Promise<RecoveryPreview> {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new FileRecoveryPreviewResponseError(
      '회수 조건 응답을 읽지 못했습니다. 보관 목록을 새로고침한 후 다시 확인해 주세요.',
      response.status,
    );
  }

  const payload = asObject(raw);
  if (!response.ok)
    throw new FileRecoveryPreviewResponseError(
      boundedText(payload?.error, 1_000)
        ? (payload?.error as string)
        : '회수 조건을 확인하지 못했습니다.',
      response.status,
    );

  if (
    !payload ||
    payload.fileId !== expectedFileId ||
    !idPattern.test(expectedFileId) ||
    !boundedText(payload.fileName, 180) ||
    !boundedText(payload.company, 200) ||
    !companyFileCategories.includes(
      payload.category as (typeof companyFileCategories)[number],
    ) ||
    !boundedText(payload.title, 500) ||
    !idPattern.test(typeof payload.caseId === 'string' ? payload.caseId : '') ||
    !boundedText(payload.service, 200, true) ||
    !idPattern.test(
      typeof payload.partnerMemberId === 'string'
        ? payload.partnerMemberId
        : '',
    ) ||
    !boundedText(payload.partnerName, 200) ||
    !boundedText(payload.partnerEmail, 254) ||
    !isValidLoginEmail(payload.partnerEmail as string) ||
    !Number.isSafeInteger(payload.sizeBytes) ||
    Number(payload.sizeBytes) <= 0 ||
    Number(payload.sizeBytes) > MAX_COMPANY_FILE_BYTES ||
    !revisionPattern.test(
      typeof payload.stateRevision === 'string' ? payload.stateRevision : '',
    ) ||
    !revisionPattern.test(
      typeof payload.fileRevision === 'string' ? payload.fileRevision : '',
    )
  )
    throw new FileRecoveryPreviewResponseError(
      '회수 조건 응답 형식이 올바르지 않습니다. 보관 목록을 새로고침한 후 다시 확인해 주세요.',
      response.status,
    );

  return {
    fileId: payload.fileId as string,
    fileName: payload.fileName as string,
    company: payload.company as string,
    category: payload.category as string,
    title: payload.title as string,
    caseId: payload.caseId as string,
    service: payload.service as string,
    partnerMemberId: payload.partnerMemberId as string,
    partnerName: payload.partnerName as string,
    partnerEmail: payload.partnerEmail as string,
    sizeBytes: payload.sizeBytes as number,
    stateRevision: payload.stateRevision as string,
    fileRevision: payload.fileRevision as string,
  };
}
