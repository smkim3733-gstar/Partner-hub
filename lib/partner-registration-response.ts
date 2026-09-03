import { isValidLoginEmail } from './member-email';
import {
  defaultPartnerPermissions,
  partnerTypes,
  type PartnerAccount,
  type PartnerRegistration,
  type PartnerRegistrationResult,
  type RegistrationErrors,
} from './partner-registration';
import { portalConflictReceiptFrom } from './portal-conflict-receipt';

type JsonObject = Record<string, unknown>;

export class PartnerRegistrationResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors: RegistrationErrors = {},
    readonly recoveryReceipt?: string,
  ) {
    super(message);
    this.name = 'PartnerRegistrationResponseError';
  }
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function boundedText(value: unknown, maxLength: number, allowEmpty = false) {
  return (
    typeof value === 'string' &&
    value.length <= maxLength &&
    (allowEmpty || value.trim().length > 0)
  );
}

function safeInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

const roles: PartnerAccount['role'][] = [
  '교육생',
  '리더 교육생',
  '일반 파트너',
  '리더 파트너',
];
const statuses: PartnerAccount['status'][] = [
  '활성',
  '승인대기',
  '초대대기',
  '정지',
];
const permissionKeys = [
  'sharedSchedule',
  'collaborationApply',
  'ownCases',
  'fileUpload',
  'quoteContract',
] as const;

function parsePartnerAccount(value: unknown): PartnerAccount | null {
  const member = asObject(value);
  const permissions = member ? asObject(member.permissions) : null;
  if (
    !member ||
    !boundedText(member.id, 200) ||
    !boundedText(member.name, 200) ||
    !boundedText(member.email, 254) ||
    !isValidLoginEmail(member.email as string) ||
    !boundedText(member.cohort, 80, true) ||
    !roles.includes(member.role as PartnerAccount['role']) ||
    !statuses.includes(member.status as PartnerAccount['status']) ||
    !safeInteger(member.companies) ||
    !permissions ||
    !permissionKeys.every((key) => typeof permissions[key] === 'boolean') ||
    (member.memberType !== undefined &&
      !partnerTypes.includes(
        member.memberType as (typeof partnerTypes)[number],
      )) ||
    (member.phone !== undefined && !boundedText(member.phone, 24, true)) ||
    (member.affiliation !== undefined &&
      !boundedText(member.affiliation, 80, true)) ||
    (member.lastLoginAt !== undefined &&
      !boundedText(member.lastLoginAt, 100, true)) ||
    (member.loginCount !== undefined && !safeInteger(member.loginCount))
  )
    return null;

  const registration =
    member.registration === undefined
      ? undefined
      : parseRegistration(member.registration);
  if (member.registration !== undefined && !registration) return null;

  return {
    id: member.id as string,
    name: member.name as string,
    email: member.email as string,
    ...(member.phone === undefined ? {} : { phone: member.phone as string }),
    ...(member.affiliation === undefined
      ? {}
      : { affiliation: member.affiliation as string }),
    cohort: member.cohort as string,
    ...(member.memberType === undefined
      ? {}
      : {
          memberType: member.memberType as NonNullable<
            PartnerAccount['memberType']
          >,
        }),
    role: member.role as PartnerAccount['role'],
    status: member.status as PartnerAccount['status'],
    companies: member.companies as number,
    ...(member.lastLoginAt === undefined
      ? {}
      : { lastLoginAt: member.lastLoginAt as string }),
    ...(member.loginCount === undefined
      ? {}
      : { loginCount: member.loginCount as number }),
    permissions: Object.fromEntries(
      permissionKeys.map((key) => [key, permissions[key]]),
    ) as PartnerAccount['permissions'],
    ...(registration ? { registration } : {}),
  };
}

