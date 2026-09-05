import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readDocumentReviewWaitSummary,
  type DocumentReviewWaitSummary,
} from '../lib/document-review-wait-metrics';
import {
  readConsultingFlowMetricRows,
  type ConsultingFlowMetricRow,
} from '../lib/consulting-flow-metrics';
import { flowDatabase } from '../lib/consulting-flow-store';
import { newConsultingFlow } from '../lib/consulting-flow';
import { deleteConsultingFlowFixture } from './flow-root-fixture';

const now = '2026-08-10T00:00:00.000Z';

function row(
  caseId: string,
  requests: Array<Record<string, unknown>>,
): ConsultingFlowMetricRow {
  return {
    case_id: caseId,
    first_completed_at: null,
    analysis_report_id: null,
    analysis_admin_at: null,
    analysis_partner_at: null,
    latest_stage1_report_id: null,
    request_metrics_json: JSON.stringify(requests),
  };
}

function buckets(
  summary: DocumentReviewWaitSummary,
  key: 'completedDurationBuckets' | 'pendingAgeBuckets',
) {
  assert.ok(summary[key]);
  return summary[key];
}

void test('document review wait snapshot is exhaustive, operational-only and independently disclosure-gated', async () => {
  const cases = [
    'awaiting',
    ...Array.from({ length: 5 }, (_, index) => `pending-${index}`),
    ...Array.from({ length: 5 }, (_, index) => `completed-${index}`),
    'legacy',
    'invalid',
    'case-1',
  ].map((id) => ({ id }));
  const pendingReceived = [
    '2026-08-09T23:00:00.000Z',
    '2026-08-09T21:00:00.000Z',
    '2026-08-09T14:00:00.000Z',
    '2026-08-08T00:00:00.000Z',
    '2026-08-06T00:00:00.000Z',
  ];
  const completedReviewed = [
    '2026-08-01T01:00:00.000Z',
    '2026-08-01T03:00:00.000Z',
    '2026-08-01T10:00:00.000Z',
    '2026-08-03T00:00:00.000Z',
    '2026-08-05T00:00:00.000Z',
  ];
  const rows = [
    row('awaiting', [{ status: 'requested', hasFile: 0 }]),
    ...pendingReceived.map((receivedAt, index) =>
      row(`pending-${index}`, [{ status: 'received', hasFile: 1, receivedAt }]),
    ),
    ...completedReviewed.map((reviewedAt, index) =>
      row(`completed-${index}`, [
        {
          status: index === 4 ? 'needs_fix' : 'verified',
          hasFile: 1,
          receivedAt: '2026-08-01T00:00:00.000Z',
          reviewedAt,
        },
      ]),
    ),
    row('legacy', [{ status: 'verified', hasFile: 1 }]),
    row('invalid', [
      {
        status: 'verified',
        hasFile: 1,
        receivedAt: '2026-08-02T00:00:00.000Z',
        reviewedAt: '2026-08-01T00:00:00.000Z',
      },
    ]),
    row('case-1', [{ status: 'received', hasFile: 1, receivedAt: now }]),
    row('removed-case', [{ status: 'received', hasFile: 1, receivedAt: now }]),
  ];

  const summary = await readDocumentReviewWaitSummary({ cases }, rows, now);
  assert.deepEqual(
    {
      ...summary,
      completedDurationBuckets: undefined,
      pendingAgeBuckets: undefined,
    },
    {
      requestsCreated: 13,
      awaitingReceipt: 1,
      pendingReview: 5,
      reviewed: 5,
      approvedReviews: 4,
      needsFixReviews: 1,
      legacyUnmeasurable: 1,
      invalidTransitions: 1,
      durationDisclosureThreshold: 5,
      completedDurationBuckets: undefined,
      pendingAgeBuckets: undefined,
    },
  );
  assert.deepEqual(buckets(summary, 'pendingAgeBuckets'), {
    under4Hours: 2,
    fourTo24Hours: 1,
    oneTo3Days: 1,
    threeDaysOrMore: 1,
  });
  assert.deepEqual(buckets(summary, 'completedDurationBuckets'), {
    under4Hours: 2,
    fourTo24Hours: 1,
    oneTo3Days: 1,
    threeDaysOrMore: 1,
  });

  const belowThreshold = await readDocumentReviewWaitSummary(
    { cases },
    rows.filter(
      (item) => item.case_id !== 'pending-4' && item.case_id !== 'completed-4',
    ),
    now,
  );
  assert.equal(belowThreshold.pendingAgeBuckets, null);
  assert.equal(belowThreshold.completedDurationBuckets, null);
});

void test('shared FLOW scan projects only request transition fields for metrics', async () => {
  const db = await flowDatabase();
  await deleteConsultingFlowFixture(db);
  const flow = newConsultingFlow(
    'metric-projection',
    '가상 비공개 기업명',
    'synthetic-partner',
    '가상 파트너',
  );
  flow.requests.push({
    id: 'private-request-id',
    title: '비공개 요청 제목',
    required: true,
    channel: '기타',
    recipient: '비공개 수신자',
    dueDate: '',
    status: 'received',
    fileId: 'private-file-id',
    note: '비공개 메모',
    createdAt: '2026-08-01T00:00:00.000Z',
    receivedAt: '2026-08-02T00:00:00.000Z',
  });
  await db
    .prepare(
      'INSERT INTO consulting_flows (case_id, partner_id, revision, payload, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)',
    )
    .bind(flow.caseId, flow.partnerId, 0, JSON.stringify(flow), now)
    .run();

  const metricRow = (await readConsultingFlowMetricRows())[0];
  assert.match(String(metricRow.request_metrics_json), /receivedAt|hasFile/);
  assert.doesNotMatch(
    String(metricRow.request_metrics_json),
    /private-request-id|private-file-id|비공개 요청 제목|비공개 수신자|비공개 메모/,
  );
});
