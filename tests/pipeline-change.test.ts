import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyPipelineLifecycleChangeDraft,
  applyPipelineStageChangeDraft,
  createPipelineLifecycleChangeDraft,
  createPipelineStageChangeDraft,
  PIPELINE_STAGE_NEXT_ACTIONS,
} from '../lib/pipeline-change';

function manualCase() {
  return {
    id: 'manual-pipeline-case',
    company: '가상 수동진행기업',
    stage: '기업진단' as const,
    nextAction: '기존 다음 행동',
    updatedAt: '어제',
    idleDays: 8,
    urgent: true,
    pipelineLifecycleVersion: 1 as const,
    pipelineLifecycleStatus: 'active' as const,
  };
}

void test('manual stage selection remains a draft until explicit apply', () => {
  const record = manualCase();
  const original = structuredClone(record);
  const draft = createPipelineStageChangeDraft(record, '상담예약');
  assert.deepEqual(record, original);
  assert.deepEqual(draft, {
    caseId: record.id,
    expectedStage: '기업진단',
    nextStage: '상담예약',
  });
  const changed = applyPipelineStageChangeDraft(record, draft);
  assert.equal(changed.stage, '상담예약');
  assert.equal(changed.nextAction, PIPELINE_STAGE_NEXT_ACTIONS.상담예약);
  assert.equal(changed.updatedAt, '방금 전');
  assert.equal(changed.idleDays, 0);
  assert.equal(changed.urgent, false);
  assert.deepEqual(record, original);
});

void test('manual stage apply rejects stale, closed, FLOW-managed and invalid changes', () => {
  const record = manualCase();
  const draft = createPipelineStageChangeDraft(record, '상담진행');
  assert.throws(() => createPipelineStageChangeDraft(record, record.stage), /현재 진행단계/);
  assert.throws(() => createPipelineStageChangeDraft(record, '임의단계'), /다시 선택/);
  assert.throws(() => createPipelineStageChangeDraft({ ...record, stage: '임의단계' as never }, '상담진행'), /현재 진행단계/);
  assert.throws(() => createPipelineStageChangeDraft({ ...record, flowManaged: true }, '상담진행'), /FLOW가 관리/);
  assert.throws(() => createPipelineStageChangeDraft({ ...record, pipelineLifecycleStatus: 'discontinued' }, '상담진행'), /다시 연 뒤/);
  assert.throws(() => applyPipelineStageChangeDraft({ ...record, stage: '접수' }, draft), /진행단계가 변경/);
  assert.throws(() => applyPipelineStageChangeDraft(record, { ...draft, caseId: 'other-case' }), /진행을 다시 확인/);
});

void test('lifecycle selection remains a draft and changes only after explicit apply', () => {
  const record = manualCase();
  const original = structuredClone(record);
  const stopDraft = createPipelineLifecycleChangeDraft(record);
  assert.deepEqual(record, original);
  assert.deepEqual(stopDraft, {
    caseId: record.id,
    expectedStage: record.stage,
    expectedStatus: 'active',
    nextStatus: 'discontinued',
  });
  const stopped = applyPipelineLifecycleChangeDraft(record, stopDraft);
  assert.equal(stopped.pipelineLifecycleStatus, 'discontinued');
  assert.equal(stopped.stage, record.stage);
  assert.deepEqual(record, original);

  const reopenDraft = createPipelineLifecycleChangeDraft(stopped);
  const reopened = applyPipelineLifecycleChangeDraft(stopped, reopenDraft);
  assert.equal(reopened.pipelineLifecycleStatus, 'active');
  assert.equal(reopened.stage, record.stage);
});

void test('lifecycle apply rejects malformed and stale stage or status', () => {
  const record = manualCase();
  const draft = createPipelineLifecycleChangeDraft(record);
  assert.throws(() => createPipelineLifecycleChangeDraft({ ...record, pipelineLifecycleVersion: undefined }), /중단 상태/);
  assert.throws(() => createPipelineLifecycleChangeDraft({ ...record, pipelineLifecycleStatus: undefined }), /중단 상태/);
  assert.throws(() => applyPipelineLifecycleChangeDraft({ ...record, stage: '계약' }, draft), /진행 상태가 변경/);
  assert.throws(() => applyPipelineLifecycleChangeDraft({ ...record, pipelineLifecycleStatus: 'discontinued' }, draft), /진행 상태가 변경/);
  assert.throws(() => applyPipelineLifecycleChangeDraft(record, { ...draft, caseId: 'other-case' }), /진행을 다시 확인/);
  assert.throws(() => applyPipelineLifecycleChangeDraft(record, { ...draft, nextStatus: 'active' }), /변경할 진행 상태/);
});
