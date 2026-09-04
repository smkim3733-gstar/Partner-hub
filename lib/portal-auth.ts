import {
  hasDuplicateLoginEmail,
  isReservedPortalOwnerEmail,
  isValidLoginEmail,
  LOCAL_PORTAL_OWNER_EMAIL,
  normalizeLoginEmail,
  PORTAL_OWNER_EMAIL,
} from '@/lib/member-email';
import type { PortalLoginStat } from '@/lib/portal-state';
import {
  chatGPTIdentityBinding,
  chatGPTIdentityConflictMessage,
  chatGPTOwnerIdentityConflictMessage,
  claimChatGPTMemberBinding,
  claimChatGPTOwnerBinding,
  passwordIdentity,
  PasswordError,
} from '@/lib/password-store';
import { isPilotSeedId, type PilotSeedKind } from '@/lib/pilot-readiness';
import {
  chatGPTDisplayNameFromRequest,
  chatGPTIdentityFromRequest,
} from '@/lib/request-auth';
import {
  membersRevisionOf,
  partnerTypes,
} from '@/lib/partner-registration';

type PortalPermissions = {
  sharedSchedule: boolean;
  collaborationApply: boolean;
  ownCases: boolean;
  fileUpload: boolean;
  quoteContract: boolean;
};

type PortalMember = {
  id: string;
  name: string;
  email: string;
  status: '활성' | '승인대기' | '초대대기' | '정지';
  lastLoginAt?: string;
  loginCount?: number;
  permissions: PortalPermissions;
  [key: string]: unknown;
};

type PortalRecord = Record<string, unknown>;

type PortalStateRecord = {
  version: number;
  consultationNumber: number;
  timeline: PortalRecord[];
  schedule: PortalRecord[];
  tasks: PortalRecord[];
  companyDocuments: PortalRecord[];
  cases: PortalRecord[];
  members: PortalMember[];
  membersRevision?: number;
  diagnosisAssessments?: PortalRecord[];
};

const portalPermissionKeys = [
  'sharedSchedule',
  'collaborationApply',
  'ownCases',
  'fileUpload',
  'quoteContract',
] as const;

const portalMemberStatusTransitions = {
  활성: new Set(['활성', '정지']),
  정지: new Set(['정지', '활성']),
  승인대기: new Set(['승인대기', '활성']),
  초대대기: new Set(['초대대기', '활성']),
} as const;

function isPortalPermissions(value: unknown): value is PortalPermissions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === portalPermissionKeys.length &&
    portalPermissionKeys.every((key) => typeof record[key] === 'boolean')
  );
}

function effectivePortalPermissions(value: unknown): PortalPermissions {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    sharedSchedule: record.sharedSchedule === true,
    collaborationApply: record.collaborationApply === true,
    ownCases: record.ownCases === true,
    fileUpload: record.fileUpload === true,
    quoteContract: record.quoteContract === true,
  };
}

function samePermissionValues(left: unknown, right: unknown) {
  if (
    !left ||
    typeof left !== 'object' ||
    Array.isArray(left) ||
    !right ||
    typeof right !== 'object' ||
    Array.isArray(right)
  )
    return Object.is(left, right);
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && leftRecord[key] === rightRecord[key],
    )
  );
}

function isPartnerType(value: unknown) {
  return (
    typeof value === 'string' &&
    partnerTypes.includes(value as (typeof partnerTypes)[number])
  );
}

