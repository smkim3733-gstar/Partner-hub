import type { StoredCompanyFile } from './company-file-upload';

type ExistingCompanyDocument = {
  id: string;
  storageFileId?: string;
};

export type StoredCompanyDocument = {
  id: string;
  company: string;
  title: string;
  category: StoredCompanyFile['category'];
  fileName: string;
  storageFileId: string;
  fileSize: number;
  status: '제출완료';
  assignedTrainee: string;
  partnerMemberId: string;
  submittedBy: string;
  updatedAt: string;
  version: 'V1';
  sensitive: boolean;
};

const sensitiveCategories = new Set<StoredCompanyFile['category']>([
  '사업자등록증',
  '크레탑',
  '재무제표',
  '상담녹취',
  '계약자료',
]);

export function storedCompanyDocument(
  stored: StoredCompanyFile,
  company: string,
  submittedBy: string,
): StoredCompanyDocument {
  return {
    id: `file-${stored.id}`,
    company,
    title: stored.title,
    category: stored.category,
    fileName: stored.fileName,
    storageFileId: stored.id,
    fileSize: stored.sizeBytes,
    status: '제출완료',
    assignedTrainee: stored.assignedTrainee,
    partnerMemberId: stored.partnerMemberId,
    submittedBy,
    updatedAt: '방금 전',
    version: 'V1',
    sensitive: sensitiveCategories.has(stored.category),
  };
}

export function prependStoredCompanyDocument<
  TDocument extends ExistingCompanyDocument,
>(
  documents: TDocument[],
  document: StoredCompanyDocument,
) {
  const idMatches = documents.filter((item) => item.id === document.id);
  const storageMatches = documents.filter(
    (item) => item.storageFileId === document.storageFileId,
  );
  if (
    idMatches.length === 1 &&
    storageMatches.length === 1 &&
    idMatches[0] === storageMatches[0]
  )
    return { ok: true as const, added: false, documents };
  if (idMatches.length || storageMatches.length)
    return {
      ok: false as const,
      error: '저장된 원본의 자료 연결이 충돌합니다. 최신 자료함을 확인해 주세요.',
    };
  return {
    ok: true as const,
    added: true,
    documents: [document, ...documents],
  };
}
