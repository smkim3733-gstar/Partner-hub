export const inventoryStates = {
  unlinked: '연결 확인 필요',
  pending: '업로드 확인 대기',
  inconsistent: '메타데이터 확인 필요',
  deleted: '삭제 기록 확인',
  linked: '자료·상담 연결',
} as const;
export type InventoryState = keyof typeof inventoryStates;
export type InventoryFilter = InventoryState | 'all';
export type InventoryItem = {
  id: string;
  fileName: string | null;
  company: string | null;
  title: string | null;
  category: string | null;
  sizeBytes: number | null;
  createdAt: string;
  assignedTrainee: string | null;
  partnerMemberId: string | null;
  uploader: string;
  caseId: string | null;
  documentLinked: boolean;
  flowLinked: boolean;
  status: InventoryState;
};
export type InventoryPage = {
  items: InventoryItem[];
  nextCursor: string | null;
  checkedAt: string;
};
export type InventoryPresence = {
  id: string;
  exists: boolean;
  sizeBytes: number | null;
  expectedSizeBytes: number | null;
  sizeMatches: boolean | null;
  integrityMode: 'metadata' | 'etag' | null;
  integrityMatches: boolean | null;
  checkedAt: string;
};

export const inventoryNotes: Record<InventoryState, string> = {
  unlinked:
    '자료 목록·상담의 직접 연결을 찾지 못했습니다. 작성 중이거나 제출에서 제외한 파일일 수 있으므로 삭제 대상으로 단정하지 마세요.',
  pending:
    '업로드 요청은 있지만 완료 확인 전입니다. 원본 존재를 확인하고 같은 신청·파일로 재시도할 수 있습니다.',
  inconsistent:
    '완료 요청과 파일 메타데이터가 일치하지 않습니다. 원본 존재와 기존 기록을 먼저 확인해 주세요.',
  deleted:
    '삭제 상태에 파일 메타데이터 또는 연결 기록이 남아 있습니다. 원본 존재와 연결 상태를 확인해 주세요.',
  linked:
    '저장된 자료 목록 또는 상담 파일에 직접 참조가 있습니다. 연결됐다는 사실만으로 원본 존재나 정상 내용을 보장하지 않습니다.',
};
