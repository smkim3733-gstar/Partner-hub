import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isPipelineDiscontinued,
  protectPipelineLifecycle,
  readPipelineDropoffSummary,
} from '../lib/pipeline-dropoff-metrics';

const submittedAt = '2026-09-01T00:00:00.000Z';

function trackedCase(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    company: `가상 운영기업 ${id}`,
    service: '가상 서비스',
    trainee: '가상 파트너',
    partnerMemberId: 'partner-pipeline',
    stage: '접수',
    consultationCount: 0,
    nextAction: '자료 확인',
    updatedAt: '방금 전',
    idleDays: 0,
    urgent: false,
    submittedAt,
    submissionTrackingVersion: 1,
    ...extra,
  };
}

void test('pipeline lifecycle is server-owned, administrator-only and retry-idempotent', () => {
  let state = protectPipelineLifecycle(
    { cases: [] },
    {
      cases: [
        trackedCase('case-pipeline-new', {
          stage: '계약',
          pipelineLifecycleVersion: 1,
          pipelineLifecycleStatus: 'discontinued',
          pipelineHighestStage: '사후관리',
          pipelineStageSource: 'flow_verified',
          pipelineDiscontinuedAt: '2099-01-01T00:00:00.000Z',
          pipelineDiscontinuedStage: '사후관리',
          pipelineReopenCount: 99,
        }),
      ],
    },
    'partner',
    submittedAt,
  );
  let item = (state.cases as Array<Record<string, unknown>>)[0];
  assert.equal(item.stage, '접수');
  assert.equal(item.pipelineLifecycleStatus, 'active');
  assert.equal(item.pipelineHighestStage, '접수');
  assert.equal(item.pipelineStageSource, 'manual_reported');
  assert.equal(item.pipelineDiscontinuedAt, undefined);
  assert.equal(item.pipelineReopenCount, 0);

  state = protectPipelineLifecycle(
    state,
    { cases: [{ ...item, stage: '계약', pipelineLifecycleStatus: 'discontinued' }] },
    'partner',
    '2026-09-01T01:00:00.000Z',
  );
  item = (state.cases as Array<Record<string, unknown>>)[0];
  assert.equal(item.pipelineLifecycleStatus, 'active');
  assert.equal(item.pipelineHighestStage, '계약');
  assert.equal(item.pipelineStageSource, 'manual_reported');

  state = protectPipelineLifecycle(
    state,
    {
      cases: [
        {
          ...item,
          stage: '상담진행',
          flowManaged: true,
          pipelineLifecycleStatus: 'discontinued',
        },
      ],
    },
    'admin',
    '2026-09-01T02:00:00.000Z',
  );
  item = (state.cases as Array<Record<string, unknown>>)[0];
  assert.equal(item.pipelineLifecycleStatus, 'discontinued');
  assert.equal(item.pipelineHighestStage, '계약');
  assert.equal(item.pipelineStageSource, 'manual_reported');
  assert.equal(item.pipelineDiscontinuedStage, '상담진행');
  assert.equal(item.pipelineDiscontinuedAt, '2026-09-01T02:00:00.000Z');
  assert.equal(isPipelineDiscontinued(state, 'case-pipeline-new'), true);

  state = protectPipelineLifecycle(
    state,
    { cases: [{ ...item, pipelineLifecycleStatus: 'discontinued' }] },
    'admin',
    '2026-09-01T03:00:00.000Z',
  );
  item = (state.cases as Array<Record<string, unknown>>)[0];
  assert.equal(item.pipelineDiscontinuedAt, '2026-09-01T02:00:00.000Z');

  state = protectPipelineLifecycle(
    state,
    {
      cases: [
        {
          ...item,
          stage: '사후관리',
          pipelineLifecycleStatus: 'active',
        },
      ],
    },
    'partner',
    '2026-09-01T04:00:00.000Z',
  );
  item = (state.cases as Array<Record<string, unknown>>)[0];
  assert.equal(item.pipelineLifecycleStatus, 'discontinued');
  assert.equal(item.stage, '상담진행');

  state = protectPipelineLifecycle(
    state,
    { cases: [{ ...item, pipelineLifecycleStatus: 'active' }] },
    'admin',
    '2026-09-01T05:00:00.000Z',
  );
  item = (state.cases as Array<Record<string, unknown>>)[0];
  assert.equal(item.pipelineLifecycleStatus, 'active');
  assert.equal(item.pipelineDiscontinuedAt, undefined);
  assert.equal(item.pipelineDiscontinuedStage, undefined);
  assert.equal(item.pipelineReopenCount, 1);
});

