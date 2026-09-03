import {
  isPilotSeedId,
  pilotDiagnosisReviewTaskId,
} from './pilot-readiness';

type DiagnosisAssessmentRecord = {
  id: string;
  caseId: string;
  company: string;
  identityStatus: string;
  hasConsultationEvidence: boolean;
  privacyMasked: boolean;
  personalDataConsent: boolean;
  thirdPartyAiConsent: boolean;
  transcriptConsent: boolean;
  level: string;
  status: string;
  updatedAt: string;
};

type DiagnosisCaseRecord = {
  id: string;
  company: string;
};

type DiagnosisTaskRecord = {
  id?: string;
  caseId?: string;
  related?: string;
  status?: string;
};

type DiagnosisTimelineRecord = {
  id?: string;
  caseId?: string;
  title?: string;
};

export type DiagnosisReviewQueueDraft = {
  assessmentId: string;
  caseId: string;
  company: string;
  expectedEvidence: string;
  taskId: string;
};

function evidenceSignature(assessment: DiagnosisAssessmentRecord) {
  return JSON.stringify([
    assessment.identityStatus,
    assessment.hasConsultationEvidence,
    assessment.privacyMasked,
    assessment.personalDataConsent,
    assessment.thirdPartyAiConsent,
    assessment.transcriptConsent,
  ]);
}

function diagnosisCase(
  assessment: DiagnosisAssessmentRecord,
  cases: DiagnosisCaseRecord[],
) {
  if (!isPilotSeedId('diagnosis', assessment.id))
    throw new Error('가상 사전점검 대상을 다시 확인해 주세요.');
  if (!isPilotSeedId('case', assessment.caseId))
    throw new Error('가상 진행 연결을 다시 확인해 주세요.');
  const matches = cases.filter((item) => item.id === assessment.caseId);
  if (matches.length !== 1 || matches[0]?.company !== assessment.company)
    throw new Error('가상 기업과 진행 연결이 변경되었습니다. 최신 화면에서 다시 확인해 주세요.');
  if (!assessment.company.includes('(가상)'))
    throw new Error('이 화면에서는 가상 기업만 검토대기에 등록할 수 있습니다.');
  return matches[0];
}

function assertQueueAvailable(
  assessment: DiagnosisAssessmentRecord,
  tasks: DiagnosisTaskRecord[],
) {
  const taskId = pilotDiagnosisReviewTaskId(assessment.id);
  if (!taskId) throw new Error('가상 검토업무 ID를 확인하지 못했습니다.');
  if (
    tasks.some(
      (task) =>
        task.id === taskId ||
        (task.caseId === assessment.caseId &&
          task.related === 'AI 진단 사전점검' &&
          task.status !== '완료'),
    )
  )
    throw new Error('이미 이 진행의 1차 초안 검토업무가 열려 있습니다.');
  return taskId;
}

export function createDiagnosisReviewQueueDraft(
  assessment: DiagnosisAssessmentRecord,
  cases: DiagnosisCaseRecord[],
  tasks: DiagnosisTaskRecord[],
  isAdmin: boolean,
): DiagnosisReviewQueueDraft {
  if (!isAdmin)
    throw new Error('대표 관리자만 가상 검토대기에 등록할 수 있습니다.');
  diagnosisCase(assessment, cases);
  if (assessment.level !== 'A')
    throw new Error('최신 사전판정이 A인 가상 기업만 등록할 수 있습니다.');
  return {
    assessmentId: assessment.id,
    caseId: assessment.caseId,
    company: assessment.company,
    expectedEvidence: evidenceSignature(assessment),
    taskId: assertQueueAvailable(assessment, tasks),
  };
}

export function applyDiagnosisReviewQueueDraft<
  T extends DiagnosisAssessmentRecord,
  TTask extends DiagnosisTaskRecord,
  TTimeline extends DiagnosisTimelineRecord,
>(
  assessment: T,
  draft: DiagnosisReviewQueueDraft,
  cases: DiagnosisCaseRecord[],
  tasks: TTask[],
  timeline: TTimeline[],
  isAdmin: boolean,
) {
  if (!isAdmin)
    throw new Error('현재 계정의 관리자 권한을 다시 확인해 주세요.');
  if (
    assessment.id !== draft.assessmentId ||
    assessment.caseId !== draft.caseId ||
    assessment.company !== draft.company
  )
    throw new Error('검토대기에 등록할 가상 기업을 다시 확인해 주세요.');
  diagnosisCase(assessment, cases);
  if (
    assessment.level !== 'A' ||
    evidenceSignature(assessment) !== draft.expectedEvidence
  )
    throw new Error('사전판정 근거가 변경되었습니다. 최신 판정을 다시 확인해 주세요.');
  const taskId = assertQueueAvailable(assessment, tasks);
  if (taskId !== draft.taskId)
    throw new Error('검토업무 연결을 다시 확인해 주세요.');
  const timelineId = `diagnosis-review-${assessment.id}`;
  const stableTimelineMatches = timeline.filter((item) => item.id === timelineId);
  if (
    stableTimelineMatches.length > 1 ||
    stableTimelineMatches.some((item) =>
      item.caseId !== assessment.caseId ||
      item.title !== 'AI 1차 진단 초안 검토대기'
    )
  )
    throw new Error('가상 검토대기 타임라인 식별자가 충돌합니다. 진행 기록을 확인해 주세요.');
  const timelineExists = stableTimelineMatches.length === 1 || timeline.some(
    (item) =>
      !item.id &&
      item.caseId === assessment.caseId &&
      item.title === 'AI 1차 진단 초안 검토대기',
  );
  const task = {
    id: taskId,
    caseId: assessment.caseId,
    company: assessment.company,
    title: '1차 정밀진단 초안 생성 전 근거·동의 검토',
    kind: '내부업무' as const,
    assignee: '김성민 대표',
    partnerMemberId: '',
    due: '오늘',
    dueState: 'today' as const,
    status: '대기' as const,
    priority: '보통' as const,
    related: 'AI 진단 사전점검',
  };
  const createdTimeline = timelineExists
    ? null
    : {
        id: timelineId,
        caseId: assessment.caseId,
        date: '방금 전',
        title: 'AI 1차 진단 초안 검토대기',
        detail:
          '가상 사전점검 A 통과 / 실제 AI 전송 없음 / 김성민 대표 승인 대기',
        type: '기업진단',
        tone: 'blue',
      };
  return {
    assessment: {
      ...assessment,
      status: '대표 검토 대기',
      updatedAt: '방금 전 · 대기열 등록',
    },
    task,
    tasks: [task, ...tasks],
    createdTimeline,
    timeline: createdTimeline ? [...timeline, createdTimeline] : timeline,
  };
}
