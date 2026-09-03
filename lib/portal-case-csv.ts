export type PortalCaseCsvRow = {
  id: string;
  company: string;
  service: string;
  assignee: string;
  partnerType: string;
  stage: string;
  nextAction: string;
  updatedAt: string;
  consultationCount: number;
  idleDays: number;
  urgent: boolean;
  discontinued: boolean;
};

const CSV_HEADERS = [
  '신청번호',
  '기업명',
  '서비스',
  '담당자',
  '파트너 유형',
  '현재 단계',
  '다음 행동',
  '최종 업데이트',
  '상담 횟수',
  '정체 일수',
  '긴급 여부',
  '진행 상태',
] as const;

function spreadsheetSafeCell(value: string | number) {
  const text = String(value).replaceAll('\0', '').normalize('NFC');
  const safeText = /^[\t\r\n ]*[=+\-@]/u.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

export function buildPortalCaseCsv(rows: PortalCaseCsvRow[]) {
  const lines = [
    CSV_HEADERS.map(spreadsheetSafeCell),
    ...rows.map((row) => [
      row.id,
      row.company,
      row.service,
      row.assignee,
      row.partnerType,
      row.stage,
      row.nextAction,
      row.updatedAt,
      row.consultationCount,
      row.idleDays,
      row.urgent ? '긴급' : '보통',
      row.discontinued ? '중단' : '진행',
    ].map(spreadsheetSafeCell)),
  ];

  return `\uFEFF${lines.map((line) => line.join(',')).join('\r\n')}\r\n`;
}

export function portalCaseCsvFileName(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `partner-hub-cases-${part('year')}-${part('month')}-${part('day')}.csv`;
}