function parseRegistration(
  value: unknown,
): PartnerAccount['registration'] | null {
  const registration = asObject(value);
  if (
    !registration ||
    (registration.method !== 'admin' &&
      registration.method !== 'self_password') ||
    !boundedText(registration.requestId, 100) ||
    !boundedText(registration.createdAt, 100) ||
    !Number.isFinite(Date.parse(registration.createdAt as string)) ||
    !boundedText(registration.createdBy, 200)
  )
    return null;
  return {
    method: registration.method,
    requestId: registration.requestId as string,
    createdAt: registration.createdAt as string,
    createdBy: registration.createdBy as string,
  };
}

function parseErrors(value: unknown): RegistrationErrors {
  const source = asObject(value);
  if (!source) return {};
  const result: RegistrationErrors = {};
  for (const key of [
    'name',
    'phone',
    'affiliation',
    'email',
    'memberType',
    'confirmed',
  ] as const) {
    if (boundedText(source[key], 500)) result[key] = source[key] as string;
  }
  return result;
}

function sameMember(left: PartnerAccount, right: PartnerAccount) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function expectedMember(
  member: PartnerAccount,
  expected: PartnerRegistration,
  requestId: string,
) {
  return (
    member.name === expected.name &&
    member.phone === expected.phone &&
    member.affiliation === expected.affiliation &&
    member.email === expected.email &&
    member.memberType === expected.memberType &&
    member.cohort === '' &&
    member.role === '일반 파트너' &&
    member.status === '활성' &&
    member.companies === 0 &&
    permissionKeys.every(
      (key) => member.permissions[key] === defaultPartnerPermissions[key],
    ) &&
    member.registration?.method === 'admin' &&
    member.registration.requestId === requestId
  );
}

function invalid(status: number) {
  return new PartnerRegistrationResponseError(
    '등록 결과 응답 형식이 올바르지 않습니다. 명단을 먼저 확인한 뒤 같은 내용으로 다시 시도해 주세요.',
    status,
  );
}

export async function readPartnerRegistrationResponse(
  response: Response,
  expected: { registration: PartnerRegistration; requestId: string },
): Promise<PartnerRegistrationResult> {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new PartnerRegistrationResponseError(
      '등록 결과 응답을 읽지 못했습니다. 명단을 먼저 확인한 뒤 같은 내용으로 다시 시도해 주세요.',
      response.status,
    );
  }
  const payload = asObject(raw);
  if (!response.ok) {
    throw new PartnerRegistrationResponseError(
      boundedText(payload?.error, 1_000)
        ? (payload?.error as string)
        : '등록 결과를 확인하지 못했습니다. 명단을 먼저 확인해 주세요.',
      response.status,
      parseErrors(payload?.errors),
      portalConflictReceiptFrom(payload?.recoveryReceipt),
    );
  }

  if (
    !payload ||
    !/^[a-zA-Z0-9_-]{16,100}$/.test(expected.requestId) ||
    !safeInteger(payload.membersRevision) ||
    Number(payload.membersRevision) < 1 ||
    typeof payload.replayed !== 'boolean' ||
    (payload.replayed ? response.status !== 200 : response.status !== 201) ||
    !Array.isArray(payload.members)
  )
    throw invalid(response.status);

  const member = parsePartnerAccount(payload.member);
  const members = payload.members.map(parsePartnerAccount);
  if (
    !member ||
    members.some((item) => item === null) ||
    !expectedMember(member, expected.registration, expected.requestId)
  )
    throw invalid(response.status);

  const parsedMembers = members as PartnerAccount[];
  const ids = parsedMembers.map((item) => item.id);
  const emails = parsedMembers.map((item) => item.email.trim().toLowerCase());
  const matchingMembers = parsedMembers.filter((item) => item.id === member.id);
  if (
    new Set(ids).size !== ids.length ||
    new Set(emails).size !== emails.length ||
    matchingMembers.length !== 1 ||
    !sameMember(matchingMembers[0]!, member)
  )
    throw invalid(response.status);

  return {
    member,
    members: parsedMembers,
    membersRevision: payload.membersRevision as number,
    replayed: payload.replayed,
  };
}