void test('malformed server lifecycle is preserved for administrative recovery', () => {
  const stored = trackedCase('case-pipeline-corrupt', {
    pipelineLifecycleVersion: 1,
    pipelineLifecycleStatus: 'active',
    pipelineHighestStage: '알 수 없음',
    pipelineStageSource: 'manual_reported',
    pipelineReopenCount: 0,
  });
  const state = protectPipelineLifecycle(
    { cases: [stored] },
    {
      cases: [
        {
          ...stored,
          pipelineHighestStage: '사후관리',
          pipelineLifecycleStatus: 'discontinued',
        },
      ],
    },
    'admin',
    '2026-09-01T06:00:00.000Z',
  );
  const item = (state.cases as Array<Record<string, unknown>>)[0];
  assert.equal(item.pipelineHighestStage, '알 수 없음');
  assert.equal(item.pipelineLifecycleStatus, 'active');
  assert.equal(readPipelineDropoffSummary(state).invalidStates, 1);
});

void test('dropoff summary uses ordinal reach and separates FLOW from manual stages', () => {
  const lifecycle = {
    pipelineLifecycleVersion: 1,
    pipelineReopenCount: 0,
  };
  const cases = [
    trackedCase('flow-active', {
      ...lifecycle,
      stage: '계약',
      flowManaged: true,
      pipelineLifecycleStatus: 'active',
      pipelineHighestStage: '상담진행',
      pipelineStageSource: 'flow_verified',
    }),
    trackedCase('flow-closed', {
      ...lifecycle,
      stage: '기업진단',
      flowManaged: true,
      pipelineLifecycleStatus: 'discontinued',
      pipelineHighestStage: '기업진단',
      pipelineStageSource: 'flow_verified',
      pipelineDiscontinuedAt: '2026-09-01T01:00:00.000Z',
      pipelineDiscontinuedStage: '기업진단',
    }),
    trackedCase('manual-closed', {
      ...lifecycle,
      stage: '상담진행',
      pipelineLifecycleStatus: 'discontinued',
      pipelineHighestStage: '상담진행',
      pipelineStageSource: 'manual_reported',
      pipelineDiscontinuedAt: '2026-09-01T01:00:00.000Z',
      pipelineDiscontinuedStage: '상담진행',
      pipelineReopenCount: 1,
    }),
    trackedCase('invalid-closed-flow', {
      ...lifecycle,
      stage: '계약',
      flowManaged: true,
      pipelineLifecycleStatus: 'discontinued',
      pipelineHighestStage: '기업진단',
      pipelineStageSource: 'flow_verified',
      pipelineDiscontinuedAt: '2026-09-01T01:00:00.000Z',
      pipelineDiscontinuedStage: '기업진단',
    }),
    trackedCase('legacy'),
    trackedCase('case-1', {
      ...lifecycle,
      pipelineLifecycleStatus: 'active',
      pipelineHighestStage: '사후관리',
      pipelineStageSource: 'flow_verified',
    }),
  ];
  const summary = readPipelineDropoffSummary({ cases });
  assert.equal(summary.trackedCases, 4);
  assert.equal(summary.activeCases, 1);
  assert.equal(summary.discontinuedCases, 2);
  assert.equal(summary.reopenedCases, 1);
  assert.equal(summary.legacyUnmeasurable, 1);
  assert.equal(summary.invalidStates, 1);
  assert.equal(summary.flowVerified.cases, 2);
  assert.equal(summary.manualReported.cases, 1);
  assert.deepEqual(summary.flowVerified.stages.slice(0, 5), [
    { stage: '접수', reached: 2, discontinued: 0, discontinuationRatePercent: 0 },
    { stage: '기업진단', reached: 2, discontinued: 1, discontinuationRatePercent: 50 },
    { stage: '상담예약', reached: 1, discontinued: 0, discontinuationRatePercent: 0 },
    { stage: '상담진행', reached: 1, discontinued: 0, discontinuationRatePercent: 0 },
    { stage: '계약', reached: 1, discontinued: 0, discontinuationRatePercent: 0 },
  ]);
  assert.equal(summary.manualReported.stages[3].discontinued, 1);
  assert.equal(summary.observationStatus, 'observed');
  assert.doesNotMatch(JSON.stringify(summary), /flow-active|가상 운영기업|partner-pipeline/);
});
