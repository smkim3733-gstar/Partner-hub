import test from 'node:test';
import assert from 'node:assert/strict';

import { flowDatabase } from '../lib/consulting-flow-store';
import {
  newConsultingFlow,
  type ConsultingFlow,
  type FlowReport,
} from '../lib/consulting-flow';
import { readConsultingFlowMetricRows } from '../lib/consulting-flow-metrics';
import { readJointAnalysisConfirmationSummary } from '../lib/joint-analysis-confirmation-metrics';

const partnerAt = '2026-08-01T00:00:00.000Z';

function report(id: string, version: number): FlowReport {
  return {
    id,
    stage: 1,
    version,
    title: '가상 1차 보고서',
    body: '가상 공동분석 확인 지표를 검증하는 본문입니다. '.repeat(4),
    createdAt: '2026-07-31T00:00:00.000Z',
    createdBy: 'synthetic-admin',
    origin: 'manual',
  };
}

async function insertFlow(
  caseId: string,
  analysis: ConsultingFlow['analysis'],
  mismatch = false,
) {
  const flow = newConsultingFlow(
    caseId,
    '가상 공동분석기업',
    'synthetic-partner',
    '가상 파트너',
  );
  const old = report(`${caseId}-old`, 99);
  const latest = report(`${caseId}-latest`, 1);
  flow.reports = [old, latest];
  flow.analysis = mismatch ? { ...analysis, reportId: old.id } : { ...analysis, reportId: latest.id };
  flow.revision = 1;
  flow.updatedAt = '2026-08-10T00:00:00.000Z';
  await (
    await flowDatabase()
  )
    .prepare(
      'INSERT INTO consulting_flows (case_id, partner_id, revision, payload, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)',
    )
    .bind(
      caseId,
      flow.partnerId,
      flow.revision,
      JSON.stringify(flow),
      flow.updatedAt,
    )
    .run();
}

void test('joint-analysis snapshot is exhaustive, operational-only and uses latest report array order', async () => {
  const db = await flowDatabase();
  await db.prepare('DELETE FROM consulting_flows').run();
  const cases = [
    'awaiting-both',
    'partner-pending',
    'owner-pending',
    'partner-complete-a',
    'partner-complete-b',
    'partner-complete-c',
    'partner-complete-d',
    'partner-complete-e',
    'owner-complete',
    'invalid-time',
    'report-mismatch',
    'case-1',
  ].map((id) => ({ id }));

  await insertFlow('awaiting-both', { reportId: '' });
  await insertFlow('partner-pending', { reportId: '', partnerAt });
  await insertFlow('owner-pending', {
    reportId: '',
    adminAt: '2026-08-01T00:30:00.000Z',
  });
  for (const [id, adminAt] of [
    ['partner-complete-a', '2026-08-01T01:00:00.000Z'],
    ['partner-complete-b', '2026-08-01T03:00:00.000Z'],
    ['partner-complete-c', '2026-08-01T10:00:00.000Z'],
    ['partner-complete-d', '2026-08-02T12:00:00.000Z'],
    ['partner-complete-e', '2026-08-05T00:00:00.000Z'],
  ] as const)
    await insertFlow(id, { reportId: '', partnerAt, adminAt });
  await insertFlow('owner-complete', {
    reportId: '',
    adminAt: '2026-08-01T00:00:00.000Z',
    partnerAt: '2026-08-01T01:00:00.000Z',
  });
  await insertFlow('invalid-time', {
    reportId: '',
    partnerAt: 'not-an-iso-time',
  });
  await insertFlow('report-mismatch', { reportId: '', partnerAt }, true);
  await insertFlow('case-1', { reportId: '', partnerAt });
  await insertFlow('removed-case', { reportId: '', partnerAt });

  const rows = await readConsultingFlowMetricRows();
  assert.equal(
    rows.find((row) => row.case_id === 'partner-pending')
      ?.latest_stage1_report_id,
    'partner-pending-latest',
  );
  assert.deepEqual(
    await readJointAnalysisConfirmationSummary({ cases }, rows),
    {
      flowsWithFirstReport: 11,
      eligibleJointAnalyses: 10,
      currentReportMismatches: 1,
      awaitingBoth: 1,
      partnerFirstPending: 1,
      ownerFirstPending: 1,
      partnerFirstCompleted: 5,
      ownerFirstCompleted: 1,
      invalidTimestamps: 1,
      durationDisclosureThreshold: 5,
      durationBuckets: {
        under4Hours: 2,
        fourTo24Hours: 1,
        oneTo3Days: 1,
        threeDaysOrMore: 1,
      },
    },
  );

  await db
    .prepare("DELETE FROM consulting_flows WHERE case_id = 'partner-complete-b'")
    .run();
  const belowThreshold = await readJointAnalysisConfirmationSummary({ cases });
  assert.equal(belowThreshold.partnerFirstCompleted, 4);
  assert.equal(belowThreshold.durationBuckets, null);
  assert.doesNotMatch(JSON.stringify(belowThreshold), /가상 공동분석기업|synthetic/);
});
