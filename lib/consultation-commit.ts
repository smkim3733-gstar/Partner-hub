import {
  prepareConsultation,
  type ConsultationPayload,
} from './legacy-consultation';
import {
  PIPELINE_STAGE_NEXT_ACTIONS,
} from './pipeline-change';
import {
  PIPELINE_STAGES,
  type PipelineStage,
} from './pipeline-dropoff-metrics';

type CaseRecord = {
  id: string;
  company: string;
  service: string;
  trainee: string;
  partnerMemberId?: string;
  flowManaged?: boolean;
  pipelineLifecycleStatus?: 'active' | 'discontinued';
  pipelineHighestStage?: PipelineStage;
  stage: PipelineStage;
  consultationCount: number;
  nextAction: string;
  updatedAt: string;
  idleDays: number;
};

type TimelineRecord = {
  id?: string;
  caseId?: string;
  date: string;
  title: string;
  detail: string;
  type: string;
  tone: string;
};

type ScheduleRecord = { id: string };
type TaskRecord = { id: string };

export type ConsultationCommitInput = {
  requestId: string;
  expectedCase: string;
  expectedNumber: number;
  payload: ConsultationPayload;
};

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function consultationCaseFingerprint(caseItem: Pick<CaseRecord,
  | 'id'
  | 'company'
  | 'service'
  | 'trainee'
  | 'partnerMemberId'
  | 'flowManaged'
  | 'pipelineLifecycleStatus'
  | 'pipelineHighestStage'
  | 'stage'
  | 'consultationCount'
>) {
  return JSON.stringify([
    caseItem.id,
    caseItem.company,
    caseItem.service,
    caseItem.trainee,
    caseItem.partnerMemberId ?? null,
    caseItem.flowManaged ?? false,
    caseItem.pipelineLifecycleStatus ?? 'active',
    caseItem.pipelineHighestStage ?? null,
    caseItem.stage,
    caseItem.consultationCount,
  ]);
}

function payloadSignature(payload: ConsultationPayload) {
  return JSON.stringify([
    payload.title,
    payload.startsAt,
    payload.method,
    payload.status,
    payload.addToSchedule,
    payload.shareMode,
    payload.followUps,
  ]);
}

function assertCurrentCase<TCase extends CaseRecord>(
  selected: TCase,
  expectedCase: string,
  cases: TCase[],
) {
  if (selected.flowManaged)
    throw new Error('FLOW가 관리하는 진행은 상담 FLOW에서 기록해 주세요.');
  if (selected.pipelineLifecycleStatus === 'discontinued')
    throw new Error('중단된 진행을 다시 연 뒤 상담을 기록해 주세요.');
  if (!PIPELINE_STAGES.includes(selected.stage))
    throw new Error('현재 진행단계를 다시 확인해 주세요.');
  if (consultationCaseFingerprint(selected) !== expectedCase)
    throw new Error('상담 작성 중 진행 정보가 변경되었습니다. 최신 화면에서 다시 작성해 주세요.');
  const matches = cases.filter((item) => item.id === selected.id);
  if (
    matches.length !== 1 ||
    consultationCaseFingerprint(matches[0]) !== expectedCase
  )
    throw new Error('현재 상담 진행 연결을 다시 확인해 주세요.');
}

function nextCaseState<TCase extends CaseRecord>(
  selected: TCase,
  payload: ConsultationPayload,
): TCase {
  if (payload.status === '취소') return selected;
  const requestedStage: PipelineStage = payload.status === '일정 요청' || payload.status === '일정 확정'
    ? '상담예약'
    : '상담진행';
  const currentIndex = PIPELINE_STAGES.indexOf(selected.stage);
  const requestedIndex = PIPELINE_STAGES.indexOf(requestedStage);
  const nextStage = currentIndex >= requestedIndex ? selected.stage : requestedStage;
  const nextAction = payload.followUps.length
    ? payload.followUps.join(' · ')
    : currentIndex > requestedIndex
      ? selected.nextAction
      : PIPELINE_STAGE_NEXT_ACTIONS[requestedStage];
  return {
    ...selected,
    stage: nextStage,
    consultationCount: payload.status === '상담 완료'
      ? selected.consultationCount + 1
      : selected.consultationCount,
    nextAction,
    updatedAt: '방금 전',
    idleDays: 0,
  };
}

