import {
  companyFileProblem,
  MAX_COMPANY_FILE_BYTES,
  safeFileName,
  type CompanyFileCategory,
} from './company-file-policy';

type IntegrityRecord = Record<string, unknown>;

const storedFileIdPattern = /^[A-Za-z0-9-]{10,80}$/;
const immutableOriginalFields = [
  'id',
  'storageFileId',
  'fileName',
  'fileSize',
  'company',
  'title',
  'category',
  'partnerMemberId',
  'caseId',
] as const;

function isRecord(value: unknown): value is IntegrityRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function records(value: unknown): IntegrityRecord[] | null {
  return Array.isArray(value) && value.every(isRecord) ? value : null;
}

function safeStoredFileName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Boolean(value) &&
    value === safeFileName(value)
  );
}

function safeStoredFileSize(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) > 0 &&
    (value as number) <= MAX_COMPANY_FILE_BYTES
  );
}

export function companyDocumentFileMetadataStateError(
  value: unknown,
): string | null {
  const documents = records(value);
  if (!documents) return null;
  const fileIds = new Set<string>();

  for (const document of documents) {
    const hasFileId = Object.hasOwn(document, 'storageFileId');
    const hasFileName = Object.hasOwn(document, 'fileName');
    const hasFileSize = Object.hasOwn(document, 'fileSize');

    if (
      hasFileId &&
      (typeof document.storageFileId !== 'string' ||
        !storedFileIdPattern.test(document.storageFileId))
    )
      return '기업자료 원본 식별값이 올바르지 않습니다.';
    if (
      hasFileId &&
      (!hasFileName ||
        !hasFileSize ||
        document.fileName === undefined ||
        document.fileSize === undefined)
    )
      return '기업자료 원본 메타데이터가 완전하지 않습니다.';
    if (hasFileSize && !hasFileId)
      return '기업자료 원본 식별값 없이 파일 크기를 저장할 수 없습니다.';
    if (hasFileName && !safeStoredFileName(document.fileName))
      return '기업자료 파일명이 올바르지 않습니다.';
    if (hasFileSize && !safeStoredFileSize(document.fileSize))
      return '기업자료 원본 크기가 올바르지 않습니다.';

    if (hasFileId) {
      const fileId = document.storageFileId as string;
      if (fileIds.has(fileId))
        return '기업자료 원본 연결이 중복되었습니다.';
      fileIds.add(fileId);
      if (
        companyFileProblem(
          {
            name: document.fileName as string,
            size: document.fileSize as number,
          },
          document.category as CompanyFileCategory,
        )
      )
        return '기업자료 원본 형식이 자료 종류와 맞지 않습니다.';
    }
  }
  return null;
}

function sameOriginalFacts(
  current: IntegrityRecord,
  next: IntegrityRecord,
) {
  return immutableOriginalFields.every(
    (field) => (current[field] ?? null) === (next[field] ?? null),
  );
}

export function companyDocumentFileMetadataMutationError(
  currentValue: unknown,
  nextValue: unknown,
): string | null {
  const current = records(currentValue);
  const next = records(nextValue);
  if (!current || !next) return null;

  const nextByFileId = new Map(
    next
      .filter((document) => typeof document.storageFileId === 'string')
      .map((document) => [document.storageFileId as string, document]),
  );
  for (const document of current) {
    if (typeof document.storageFileId !== 'string') continue;
    const retained = nextByFileId.get(document.storageFileId);
    if (!retained || !sameOriginalFacts(document, retained))
      return '기존 기업자료 원본 연결과 메타데이터는 일반 저장으로 변경하거나 삭제할 수 없습니다.';
  }
  return null;
}
