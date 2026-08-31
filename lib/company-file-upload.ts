import { companyUploadKey, type CompanyUploadInput } from './file-upload-key';
import type { CompanyFileCategory } from './company-file-policy';

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
    const payload = (await response.json()) as {
      file?: StoredCompanyFile;
      error?: string;
    };
    if (!response.ok || !payload.file?.id)
      throw new Error(
        payload.error || '기업자료 업로드를 확인하지 못했습니다.',
      );
    return payload.file;
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : '기업자료 업로드를 확인하지 못했습니다.'} 같은 파일과 자료정보를 유지하고 다시 시도해 주세요. 앞서 업로드한 파일은 자동 삭제하지 않습니다.`,
    );
  }
}
