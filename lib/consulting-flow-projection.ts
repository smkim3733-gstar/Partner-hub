import {
  nextFlowAction,
  phaseOf,
  type ConsultingFlow,
} from './consulting-flow';

export function flowPipelineStage(flow: ConsultingFlow) {
  const phase = phaseOf(flow);
  if (phase === '컨설팅 수행') return '컨설팅수행';
  if (phase === '사후관리') return '사후관리';
  if (['5차·6차 준비', '계약 상담', '계약 체결', '계약금 확인'].includes(phase))
    return '계약';
  if (['초회상담 예약', '2차·3차 준비', '초회상담'].includes(phase))
    return '상담예약';
  if (['1차 보고서', '공동분석'].includes(phase)) return '기업진단';
  return '상담진행';
}
type RecordValue = Record<string, unknown>;
export function projectFlowState(
  raw: unknown,
  flows: ConsultingFlow[],
  now = new Date().toISOString(),
): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const state = raw as {
    cases: RecordValue[];
    schedule: RecordValue[];
    members: RecordValue[];
  };
  if (
    !Array.isArray(state.cases) ||
    !Array.isArray(state.schedule) ||
    !Array.isArray(state.members)
  )
    return raw;
  const byId = new Map(flows.map((f) => [f.caseId, f]));
  const partnerName = (flow: ConsultingFlow) => {
    const name = state.members.find((m) => m.id === flow.partnerId)?.name;
    return (typeof name === 'string' ? name : flow.partnerName)
      .replace('(가상)', '')
      .trim();
  };
  return {
    ...state,
    cases: state.cases.map((item) => {
      const flow = byId.get(String(item.id));
      if (!flow) {
        const {
          flowManaged: _flowManaged,
          flowPhase: _flowPhase,
          ...unmanaged
        } = item;
        return unmanaged;
      }
      return {
        ...item,
        company: flow.company,
        trainee: partnerName(flow),
        partnerMemberId: flow.partnerId,
        flowManaged: true,
        flowPhase: phaseOf(flow),
        stage: flowPipelineStage(flow),
        nextAction: nextFlowAction(flow).message,
        consultationCount: flow.meetings.filter((m) => m.status === 'completed')
          .length,
        updatedAt: new Date(flow.updatedAt).toLocaleDateString('ko-KR', {
          timeZone: 'Asia/Seoul',
        }),
        idleDays: Math.max(
          0,
          Math.floor((Date.parse(now) - Date.parse(flow.updatedAt)) / 86400000),
        ),
        urgent: false,
      };
    }),
    schedule: [
      ...state.schedule.filter(
        (item) => !String(item.id).startsWith('flow-meeting:'),
      ),
      ...flows.flatMap((flow) =>
        flow.meetings
          .filter((m) => m.status === 'scheduled' && m.attendance !== 'partner')
          .map((m) => {
            const start = new Date(Date.parse(m.startsAt) + 9 * 3600000);
            const end = new Date(Date.parse(m.endsAt) + 9 * 3600000);
            return {
              id: `flow-meeting:${m.id}`,
              date: start.toISOString().slice(5, 10).replace('-', '.'),
              isoDate: start.toISOString().slice(0, 10),
              endIsoDate: end.toISOString().slice(0, 10),
              weekday: ['일', '월', '화', '수', '목', '금', '토'][
                start.getUTCDay()
              ],
              time: start.toISOString().slice(11, 16),
              end: end.toISOString().slice(11, 16),
              company: flow.company,
              service:
                m.kind === 'first'
                  ? '초회 동반상담'
                  : m.kind === 'contract'
                    ? '계약상담'
                    : '추가상담',
              method: m.location,
              status: '일정 확정',
              tone: 'blue',
              source: 'partner',
              assignedTrainee: partnerName(flow),
              partnerMemberId: flow.partnerId,
              caseId: flow.caseId,
              shareMode: 'all_with_assignee',
            };
          }),
      ),
    ],
  };
}
