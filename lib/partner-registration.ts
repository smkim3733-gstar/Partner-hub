import { isValidLoginEmail, normalizeLoginEmail } from './member-email';

export const partnerTypes = [
  '한기평 컨설턴트',
  '타사 컨설턴트',
  '보험설계사',
  '기타',
] as const;
export type PartnerType = (typeof partnerTypes)[number];
export type PartnerAccount = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  affiliation?: string;
  cohort: string;
  memberType?: PartnerType;
  role: '교육생' | '리더 교육생' | '일반 파트너' | '리더 파트너';
  status: '활성' | '승인대기' | '초대대기' | '정지';
  companies: number;
  lastLoginAt?: string;
  loginCount?: number;
  permissions: {
    sharedSchedule: boolean;
    collaborationApply: boolean;
    ownCases: boolean;
    fileUpload: boolean;
    quoteContract: boolean;
  };
  registration?: {
    method: 'admin' | 'self_password';
    requestId: string;
    createdAt: string;
    createdBy: string;
  };
};
export type PartnerRegistration = {
  name: string;
  phone: string;
  affiliation: string;
  email: string;
  memberType: PartnerType;
};
export type RegistrationErrors = Partial<
  Record<keyof PartnerRegistration | 'confirmed', string>
>;
/** Capture a primitive value before React/Base UI restores the controlled input. */
export function registrationFieldUpdate<K extends keyof PartnerRegistration>(
  key: K,
  value: PartnerRegistration[K],
) {
  return (current: PartnerRegistration): PartnerRegistration => ({
    ...current,
    [key]: value,
  });
}
export type PartnerRegistrationResult = {
  member: PartnerAccount;
  members: PartnerAccount[];
  membersRevision: number;
  replayed: boolean;
};

export const defaultPartnerPermissions = {
  sharedSchedule: true,
  collaborationApply: true,
  ownCases: true,
  fileUpload: true,
  quoteContract: false,
};
const clean = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';
export function validatePartnerRegistration(raw: Record<string, unknown>) {
  const value = {
    name: clean(raw.name),
    phone: clean(raw.phone),
    affiliation: clean(raw.affiliation),
    email: normalizeLoginEmail(clean(raw.email)),
    memberType: clean(raw.memberType) as PartnerType,
  };
  const errors: RegistrationErrors = {};
  if (
    value.name.length < 2 ||
    value.name.length > 40 ||
    /[\r\n\t]/.test(value.name)
  )
    errors.name = '이름은 2~40자로 입력해 주세요.';
  if (
    !/^[0-9+()\- .]{7,24}$/.test(value.phone) ||
    value.phone.replace(/\D/g, '').length < 7
  )
    errors.phone = '연락처를 숫자와 하이픈으로 입력해 주세요.';
  if (
    value.affiliation.length < 2 ||
    value.affiliation.length > 80 ||
    /[\r\n\t]/.test(value.affiliation)
  )
    errors.affiliation = '소속은 2~80자로 입력해 주세요.';
  if (value.email.length > 254 || !isValidLoginEmail(value.email))
    errors.email = '올바른 로그인 이메일을 입력해 주세요.';
  if (!partnerTypes.includes(value.memberType))
    errors.memberType = '파트너 유형을 선택해 주세요.';
  if (raw.confirmed !== true)
    errors.confirmed = '등록정보와 기본 접근 권한을 확인해 주세요.';
  return { value, errors };
}

export function membersRevisionOf(state: unknown): number {
  const revision = (state as { membersRevision?: number } | null)
    ?.membersRevision;
  return Number.isSafeInteger(revision) && Number(revision) >= 0
    ? Number(revision)
    : 0;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !['lastLoginAt', 'loginCount'].includes(key))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export function sameMemberRecords(left: unknown, right: unknown) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
