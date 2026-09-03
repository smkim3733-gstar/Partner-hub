export type ReportPreflight = {
  caseId: string;
  revision: number;
  checkedAt: string;
  canGenerate: boolean;
  sourceTextChars: number;
  fileCount: number;
  totalBytes: number;
  excludedCount: number;
  model: string;
  hasExistingReport: boolean;
  files: Array<{
    id: string;
    name: string;
    size: number;
    type: string;
    imported: boolean;
  }>;
  checks: Array<{
    id: string;
    label: string;
    passed: boolean;
    detail: string;
    target: 'sources' | 'policy' | 'workflow';
  }>;
  notices: string[];
};

export const reportPreflightCheckDefinitions = {
  composition: { label: '분석자료 구성', target: 'sources' },
  sources: { label: '저장 파일·텍스트 점검', target: 'sources' },
  policy: { label: '기업별 외부 AI·비용 승인', target: 'policy' },
  key: { label: 'API 키 설정', target: 'policy' },
  phase: { label: '진행 단계', target: 'workflow' },
} as const;

export const reportPreflightNotices = [
  '분석 대상은 위 근거 요약과 선택된 파일뿐입니다. 신청자료함의 미반영 원본·음성·AI 입력 제외 자료는 전송하지 않습니다.',
  '사업자등록증·최신 크레탑/재무자료·통화 내용 등 필요한 근거가 충분한지 직접 확인하세요. 자료명만으로 종류·최신성·사실성을 확정하지 않습니다.',
  'PDF·이미지의 내용·개인정보는 자동 검사하거나 마스킹하지 않습니다. 기업·상담일·금액·불필요한 식별정보를 직접 확인해 주세요.',
  '점검은 AI 미전송입니다. 실제 생성은 Claude API 이용요금이 발생하며, 정확한 비용·잔액과 모델 사용 가능 여부는 이 점검으로 확인되지 않습니다.',
  '결과는 대표와 담당 파트너의 내부 검토 초안입니다. 기업대표에게 자동 발송하지 않습니다.',
] as const;

export function currentPreflight(
  result: ReportPreflight | null,
  caseId: string,
  revision: number,
) {
  return Boolean(
    result?.canGenerate &&
    result.caseId === caseId &&
    result.revision === revision,
  );
}
