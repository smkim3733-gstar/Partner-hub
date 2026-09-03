import {
  PIPELINE_STAGES,
  type PipelineStage,
} from './pipeline-dropoff-metrics';

export const PIPELINE_STAGE_NEXT_ACTIONS: Record<PipelineStage, string> = {
  접수: '담당자 배정 및 기본자료 확인',
  기업진단: '기업진단보고서 준비',
  상담예약: '김성민 대표 상담일 확정',
  상담진행: '다음 상담·서류·견적 판단',
  계약: '경영자문용역계약 조건 확정',
  컨설팅수행: '확정 솔루션 수행 및 결과 확인',
  사후관리: '정기점검 및 추가 제안',
};

type ManualPipelineRecord = {
  id: string;
  stage: PipelineStage;
  nextAction: string;
  updatedAt: string;
  idleDays: number;
  urgent: boolean;
  flowManaged?: boolean;
  pipelineLifecycleStatus?: 'active' | 'discontinued';
};

type TrackedPipelineRecord = {
  id: string;
  stage: PipelineStage;
  pipelineLifecycleVersion?: 1;
  pipelineLifecycleStatus?: 'active' | 'discontinued';
};

export type PipelineStageChangeDraft = {
  caseId: string;
  expectedStage: PipelineStage;
  nextStage: PipelineStage;
};

export type PipelineLifecycleChangeDraft = {
  caseId: string;
  expectedStage: PipelineStage;
  expectedStatus: 'active' | 'discontinued';
  nextStatus: 'active' | 'discontinued';
};

function isPipelineStage(value: unknown): value is PipelineStage {
  return PIPELINE_STAGES.includes(value as PipelineStage);
}

export function createPipelineStageChangeDraft(
  record: ManualPipelineRecord,
  nextStage: string,
): PipelineStageChangeDraft {
  if (!isPipelineStage(record.stage))
    throw new Error('현재 진행단계를 다시 확인해 주세요.');
  if (record.flowManaged)
    throw new Error('상담 FLOW가 관리하는 진행단계는 직접 바꿀 수 없습니다.');
  if (record.pipelineLifecycleStatus === 'discontinued')
    throw new Error('진행을 다시 연 뒤 단계를 변경해 주세요.');
  if (!isPipelineStage(nextStage))
    throw new Error('변경할 진행단계를 다시 선택해 주세요.');
  if (record.stage === nextStage)
    throw new Error('이미 현재 진행단계입니다.');
  return {
    caseId: record.id,
    expectedStage: record.stage,
    nextStage,
  };
}

export function applyPipelineStageChangeDraft<T extends ManualPipelineRecord>(
  record: T,
  draft: PipelineStageChangeDraft,
): T {
  if (record.id !== draft.caseId)
    throw new Error('단계를 변경할 진행을 다시 확인해 주세요.');
  if (record.flowManaged)
    throw new Error('상담 FLOW가 관리하는 진행단계는 직접 바꿀 수 없습니다.');
  if (record.pipelineLifecycleStatus === 'discontinued')
    throw new Error('진행을 다시 연 뒤 단계를 변경해 주세요.');
  if (!isPipelineStage(record.stage))
    throw new Error('현재 진행단계를 다시 확인해 주세요.');
  if (record.stage !== draft.expectedStage)
    throw new Error('진행단계가 변경되었습니다. 최신 화면에서 다시 선택해 주세요.');
  if (!isPipelineStage(draft.nextStage))
    throw new Error('변경할 진행단계를 다시 선택해 주세요.');
  return {
    ...record,
    stage: draft.nextStage,
    nextAction: PIPELINE_STAGE_NEXT_ACTIONS[draft.nextStage],
    updatedAt: '방금 전',
    idleDays: 0,
    urgent: false,
  };
}

export function createPipelineLifecycleChangeDraft(
  record: TrackedPipelineRecord,
): PipelineLifecycleChangeDraft {
  if (
    record.pipelineLifecycleVersion !== 1 ||
    (record.pipelineLifecycleStatus !== 'active' &&
      record.pipelineLifecycleStatus !== 'discontinued')
  )
    throw new Error('진행 중단 상태를 다시 확인해 주세요.');
  if (!isPipelineStage(record.stage))
    throw new Error('현재 진행단계를 다시 확인해 주세요.');
  return {
    caseId: record.id,
    expectedStage: record.stage,
    expectedStatus: record.pipelineLifecycleStatus,
    nextStatus:
      record.pipelineLifecycleStatus === 'discontinued'
        ? 'active'
        : 'discontinued',
  };
}

export function applyPipelineLifecycleChangeDraft<T extends TrackedPipelineRecord>(
  record: T,
  draft: PipelineLifecycleChangeDraft,
): T {
  if (record.id !== draft.caseId)
    throw new Error('상태를 변경할 진행을 다시 확인해 주세요.');
  if (
    record.pipelineLifecycleVersion !== 1 ||
    record.pipelineLifecycleStatus !== draft.expectedStatus ||
    record.stage !== draft.expectedStage
  )
    throw new Error('진행 상태가 변경되었습니다. 최신 화면에서 다시 확인해 주세요.');
  if (
    draft.nextStatus === draft.expectedStatus ||
    (draft.nextStatus !== 'active' && draft.nextStatus !== 'discontinued')
  )
    throw new Error('변경할 진행 상태를 다시 확인해 주세요.');
  return {
    ...record,
    pipelineLifecycleStatus: draft.nextStatus,
  };
}
