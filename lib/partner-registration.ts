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
  memberType: PartnerType | '';
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
export type PartnerAccountSettingsDraft = {
  memberId: string;
  email: string;
  memberType: PartnerType | '';
  status: '활성' | '정지';
  permissions: PartnerAccount['permissions'];
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
export function partnerTypeSelectionProblem(value: unknown) {
  return typeof value === 'string' &&
    partnerTypes.includes(value as PartnerType)
    ? ''
    : '파트너 유형을 선택해 주세요.';
}
export function partnerTypeSelectionForReview(
  status: PartnerAccount['status'],
  currentType: PartnerType,
): PartnerType | '' {
  return status === '승인대기' || status === '초대대기' ? '' : currentType;
}
export function createPartnerAccountSettingsDraft(
  member: PartnerAccount,
  currentType: PartnerType,
): PartnerAccountSettingsDraft {
  return {
    memberId: member.id,
    email: member.email,
    memberType: partnerTypeSelectionForReview(member.status, currentType),
    status: member.status === '정지' ? '정지' : '활성',
    permissions: { ...member.permissions },
  };
}
export function togglePartnerAccountPermission(
  draft: PartnerAccountSettingsDraft,
  key: keyof PartnerAccount['permissions'],
): PartnerAccountSettingsDraft {
  return {
    ...draft,
    permissions: {
      ...draft.permissions,
      [key]: !draft.permissions[key],
    },
  };
}
export function partnerAccountSettingsChanged(
  member: PartnerAccount,
  draft: PartnerAccountSettingsDraft,
  currentType: PartnerType,
) {
  return (
    member.id !== draft.memberId ||
    normalizeLoginEmail(member.email) !== normalizeLoginEmail(draft.email) ||
    partnerTypeSelectionForReview(member.status, currentType) !==
      draft.memberType ||
    (member.status === '정지' ? '정지' : '활성') !== draft.status ||
    Object.keys(member.permissions).some(
      (key) =>
        member.permissions[key as keyof PartnerAccount['permissions']] !==
        draft.permissions[key as keyof PartnerAccount['permissions']],
    )
  );
}
export function applyPartnerAccountSettingsDraft(
  member: PartnerAccount,
  draft: PartnerAccountSettingsDraft,
  approve = false,
): PartnerAccount {
  if (member.id !== draft.memberId)
    throw new Error('설정 중인 파트너 계정을 다시 확인해 주세요.');
  if (!isValidLoginEmail(draft.email))
    throw new Error('올바른 로그인 이메일을 입력해 주세요.');
  const typeProblem = partnerTypeSelectionProblem(draft.memberType);
  if (typeProblem) throw new Error(typeProblem);
  return {
    ...member,
    email: normalizeLoginEmail(draft.email),
    memberType: draft.memberType as PartnerType,
    role: approve
      ? '일반 파트너'
      : member.role === '리더 파트너'
        ? member.role
        : '일반 파트너',
    status: approve ? '활성' : draft.status,
    permissions: { ...draft.permissions },
  };
}
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
  const memberTypeProblem = partnerTypeSelectionProblem(value.memberType);
  if (memberTypeProblem) errors.memberType = memberTypeProblem;
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