export function commitConsultation<
  TCase extends CaseRecord,
  TTimeline extends TimelineRecord,
  TSchedule extends ScheduleRecord,
  TTask extends TaskRecord,
>(
  selected: TCase,
  input: ConsultationCommitInput,
  consultationNumber: number,
  timeline: TTimeline[],
  schedule: TSchedule[],
  tasks: TTask[],
  cases: TCase[],
  canEdit: boolean,
) {
  if (!canEdit)
    throw new Error('현재 계정의 상담 기록 권한을 다시 확인해 주세요.');
  if (!requestIdPattern.test(input.requestId))
    throw new Error('상담 저장 식별자를 다시 만들어 주세요.');
  if (!Number.isSafeInteger(consultationNumber) || consultationNumber < 0)
    throw new Error('현재 상담번호를 다시 확인해 주세요.');
  const number = Math.max(1, consultationNumber);
  if (!Number.isSafeInteger(input.expectedNumber) || input.expectedNumber !== number)
    throw new Error('상담번호가 변경되었습니다. 최신 화면에서 다시 확인해 주세요.');
  assertCurrentCase(selected, input.expectedCase, cases);

  const prepared = prepareConsultation(input.payload);
  if (!prepared.ok) throw new Error(prepared.error);
  if (payloadSignature(prepared.payload) !== payloadSignature(input.payload))
    throw new Error('상담 내용이나 저장 영향이 변경되었습니다. 입력을 다시 확인해 주세요.');

  const timelineId = `consultation-${input.requestId}`;
  const scheduleId = `schedule-consultation-${input.requestId}`;
  const taskIdPrefix = `task-consultation-${input.requestId}-`;
  const taskIds = prepared.payload.followUps.map((_, index) => `${taskIdPrefix}${index}`);
  if (
    timeline.some((item) => item.id === timelineId) ||
    schedule.some((item) => item.id === scheduleId) ||
    tasks.some((item) => item.id.startsWith(taskIdPrefix))
  )
    throw new Error('이미 같은 상담이 등록되었습니다. 진행 기록을 확인해 주세요.');

  const createdTimeline = {
    id: timelineId,
    caseId: selected.id,
    date: '방금 전',
    title: `상담 #${number} 저장`,
    detail: prepared.detail,
    type: '상담',
    tone: 'green',
  };
  const createdSchedule = prepared.schedule
    ? {
        id: scheduleId,
        ...prepared.schedule,
        caseId: selected.id,
        partnerMemberId: selected.partnerMemberId,
        company: selected.company,
        service: prepared.payload.title,
        method: prepared.payload.method,
        status: '확정',
        tone: 'green',
        source: 'partner' as const,
        assignedTrainee: selected.trainee,
        shareMode: prepared.payload.shareMode,
      }
    : null;
  const kindMap = {
    '다음 상담 등록': '상담',
    '서류요청': '서류요청',
    '견적서 작성': '견적서',
    '계약서 작성': '계약서',
    '내부업무 등록': '내부업무',
  } as const;
  const createdTasks = prepared.payload.followUps.map((followUp, index) => ({
    id: taskIds[index],
    company: selected.company,
    title: `상담 후 ${followUp}`,
    kind: kindMap[followUp as keyof typeof kindMap],
    assignee: selected.trainee,
    partnerMemberId: selected.partnerMemberId,
    caseId: selected.id,
    due: '기한 확인',
    dueState: 'upcoming' as const,
    status: '대기' as const,
    priority: '보통' as const,
    related: `상담 #${number}`,
  }));

  return {
    consultationNumber: number + 1,
    timeline: [...timeline, createdTimeline],
    schedule: createdSchedule ? [...schedule, createdSchedule] : schedule,
    tasks: [...createdTasks, ...tasks],
    cases: cases.map((item) => item.id === selected.id
      ? nextCaseState(item, prepared.payload)
      : item),
    number,
    scheduleAdded: Boolean(createdSchedule),
    taskCount: createdTasks.length,
  };
}