function applyAdminMemberEdits(
  stored: PortalMember,
  incoming: PortalMember,
  validate: boolean,
) {
  const incomingName =
    typeof incoming.name === 'string' ? incoming.name.trim() : '';
  const nameChanged = incoming.name !== stored.name;
  const permissionsChanged = !samePermissionValues(
    stored.permissions,
    incoming.permissions,
  );
  if (validate) {
    if (
      nameChanged &&
      (incomingName.length < 2 ||
        incomingName.length > 40 ||
        /[\r\n\t]/.test(incomingName))
    )
      throw new PortalAccessError(
        '파트너 이름은 2~40자로 입력해 주세요.',
        403,
      );
    const allowedStatuses = portalMemberStatusTransitions[stored.status];
    if (!allowedStatuses?.has(incoming.status))
      throw new PortalAccessError(
        '허용되지 않은 파트너 로그인 상태 변경입니다.',
        403,
      );
    if (permissionsChanged && !isPortalPermissions(incoming.permissions))
      throw new PortalAccessError(
        '파트너 권한 설정 형식이 올바르지 않습니다.',
        403,
      );
    const memberTypeChanged = incoming.memberType !== stored.memberType;
    const pendingActivation =
      (stored.status === '승인대기' || stored.status === '초대대기') &&
      incoming.status === '활성';
    if (
      (memberTypeChanged || pendingActivation) &&
      !isPartnerType(incoming.memberType)
    )
      throw new PortalAccessError('파트너 유형을 다시 선택해 주세요.', 403);
  }

  const protectedMember: PortalMember = {
    ...stored,
    name: nameChanged ? incomingName : stored.name,
    email: normalizeLoginEmail(incoming.email),
    status: incoming.status,
    permissions: permissionsChanged
      ? isPortalPermissions(incoming.permissions)
        ? { ...incoming.permissions }
        : incoming.permissions
      : stored.permissions,
  };
  if (Object.prototype.hasOwnProperty.call(incoming, 'memberType'))
    protectedMember.memberType = incoming.memberType;
  else delete protectedMember.memberType;
  return protectedMember;
}

export type PortalUser = {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'trainee';
  memberId: string | null;
  memberName: string | null;
  permissions: PortalPermissions | null;
  authMethod?: 'password' | 'chatgpt';
};

export class PortalAccessError extends Error {
  public readonly status: 401 | 403;

  constructor(message: string, status: 401 | 403) {
    super(message);
    this.status = status;
  }
}

function isPortalRecord(value: unknown): value is PortalRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isPortalRecordArray(value: unknown): value is PortalRecord[] {
  return Array.isArray(value) && value.every(isPortalRecord);
}

function hasPortalRecordStructure(
  value: unknown,
): value is PortalStateRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const state = value as Partial<PortalStateRecord>;
  return (
    isPortalRecordArray(state.timeline) &&
    isPortalRecordArray(state.schedule) &&
    isPortalRecordArray(state.tasks) &&
    isPortalRecordArray(state.companyDocuments) &&
    isPortalRecordArray(state.cases) &&
    isPortalRecordArray(state.members)
  );
}

function portalStateMetadataError(state: PortalStateRecord): string | null {
  if (state.version !== 1)
    return '저장 데이터 버전을 확인할 수 없습니다.';
  if (
    !Number.isSafeInteger(state.consultationNumber) ||
    state.consultationNumber < 0
  )
    return '상담 번호가 올바르지 않습니다.';
  if (
    state.membersRevision !== undefined &&
    (!Number.isSafeInteger(state.membersRevision) || state.membersRevision < 0)
  )
    return '파트너 명단 버전이 올바르지 않습니다.';
  if (
    state.diagnosisAssessments !== undefined &&
    !isPortalRecordArray(state.diagnosisAssessments)
  )
    return '사전점검 데이터 형식이 올바르지 않습니다.';
  return null;
}

const stableRecordIdCollections = [
  ['cases', '사건'],
  ['tasks', '업무'],
  ['companyDocuments', '기업자료'],
  ['schedule', '일정'],
] as const;

function portalRecordIdError(state: PortalStateRecord): string | null {
  for (const [key, label] of stableRecordIdCollections) {
    const ids = new Set<string>();
    for (const record of state[key]) {
      const id = record.id;
      if (
        typeof id !== 'string' ||
        !id ||
        id !== id.trim() ||
        ids.has(id)
      )
        return `${label} ID가 없거나 중복되었습니다.`;
      ids.add(id);
    }
  }
  if (state.diagnosisAssessments) {
    const ids = new Set<string>();
    for (const record of state.diagnosisAssessments) {
      const id = record.id;
      if (
        typeof id !== 'string' ||
        !id ||
        id !== id.trim() ||
        ids.has(id)
      )
        return '사전점검 ID가 없거나 중복되었습니다.';
      ids.add(id);
    }
  }
  return null;
}

