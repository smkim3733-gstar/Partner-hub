export const COMPANY_DOCUMENT_STATUSES = [
  '요청중',
  '제출완료',
  '보완필요',
  '검토완료',
] as const;
export type CompanyDocumentStatus = (typeof COMPANY_DOCUMENT_STATUSES)[number];

export const COMPANY_DOCUMENT_STATUS_IMPACTS: Record<
  CompanyDocumentStatus,
  string
> = {
  요청중: '제출 완료 표시가 해제되고 기업대표 회신 대기 자료로 집계됩니다.',
  제출완료:
    '보안 저장된 실제 파일이 도착했음을 표시합니다. 내용 검토 완료를 뜻하지 않습니다.',
  보완필요: '보완 필요 자료로 집계됩니다. 실제 보완 요청 발송은 자동 실행하지 않습니다.',
  검토완료:
    '검토 완료 자료로 집계되고 진단·후속 업무의 사용 가능 자료 판단에 반영될 수 있습니다.',
};

type StatusDocument = {
  id: string;
  status: CompanyDocumentStatus;
  storageFileId?: string;
  updatedAt: string;
};

export type CompanyDocumentStatusDraft = {
  documentId: string;
  expectedStatus: CompanyDocumentStatus;
  nextStatus: CompanyDocumentStatus;
  expectedStorageFileId: string | null;
};

function isCompanyDocumentStatus(value: unknown): value is CompanyDocumentStatus {
  return COMPANY_DOCUMENT_STATUSES.includes(value as CompanyDocumentStatus);
}

export function companyDocumentStatusError(
  document: { storageFileId?: string },
  status: string,
) {
  if (!isCompanyDocumentStatus(status))
    return '자료 상태를 다시 선택해 주세요.';
  if ((status === '제출완료' || status === '검토완료') && !document.storageFileId) {
    return '실제 파일이 보안 저장소에 등록된 뒤 완료 상태로 변경할 수 있습니다.';
  }
  return null;
}

export function createCompanyDocumentStatusDraft(
  document: StatusDocument,
  nextStatus: string,
): CompanyDocumentStatusDraft {
  if (!isCompanyDocumentStatus(document.status))
    throw new Error('현재 자료 상태를 다시 확인해 주세요.');
  if (!isCompanyDocumentStatus(nextStatus))
    throw new Error('자료 상태를 다시 선택해 주세요.');
  if (document.status === nextStatus)
    throw new Error('이미 현재 자료 상태입니다.');
  const error = companyDocumentStatusError(document, nextStatus);
  if (error) throw new Error(error);
  return {
    documentId: document.id,
    expectedStatus: document.status,
    nextStatus,
    expectedStorageFileId: document.storageFileId ?? null,
  };
}

export function applyCompanyDocumentStatusDraft<T extends StatusDocument>(
  document: T,
  draft: CompanyDocumentStatusDraft,
): T {
  if (document.id !== draft.documentId)
    throw new Error('상태를 변경할 자료를 다시 확인해 주세요.');
  if (
    document.status !== draft.expectedStatus ||
    (document.storageFileId ?? null) !== draft.expectedStorageFileId
  )
    throw new Error('자료 상태 또는 원본 연결이 변경되었습니다. 최신 화면에서 다시 확인해 주세요.');
  const error = companyDocumentStatusError(document, draft.nextStatus);
  if (error) throw new Error(error);
  return {
    ...document,
    status: draft.nextStatus,
    updatedAt: '방금 전',
  };
}
