import { FlowError, type ConsultingFlow } from './consulting-flow';
import type { PortalUser } from './portal-auth';

type Member = { id: string; name: string; status: string };
type Case = {
  id: string;
  company: string;
  trainee: string;
  partnerMemberId?: string;
};
export type Assignment = {
  caseId: string;
  company: string;
  partnerId: string;
  partnerName: string;
};
const normalized = (s: string) => s.replace('(가상)', '').trim();

/** Resolve a legacy name exactly once; thereafter the immutable member ID is the ACL. */
export function resolveFlowAssignment(
  raw: unknown,
  caseId: string,
  user: PortalUser,
  existing: ConsultingFlow | null,
): Assignment {
  const state = raw as { cases?: Case[]; members?: Member[] } | null;
  const item = state?.cases?.find((c) => c.id === caseId);
  if (!item) throw new FlowError('해당 컨설팅 진행을 찾을 수 없습니다.', 404);
  if (existing) {
    if (
      user.role !== 'admin' &&
      (user.memberId !== existing.partnerId || !user.permissions?.ownCases)
    )
      throw new FlowError('담당 파트너만 이 진행을 열 수 있습니다.', 403);
    return {
      caseId,
      company: existing.company,
      partnerId: existing.partnerId,
      partnerName: existing.partnerName,
    };
  }
  const matches =
    state?.members?.filter((m) =>
      item.partnerMemberId
        ? m.id === item.partnerMemberId
        : normalized(m.name) === normalized(item.trainee),
    ) ?? [];
  if (matches.length !== 1)
    throw new FlowError(
      '전체 진행현황에서 대표님이 담당 파트너 계정을 먼저 지정해 주세요. 동명이인은 계정 식별 확인이 필요합니다.',
      409,
    );
  const partner = matches[0];
  if (
    user.role !== 'admin' &&
    (partner.id !== user.memberId || !user.permissions?.ownCases)
  )
    throw new FlowError('담당 파트너만 이 진행을 열 수 있습니다.', 403);
  return {
    caseId,
    company: item.company,
    partnerId: partner.id,
    partnerName: normalized(partner.name),
  };
}

export function publicFlow(flow: ConsultingFlow): ConsultingFlow {
  return {
    ...flow,
    files: flow.files.map((f) => ({ ...f, key: '' })),
    commandIds: [],
    commandReceipts: undefined,
  };
}