export function hasPortalStateStructure(value: unknown) {
  return (
    hasPortalRecordStructure(value) &&
    portalStateMetadataError(value) === null &&
    portalRecordIdError(value) === null
  );
}

function asPortalState(value: unknown): PortalStateRecord | null {
  return hasPortalStateStructure(value) ? (value as PortalStateRecord) : null;
}

function invalidPortalStateMessage(value: unknown) {
  return hasPortalRecordStructure(value)
    ? portalStateMetadataError(value) ??
        portalRecordIdError(value) ??
        '저장 데이터 형식이 올바르지 않습니다.'
    : '저장 데이터 형식이 올바르지 않습니다.';
}

export function normalizedMemberName(name: unknown) {
  return typeof name === 'string' ? name.replace('(가상)', '').trim() : '';
}

export async function requirePortalUser(
  request: Request,
  rawState: unknown,
): Promise<PortalUser> {
  let passwordUser;
  try {
    passwordUser = await passwordIdentity(request);
  } catch (error) {
    if (
      error instanceof PasswordError &&
      (error.status === 401 || error.status === 403)
    )
      throw new PortalAccessError(error.message, error.status);
    throw error;
  }
  if (passwordUser) {
    const matchingIds =
      asPortalState(rawState)?.members.filter(
        (item) => item.id === passwordUser.member_id,
      ) ?? [];
    const member = matchingIds.length === 1 ? matchingIds[0] : null;
    const memberName = member ? normalizedMemberName(member.name) : '';
    if (
      !member ||
      typeof member.email !== 'string' ||
      member.email.trim().toLowerCase() !== passwordUser.email ||
      member.status !== '활성' ||
      !memberName
    )
      throw new PortalAccessError(
        '대표 승인 전이거나 이용이 정지된 계정입니다.',
        403,
      );
    return {
      id: `password:${member.id}`,
      email: passwordUser.email,
      displayName: memberName,
      role: 'trainee',
      memberId: member.id,
      memberName,
      permissions: effectivePortalPermissions(member.permissions),
      authMethod: 'password',
    };
  }
  const identity = chatGPTIdentityFromRequest(request);
  if (!identity) {
    throw new PortalAccessError('로그인 정보를 확인할 수 없습니다.', 401);
  }
  const { id, email } = identity;

  const isLocalOwner =
    new URL(request.url).hostname === 'localhost' &&
    email === LOCAL_PORTAL_OWNER_EMAIL;
  if (isLocalOwner) {
    return {
      id,
      email,
      displayName: '김성민 대표(로컬)',
      role: 'admin',
      memberId: null,
      memberName: null,
      permissions: null,
      authMethod: 'chatgpt',
    };
  }

  const identityBinding = await chatGPTIdentityBinding(id);
  if (identityBinding?.kind === 'invalid')
    throw new PortalAccessError(chatGPTIdentityConflictMessage, 403);
  if (identityBinding?.kind === 'owner' || email === PORTAL_OWNER_EMAIL) {
    if (
      identityBinding?.kind === 'member' ||
      (!identityBinding && !(await claimChatGPTOwnerBinding(id)))
    )
      throw new PortalAccessError(chatGPTOwnerIdentityConflictMessage, 403);
    return {
      id,
      email,
      displayName: '김성민 대표',
      role: 'admin',
      memberId: null,
      memberName: null,
      permissions: null,
      authMethod: 'chatgpt',
    };
  }

  const state = asPortalState(rawState);
  const boundMemberId =
    identityBinding?.kind === 'member' ? identityBinding.memberId : null;
  const matchingMembers = boundMemberId
    ? []
    : (state?.members.filter(
        (item) =>
          typeof item.email === 'string' &&
          item.email.trim().toLowerCase() === email,
      ) ?? []);
  if (!boundMemberId && matchingMembers.length > 1)
    throw new PortalAccessError(chatGPTIdentityConflictMessage, 403);
  const candidateMember = boundMemberId ? null : matchingMembers[0];
  const candidateMemberId = boundMemberId ?? candidateMember?.id ?? null;
  const matchingIds = candidateMemberId
    ? (state?.members.filter((item) => item.id === candidateMemberId) ?? [])
    : [];
  if (candidateMember && !candidateMemberId)
    throw new PortalAccessError(chatGPTIdentityConflictMessage, 403);
  if (candidateMemberId && matchingIds.length > 1)
    throw new PortalAccessError(chatGPTIdentityConflictMessage, 403);
  const member = boundMemberId ? matchingIds[0] : candidateMember;
  const memberName = member ? normalizedMemberName(member.name) : '';
  if (
    !member ||
    member.status !== '활성' ||
    !memberName ||
    !isValidLoginEmail(member.email)
  ) {
    throw new PortalAccessError(
      '아직 대표 승인이 완료된 활성 파트너 계정이 아닙니다.',
      403,
    );
  }
  if (
    !boundMemberId &&
    !(await claimChatGPTMemberBinding(id, member.id, email))
  )
    throw new PortalAccessError(chatGPTIdentityConflictMessage, 403);

  return {
    id,
    email,
    displayName: chatGPTDisplayNameFromRequest(request, email),
    role: 'trainee',
    memberId: member.id,
    memberName,
    permissions: effectivePortalPermissions(member.permissions),
    authMethod: 'chatgpt',
  };
}

