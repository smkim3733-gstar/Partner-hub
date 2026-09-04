import {
  hasDuplicateLoginEmail,
  isReservedPortalOwnerEmail,
  isValidLoginEmail,
  LOCAL_PORTAL_OWNER_EMAIL,
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
  diagnosisAssessments?: PortalRecord[];
};

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

function asPortalState(value: unknown): PortalStateRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const state = value as Partial<PortalStateRecord>;
  if (
    !Array.isArray(state.timeline) ||
    !Array.isArray(state.schedule) ||
    !Array.isArray(state.tasks) ||
    !Array.isArray(state.companyDocuments) ||
    !Array.isArray(state.cases) ||
    !Array.isArray(state.members)
  )
    return null;
  return state as PortalStateRecord;
}

export function normalizedMemberName(name: string) {
  return name.replace('(가상)', '').trim();
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
    if (
      !member ||
      typeof member.email !== 'string' ||
      member.email.trim().toLowerCase() !== passwordUser.email ||
      member.status !== '활성'
    )
      throw new PortalAccessError(
        '대표 승인 전이거나 이용이 정지된 계정입니다.',
        403,
      );
    return {
      id: `password:${member.id}`,
      email: passwordUser.email,
      displayName: normalizedMemberName(member.name),
      role: 'trainee',
      memberId: member.id,
      memberName: normalizedMemberName(member.name),
      permissions: member.permissions,
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
  if (!member || member.status !== '활성') {
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

  const memberName = normalizedMemberName(member.name);
  return {
    id,
    email,
    displayName: chatGPTDisplayNameFromRequest(request, email),
    role: 'trainee',
    memberId: member.id,
    memberName,
    permissions: member.permissions,
    authMethod: 'chatgpt',
  };
}

function field(record: PortalRecord, key: string) {
  const value = record[key];
  return typeof value === 'string' ? value : '';
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
  const state = asPortalState(rawState);
  if (!state || user.role === 'admin') return rawState;

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
      .map((member) => ({ ...member, permissions: { ...member.permissions } })),
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
    throw new PortalAccessError('저장 데이터 형식이 올바르지 않습니다.', 403);
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
    return incoming;
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
