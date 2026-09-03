import { companyUploadKey, type CompanyUploadInput } from './file-upload-key';
import {
  companyFileCategories,
  MAX_COMPANY_FILE_BYTES,
  safeFileName,
  type CompanyFileCategory,
} from './company-file-policy';
import { COMPANY_FILE_TITLE_MAX_LENGTH } from './company-file-metadata';

export type StoredCompanyFile = {
  id: string;
  fileName: string;
  sizeBytes: number;
  contentType: string;
  createdAt: string;
  assignedTrainee: string;
  partnerMemberId: string;
  caseId?: string;
  category: CompanyFileCategory;
  title: string;
};

function asObject(value: unknown) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function storedFileFrom(
  value: unknown,
  input: CompanyUploadInput,
): StoredCompanyFile | null {
  const file = asObject(value);
  const caseId = file?.caseId;
  if (
    !file ||
    typeof file.id !== 'string' ||
    !/^[a-zA-Z0-9-]{10,80}$/.test(file.id) ||
    file.fileName !== safeFileName(input.file.name) ||
    !Number.isSafeInteger(file.sizeBytes) ||
    file.sizeBytes !== input.file.size ||
    file.sizeBytes <= 0 ||
    file.sizeBytes > MAX_COMPANY_FILE_BYTES ||
    file.contentType !== (input.file.type || 'application/octet-stream') ||
    typeof file.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(file.createdAt)) ||
    typeof file.assignedTrainee !== 'string' ||
    !file.assignedTrainee.trim() ||
    file.assignedTrainee.length > 80 ||
    typeof file.partnerMemberId !== 'string' ||
    file.partnerMemberId.length > 120 ||
    (input.partnerMemberId !== undefined &&
      file.partnerMemberId !== input.partnerMemberId) ||
    (caseId !== undefined &&
      (typeof caseId !== 'string' || !caseId.trim() || caseId.length > 200)) ||
    caseId !== input.caseId ||
    !companyFileCategories.includes(file.category as CompanyFileCategory) ||
    file.category !== input.category ||
    file.title !== input.title.trim() ||
    file.title.length > COMPANY_FILE_TITLE_MAX_LENGTH
  )
    return null;
  return {
    id: file.id,
    fileName: file.fileName,
    sizeBytes: file.sizeBytes,
    contentType: file.contentType,
    createdAt: file.createdAt,
    assignedTrainee: file.assignedTrainee,
    partnerMemberId: file.partnerMemberId,
    ...(caseId === undefined ? {} : { caseId }),
    category: file.category as CompanyFileCategory,
    title: file.title,
  };
}

export async function uploadCompanyFile(
  input: CompanyUploadInput,
): Promise<StoredCompanyFile> {
  const form = new FormData();
  form.set('file', input.file);
  for (const key of [
    'company',
    'title',
    'category',
    'assignedTrainee',
    'partnerMemberId',
    'caseId',
    'expectedUserId',
  ] as const) {
    if (input[key] !== undefined) form.set(key, input[key]);
  }
  form.set('consent', 'confirmed');
  if (input.recordingConsent) form.set('recordingConsent', 'confirmed');
  try {
    const response = await fetch('/api/files', {
      method: 'POST',
      body: form,
      headers: { 'idempotency-key': await companyUploadKey(input) },
    });
    let rawPayload: unknown;
    try {
      rawPayload = await response.json();
    } catch {
      throw new Error('기업자료 업로드 응답을 읽지 못했습니다.');
    }
    const payload = asObject(rawPayload);
    if (!response.ok)
      throw new Error(
        (typeof payload?.error === 'string' && payload.error.trim()
          ? payload.error
          : '기업자료 업로드를 확인하지 못했습니다.'),
      );
    const stored = storedFileFrom(payload?.file, input);
    if (!stored)
      throw new Error('기업자료 업로드 완료 응답 형식이 올바르지 않습니다.');
    return stored;
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : '기업자료 업로드를 확인하지 못했습니다.'} 같은 파일과 자료정보를 유지하고 다시 시도해 주세요. 앞서 업로드한 파일은 자동 삭제하지 않습니다.`,
    );
  }
}
