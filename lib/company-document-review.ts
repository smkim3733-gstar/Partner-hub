export function companyDocumentStatusError(
  document: { storageFileId?: string },
  status: string,
) {
  if ((status === '제출완료' || status === '검토완료') && !document.storageFileId) {
    return '실제 파일이 보안 저장소에 등록된 뒤 완료 상태로 변경할 수 있습니다.';
  }
  return null;
}
