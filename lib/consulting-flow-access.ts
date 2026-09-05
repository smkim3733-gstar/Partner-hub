import { FlowError, type ConsultingFlow } from './consulting-flow';
import { FLOW_OBJECT_KEYS } from './consulting-flow-shape';
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

function selectKeys<T extends object, K extends keyof T>(
  value: T,
  keys: readonly K[],
): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as Pick<T, K>;
}

export function publicFlow(flow: ConsultingFlow): ConsultingFlow {
  return {
    ...selectKeys(flow, FLOW_OBJECT_KEYS.root),
    reports: flow.reports.map((report) =>
      selectKeys(report, FLOW_OBJECT_KEYS.report),
    ),
    files: flow.files.map((file) => ({
      ...selectKeys(file, FLOW_OBJECT_KEYS.file),
      key: '',
    })),
    analysis: selectKeys(flow.analysis, FLOW_OBJECT_KEYS.analysis),
    meetings: flow.meetings.map((meeting) =>
      selectKeys(meeting, FLOW_OBJECT_KEYS.meeting),
    ),
    recordings: flow.recordings.map((recording) =>
      selectKeys(recording, FLOW_OBJECT_KEYS.recording),
    ),
    requests: flow.requests.map((request) =>
      selectKeys(request, FLOW_OBJECT_KEYS.request),
    ),
    decision: flow.decision
      ? {
          ...selectKeys(flow.decision, FLOW_OBJECT_KEYS.decision),
          solutions: [...flow.decision.solutions],
        }
      : undefined,
    contract: flow.contract
      ? selectKeys(flow.contract, FLOW_OBJECT_KEYS.contract)
      : undefined,
    payments: flow.payments.map((payment) =>
      selectKeys(payment, FLOW_OBJECT_KEYS.payment),
    ),
    aftercare: flow.aftercare
      ? selectKeys(flow.aftercare, FLOW_OBJECT_KEYS.aftercare)
      : undefined,
    ai: selectKeys(flow.ai, FLOW_OBJECT_KEYS.ai),
    jobs: flow.jobs.map((job) => ({
      ...selectKeys(job, FLOW_OBJECT_KEYS.job),
      evidence: job.evidence
        ? selectKeys(job.evidence, FLOW_OBJECT_KEYS.jobEvidence)
        : undefined,
      failureEvidence: job.failureEvidence
        ? selectKeys(job.failureEvidence, FLOW_OBJECT_KEYS.jobFailureEvidence)
        : undefined,
    })),
    audit: flow.audit.map((entry) => selectKeys(entry, FLOW_OBJECT_KEYS.audit)),
    commandIds: [],
    commandReceipts: undefined,
  };
}