function field(record: PortalRecord, key: string) {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function incomingRetainsMember(
  current: PortalStateRecord,
  incoming: PortalStateRecord,
  member: PortalMember,
) {
  const incomingMatches = incoming.members.filter(
    (candidate) => candidate.id === member.id,
  );
  if (!incomingMatches.length) return false;
  const currentMatches = current.members.filter(
    (candidate) => candidate.id === member.id,
  );
  if (currentMatches.length === 1) return true;
  const email =
    typeof member.email === 'string' ? member.email.trim().toLowerCase() : '';
  return (
    Boolean(email) &&
    incomingMatches.some(
      (candidate) => candidate.email.trim().toLowerCase() === email,
    )
  );
}

function recordReferencesMember(
  record: PortalRecord,
  ownerKey: string,
  member: PortalMember,
) {
  if (record.partnerMemberId != null)
    return field(record, 'partnerMemberId') === member.id;
  const memberName =
    typeof member.name === 'string' ? normalizedMemberName(member.name) : '';
  return (
    Boolean(memberName) &&
    normalizedMemberName(field(record, ownerKey)) === memberName
  );
}

function memberHasAssignedRecords(
  state: PortalStateRecord,
  member: PortalMember,
) {
  return (
    state.cases.some((record) =>
      recordReferencesMember(record, 'trainee', member),
    ) ||
    state.tasks.some((record) =>
      recordReferencesMember(record, 'assignee', member),
    ) ||
    state.companyDocuments.some((record) =>
      recordReferencesMember(record, 'assignedTrainee', member),
    ) ||
    state.schedule.some((record) =>
      recordReferencesMember(record, 'assignedTrainee', member),
    )
  );
}

function assertMemberDeletionsAllowed(
  current: PortalStateRecord,
  incoming: PortalStateRecord,
) {
  for (const member of current.members) {
    if (incomingRetainsMember(current, incoming, member)) continue;
    if (member.status === '활성')
      throw new PortalAccessError(
        '활성 파트너 계정은 먼저 정지한 뒤 삭제해 주세요.',
        403,
      );
    if (memberHasAssignedRecords(current, member))
      throw new PortalAccessError(
        '담당 진행·업무·자료·일정을 다른 계정으로 옮긴 뒤 파트너 계정을 삭제해 주세요.',
        403,
      );
  }
}

// Legacy names only authorize access when they resolve to exactly one account,
// including inactive accounts. Never guess which same-name partner owns a record.
export function uniqueMemberIdForName(
  rawState: unknown,
  name: string,
): string | null {
  const state = asPortalState(rawState);
  const normalized = normalizedMemberName(name);
  if (!state || !normalized) return null;
  const matches = state.members.filter(
    (member) => normalizedMemberName(member.name) === normalized,
  );
  return matches.length === 1 ? matches[0].id : null;
}

function caseOwnerId(
  state: PortalStateRecord,
  record: PortalRecord,
): string | null {
  if (record.partnerMemberId != null)
    return field(record, 'partnerMemberId') || null;
  return uniqueMemberIdForName(state, field(record, 'trainee'));
}

function ownsRecord(
  state: PortalStateRecord,
  record: PortalRecord,
  ownerKey: string,
  user: PortalUser,
) {
  if (!user.memberId) return false;
  if (record.caseId != null) {
    const linked = state.cases.find(
      (item) => field(item, 'id') === field(record, 'caseId'),
    );
    if (!linked || caseOwnerId(state, linked) !== user.memberId) return false;
    if (record.partnerMemberId == null) return true;
  }
  if (record.partnerMemberId != null)
    return field(record, 'partnerMemberId') === user.memberId;
  return (
    uniqueMemberIdForName(state, field(record, ownerKey)) === user.memberId
  );
}

function timelineCaseId(record: PortalRecord) {
  return field(record, 'caseId') || 'case-1';
}

function timelineMergeKey(record: PortalRecord) {
  const caseId = timelineCaseId(record);
  const id = field(record, 'id');
  return id
    ? `id:${caseId}:${id}`
    : `legacy:${caseId}:${field(record, 'date')}:${field(record, 'title')}`;
}

function sanitizeScheduleForTrainee(
  state: PortalStateRecord,
  record: PortalRecord,
  user: PortalUser,
): PortalRecord | null {
  if (field(record, 'shareMode') === 'private') return null;
  const canSeeDetails =
    field(record, 'shareMode') === 'all_with_assignee' &&
    ownsRecord(state, record, 'assignedTrainee', user) &&
    record.private !== true;
  if (canSeeDetails) return record;

  return {
    // Share only timing fields; arbitrary descriptions, URLs and linked IDs must
    // never survive masking by spreading a private source record.
    id: record.id,
    date: record.date,
    isoDate: record.isoDate,
    endIsoDate: record.endIsoDate,
    weekday: record.weekday,
    time: record.time,
    end: record.end,
    source: record.source,
    shareMode: 'all_busy',
    company:
      field(record, 'source') === 'google'
        ? '대표 일정 예약됨'
        : '협업 상담 예약됨',
    service:
      field(record, 'source') === 'google'
        ? '상세 내용 비공개'
        : '담당 파트너만 상세 확인',
    method: '시간만 공유',
    status: '예약됨',
    tone: 'slate',
  };
}

export function stateForPortalUser(
  rawState: unknown,
  user: PortalUser,
): unknown {
  if (user.role === 'admin') return rawState;
  const state = asPortalState(rawState);
  if (!state)
    throw new PortalAccessError(invalidPortalStateMessage(rawState), 403);

  const ownCases = state.cases.filter((record) =>
    ownsRecord(state, record, 'trainee', user),
  );
  const ownCaseIds = new Set(ownCases.map((record) => field(record, 'id')));

  return {
    ...state,
    diagnosisAssessments: [],
    cases: ownCases,
    tasks: state.tasks.filter((record) =>
      ownsRecord(state, record, 'assignee', user),
    ),
    companyDocuments: state.companyDocuments.filter((record) =>
      ownsRecord(state, record, 'assignedTrainee', user),
    ),
    schedule: state.schedule
      .map((record) => sanitizeScheduleForTrainee(state, record, user))
      .filter((record): record is PortalRecord => record !== null),
    timeline: state.timeline.filter((record) =>
      ownCaseIds.has(timelineCaseId(record)),
    ),
    members: state.members
      .filter((member) => member.id === user.memberId)
      .map((member) => ({
        ...member,
        permissions: effectivePortalPermissions(member.permissions),
      })),
  };
}

export function stateWithPortalLoginStats(
  rawState: unknown,
  stats: PortalLoginStat[],
): unknown {
  const state = asPortalState(rawState);
  if (!state) return rawState;
  const statsByMemberId = new Map(stats.map((stat) => [stat.memberId, stat]));

  return {
    ...state,
    members: state.members.map((member) => {
      const stat = statsByMemberId.get(member.id);
      return stat
        ? {
            ...member,
            lastLoginAt: stat.lastLoginAt,
            loginCount: stat.loginCount,
          }
        : member;
    }),
  };
}

function mergeOwnedRecords(
  state: PortalStateRecord,
  existing: PortalRecord[],
  incoming: PortalRecord[],
  ownerKey: string,
  user: PortalUser,
  seedKind: PilotSeedKind,
) {
  const owner = user.memberName ?? '';
  const incomingOwned = incoming.filter((record) => {
    if (!user.memberId || !field(record, 'id')) return false;
    if (
      record.partnerMemberId != null &&
      field(record, 'partnerMemberId') !== user.memberId
    )
      return false;
    if (record.caseId != null) {
      const linked = state.cases.find(
        (item) => field(item, 'id') === field(record, 'caseId'),
      );
      if (!linked || caseOwnerId(state, linked) !== user.memberId) return false;
      // A case-linked follow-up may have no legacy assignee name. Its stored
      // case assignment must authorize editing just as it authorizes reading.
      if (record.partnerMemberId == null) return true;
    }
    return (
      record.partnerMemberId === user.memberId ||
      normalizedMemberName(field(record, ownerKey)) === owner
    );
  });
  const incomingById = new Map(
    incomingOwned.map((record) => [field(record, 'id'), record]),
  );
  const existingIds = new Set(existing.map((record) => field(record, 'id')));
  const merged = existing.map((record) => {
    // Authorize using the stored assignment, not client-submitted names or IDs.
    if (!ownsRecord(state, record, ownerKey, user)) return record;
    const replacement = incomingById.get(field(record, 'id'));
    return replacement
      ? { ...replacement, [ownerKey]: owner, partnerMemberId: user.memberId }
      : record;
  });
  for (const [id, record] of incomingById) {
    if (!existingIds.has(id)) {
      if (isPilotSeedId(seedKind, id))
        throw new PortalAccessError(
          '가상 예시 식별자는 새 운영 기록에 사용할 수 없습니다.',
          403,
        );
      merged.push({
        ...record,
        [ownerKey]: owner,
        partnerMemberId: user.memberId,
      });
    }
  }
  return merged;
}

export function mergeStateForPortalUser(
  currentRaw: unknown,
  incomingRaw: unknown,
  user: PortalUser,
): unknown {
  const incoming = asPortalState(incomingRaw);
  if (!incoming)
    throw new PortalAccessError(invalidPortalStateMessage(incomingRaw), 403);
  const current = asPortalState(currentRaw);

  if (user.role === 'admin') {
    const memberIds = new Set<string>();
    const invalidMemberId = incoming.members.find((member) => {
      if (
        typeof member.id !== 'string' ||
        !member.id ||
        member.id !== member.id.trim() ||
        memberIds.has(member.id)
      )
        return true;
      memberIds.add(member.id);
      return false;
    });
    if (invalidMemberId)
      throw new PortalAccessError(
        '파트너 계정 ID가 없거나 중복되었습니다.',
        403,
      );

    if (current) {
      const currentMemberIds = new Set(
        current.members.map((member) => member.id),
      );
      const inventedMemberId = incoming.members.find(
        (member) => !currentMemberIds.has(member.id),
      );
      if (inventedMemberId)
        throw new PortalAccessError(
          '새 파트너 계정은 자가가입 또는 관리자 직접등록으로 만들어 주세요. 기존 계정 ID는 변경할 수 없습니다.',
          403,
        );
    }

    const invalidEmail = incoming.members.find(
      (member) => !isValidLoginEmail(member.email),
    );
    if (invalidEmail)
      throw new PortalAccessError(
        '파트너 로그인 이메일 형식이 올바르지 않습니다.',
        403,
      );

    const reservedOwnerEmail = incoming.members.find((member) =>
      isReservedPortalOwnerEmail(member.email),
    );
    if (reservedOwnerEmail)
      throw new PortalAccessError(
        '대표 관리자 이메일은 파트너 계정에 사용할 수 없습니다.',
        403,
      );

    const duplicateEmail = incoming.members.find((member) =>
      hasDuplicateLoginEmail(incoming.members, member.email, member.id),
    );
    if (duplicateEmail)
      throw new PortalAccessError(
        '이미 등록된 파트너 로그인 이메일입니다.',
        403,
      );
    const currentMemberRevision =
      current && membersRevisionOf(incoming) === membersRevisionOf(current);
    if (
      current &&
      currentMemberRevision
    )
      assertMemberDeletionsAllowed(current, incoming);
    const members = current
      ? incoming.members.map((member) => {
          const storedMatches = current.members.filter(
            (stored) => stored.id === member.id,
          );
          const emailMatches = storedMatches.filter(
            (candidate) =>
              normalizeLoginEmail(candidate.email) ===
              normalizeLoginEmail(member.email),
          );
          const stored =
            storedMatches.length === 1
              ? storedMatches[0]
              : emailMatches.length === 1
                ? emailMatches[0]
                : undefined;
          if (!stored)
            throw new PortalAccessError(
              '파트너 계정 ID가 중복되어 변경 대상을 확인할 수 없습니다. 중복 계정을 먼저 정리해 주세요.',
              403,
            );
          return applyAdminMemberEdits(
            stored,
            member,
            Boolean(currentMemberRevision),
          );
        })
      : incoming.members;
    return { ...incoming, members };
  }

  if (!current)
    throw new PortalAccessError('저장 데이터 형식이 올바르지 않습니다.', 403);

  const cases = mergeOwnedRecords(
    current,
    current.cases,
    incoming.cases,
    'trainee',
    user,
    'case',
  );
  const relatedState = { ...current, cases };
  const ownCaseIds = new Set(
    cases
      .filter((record) => ownsRecord(relatedState, record, 'trainee', user))
      .map((record) => field(record, 'id')),
  );
  const incomingTimeline = incoming.timeline.filter((record) =>
    ownCaseIds.has(timelineCaseId(record)),
  );
  const timelineByKey = new Map(
    incomingTimeline.map((record) => [timelineMergeKey(record), record]),
  );
  const existingTimelineKeys = new Set(current.timeline.map(timelineMergeKey));
  const mergedTimeline = current.timeline.map(
    (record) => timelineByKey.get(timelineMergeKey(record)) ?? record,
  );
  for (const [key, record] of timelineByKey) {
    if (!existingTimelineKeys.has(key)) mergedTimeline.push(record);
  }

  return {
    ...current,
    consultationNumber: Math.max(
      current.consultationNumber,
      incoming.consultationNumber,
    ),
    cases,
    tasks: mergeOwnedRecords(
      relatedState,
      current.tasks,
      incoming.tasks,
      'assignee',
      user,
      'task',
    ),
    companyDocuments: mergeOwnedRecords(
      relatedState,
      current.companyDocuments,
      incoming.companyDocuments,
      'assignedTrainee',
      user,
      'document',
    ),
    schedule: mergeOwnedRecords(
      relatedState,
      current.schedule,
      incoming.schedule,
      'assignedTrainee',
      user,
      'schedule',
    ),
    timeline: mergedTimeline,
    members: current.members,
  };
}
