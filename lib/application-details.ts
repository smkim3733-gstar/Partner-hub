export const applicationFields = {
  relationship: {
    label: '기업과의 관계',
    step: 1,
    max: 40,
    required: true,
    options: ['직접 상담 중', '소개받은 기업', '기존 고객'],
  },
  collaborator: {
    label: '공동 협업자 메모',
    step: 1,
    max: 200,
    hint: '참고용 메모입니다. 계정 검색·초대·자료 공유 권한은 부여하지 않습니다.',
  },
  message: {
    label: '대표님에게 전달할 내용',
    step: 1,
    max: 2000,
    multiline: true,
  },
  registrationNumber: {
    label: '사업자등록번호',
    step: 2,
    max: 12,
    required: true,
    hint: '숫자 10자리 또는 000-00-00000 형식. 실등록·중복 조회는 수행하지 않습니다.',
  },
  representative: { label: '대표자명', step: 2, max: 80, required: true },
  companyType: {
    label: '법인·개인 구분',
    step: 2,
    max: 20,
    required: true,
    options: ['법인사업자', '개인사업자'],
  },
  business: { label: '업종·주요사업', step: 2, max: 500, required: true },
  location: {
    label: '소재지',
    step: 2,
    max: 200,
    hint: '시·도 및 시·군·구 등 필요한 범위만 입력하세요.',
  },
  contactName: { label: '기업 담당자', step: 2, max: 80 },
  contactPhone: { label: '연락처', step: 2, max: 40, type: 'tel' },
  requestedStart: { label: '희망 진행시기', step: 3, max: 10, type: 'date' },
  urgency: {
    label: '긴급도',
    step: 3,
    max: 20,
    required: true,
    options: ['일반', '긴급', '일정 협의'],
  },
  requestBackground: {
    label: '요청 배경·해결할 문제',
    step: 3,
    max: 4000,
    required: true,
    multiline: true,
  },
} as const;

export type ApplicationField = keyof typeof applicationFields;
export type ApplicationDetails = { version: 1 } & Record<
  ApplicationField,
  string
>;
export const applicationFieldKeys = Object.keys(
  applicationFields,
) as ApplicationField[];
export const applicationServices = [
  '기업인증',
  '정책자금',
  '특허·지식재산',
  '영업권·법인전환',
  '부동산 프로젝트',
  'CEO 자산관리',
  '보험 법인영업',
  '기타 기업컨설팅',
];
export const applicationCompanyMaxLength = 100;
export const emptyApplicationDetails = (): ApplicationDetails => ({
  version: 1,
  relationship: '직접 상담 중',
  collaborator: '',
  message: '',
  registrationNumber: '',
  representative: '',
  companyType: '법인사업자',
  business: '',
  location: '',
  contactName: '',
  contactPhone: '',
  requestedStart: '',
  urgency: '일반',
  requestBackground: '',
});

export class ApplicationDetailsError extends Error {
  constructor(
    message: string,
    public readonly step: number,
  ) {
    super(message);
  }
}

export function parseApplicationDetails(
  value: unknown,
  throughStep = 3,
): ApplicationDetails {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (value as { version?: unknown }).version !== 1
  )
    throw new ApplicationDetailsError(
      '신청 상세 입력 형식을 확인해 주세요.',
      1,
    );
  const source = value as Record<string, unknown>;
  if (
    Object.keys(source).some(
      (key) =>
        key !== 'version' &&
        !applicationFieldKeys.includes(key as ApplicationField),
    )
  )
    throw new ApplicationDetailsError('지원하지 않는 신청 상세 항목입니다.', 1);
  const parsed = emptyApplicationDetails();
  for (const key of applicationFieldKeys) {
    const config = applicationFields[key];
    const raw = source[key];
    if (typeof raw !== 'string')
      throw new ApplicationDetailsError(
        `${config.label} 입력 형식을 확인해 주세요.`,
        config.step,
      );
    const text = raw.trim();
    if (text.length > config.max)
      throw new ApplicationDetailsError(
        `${config.label}은 ${config.max}자 이내로 입력해 주세요.`,
        config.step,
      );
    if (config.step <= throughStep && 'required' in config && !text)
      throw new ApplicationDetailsError(
        `${config.label}을 입력해 주세요.`,
        config.step,
      );
    if (
      'options' in config &&
      !config.options.some((option) => option === text)
    )
      throw new ApplicationDetailsError(
        `${config.label}을 목록에서 선택해 주세요.`,
        config.step,
      );
    if (
      key === 'registrationNumber' &&
      text &&
      !/^(?:\d{10}|\d{3}-\d{2}-\d{5})$/.test(text)
    )
      throw new ApplicationDetailsError(
        '사업자등록번호는 숫자 10자리로 입력해 주세요.',
        2,
      );
    if (
      key === 'requestedStart' &&
      text &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(text) ||
        !Number.isFinite(Date.parse(text)) ||
        new Date(text).toISOString().slice(0, 10) !== text)
    )
      throw new ApplicationDetailsError(
        '희망 진행시기는 올바른 날짜로 입력해 주세요.',
        3,
      );
    parsed[key] =
      key === 'registrationNumber' ? text.replaceAll('-', '') : text;
  }
  return parsed;
}

/** Carry submitted details through older clients that do not yet know the field. */
export function preserveApplicationDetails(
  current: unknown,
  incoming: unknown,
): unknown {
  const previous =
    (current as { cases?: Array<Record<string, unknown>> } | null)?.cases ?? [];
  const next = incoming as { cases?: Array<Record<string, unknown>> };
  if (!Array.isArray(next.cases)) return incoming;
  const byId = new Map(previous.map((item) => [item.id, item]));
  return {
    ...next,
    cases: next.cases.map((item) => {
      const details =
        item.applicationDetails === undefined
          ? byId.get(item.id)?.applicationDetails
          : item.applicationDetails;
      if (details === undefined) return item;
      const parsed = parseApplicationDetails(details);
      if (
        typeof item.company !== 'string' ||
        !item.company.trim() ||
        item.company.trim().length > applicationCompanyMaxLength
      )
        throw new ApplicationDetailsError(
          '기업명은 1~100자로 입력해 주세요.',
          2,
        );
      if (
        typeof item.service !== 'string' ||
        item.service
          .split(' · ')
          .some((service) => !applicationServices.includes(service))
      )
        throw new ApplicationDetailsError(
          '요청서비스를 목록에서 한 개 이상 선택해 주세요.',
          3,
        );
      return {
        ...item,
        company: item.company.trim(),
        applicationDetails: parsed,
      };
    }),
  };
}
