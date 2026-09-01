import test from 'node:test';
import assert from 'node:assert/strict';

import {
  protectApplicationSubmissionTimes,
  readApplicationConsultationSummary,
} from '../lib/application-consultation-metrics';
import { flowDatabase } from '../lib/consulting-flow-store';
import {
  newConsultingFlow,
  type ConsultingFlow,
  type FlowMeeting,
} from '../lib/consulting-flow';

const submittedAt = '2026-08-01T00:00:00.000Z';

void test('submission tracking fields are server-owned and retries preserve the first stamp', () => {
  const current = {
    cases: [
      {
        id: 'case-draft-existing',
        submittedAt,
        submissionTrackingVersion: 1,
      },
      { id: 'case-existing-untracked' },
    ],
  };
  const next = {
    members: [],
    cases: [
      {
        id: 'case-draft-existing',
        submittedAt: '2099-01-01T00:00:00.000Z',
        submissionTrackingVersion: 99,
      },
      {
        id: 'case-existing-untracked',
        submittedAt: submittedAt,
        submissionTrackingVersion: 1,
      },
      {
        id: 'case-draft-authorized',
        submittedAt: '2099-01-01T00:00:00.000Z',
        submissionTrackingVersion: 99,
      },
      {
        id: 'arbitrary-new-case',
        submittedAt,
        submissionTrackingVersion: 1,
      },
    ],
  };
  const protectedState = protectApplicationSubmissionTimes(
    current,
    next,
    'case-draft-authorized',
    '2026-08-02T03:04:05.000Z',
  );
  const cases = protectedState.cases as Array<Record<string, unknown>>;

  assert.deepEqual(cases[0], {
    id: 'case-draft-existing',
    submittedAt,
    submissionTrackingVersion: 1,
  });
  assert.deepEqual(cases[1], { id: 'case-existing-untracked' });
  assert.deepEqual(cases[2], {
    id: 'case-draft-authorized',
    submittedAt: '2026-08-02T03:04:05.000Z',
    submissionTrackingVersion: 1,
  });
  assert.deepEqual(cases[3], { id: 'arbitrary-new-case' });
  assert.deepEqual(protectedState.members, []);
  assert.throws(
    () =>
      protectApplicationSubmissionTimes(
        current,
        next,
        'case-draft-authorized',
        'not-an-iso-time',
      ),
    /timestamp/,
  );
});

function firstMeeting(completedAt?: string): FlowMeeting {
  return {
    id: `meeting-${completedAt ?? 'pending'}`,
    kind: 'first',
    startsAt: '2026-08-01T01:00:00.000Z',
    endsAt: '2026-08-01T02:00:00.000Z',
    location: '가상 회의실',
    attendance: 'both',
    status: completedAt ? 'completed' : 'scheduled',
    note: '',
    createdBy: 'synthetic-admin',
    ...(completedAt ? { completedAt } : {}),
  };
}

async function insertFlow(caseId: string, meeting: FlowMeeting) {
  const flow: ConsultingFlow = newConsultingFlow(
    caseId,
    '가상 지표기업',
    'synthetic-partner',
    '가상 파트너',
  );
  flow.revision = 1;
  flow.updatedAt = '2026-08-10T00:00:00.000Z';
  flow.meetings = [meeting];
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

void test('funnel summary excludes seed and legacy records, separates FLOW denominator, and suppresses small duration groups', async () => {
  const db = await flowDatabase();
  await db.prepare('DELETE FROM consulting_flows').run();
  const tracked = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    submittedAt,
    submissionTrackingVersion: 1,
    ...extra,
  });
  const cases = [
    tracked('case-1'),
    { id: 'untracked-case', consultationCount: 9 },
    tracked('tracked-no-flow'),
    tracked('tracked-legacy', { consultationCount: 1, stage: '상담진행' }),
    tracked('tracked-pending'),
    tracked('tracked-under-a'),
    tracked('tracked-under-b'),
    tracked('tracked-one-three'),
    tracked('tracked-three-seven'),
    tracked('tracked-seven-plus'),
    tracked('tracked-invalid'),
  ];

  await insertFlow('tracked-pending', firstMeeting());
  await insertFlow('tracked-under-a', firstMeeting('2026-08-01T12:00:00.000Z'));
  await insertFlow('tracked-under-b', firstMeeting('2026-08-01T23:59:59.000Z'));
  await insertFlow(
    'tracked-one-three',
    firstMeeting('2026-08-03T00:00:00.000Z'),
  );
  await insertFlow(
    'tracked-three-seven',
    firstMeeting('2026-08-06T00:00:00.000Z'),
  );
  await insertFlow(
    'tracked-seven-plus',
    firstMeeting('2026-08-08T00:00:00.000Z'),
  );
  await insertFlow('tracked-invalid', firstMeeting('2026-07-31T23:59:59.000Z'));

  const summary = await readApplicationConsultationSummary({ cases });
  assert.deepEqual(summary, {
    trackedApplications: 9,
    flowStarted: 7,
    firstConsultationsCompleted: 6,
    flowPending: 1,
    legacyConsultationsUnmeasurable: 1,
    flowNotStarted: 1,
    invalidCompletionTimes: 1,
    completionRatePercent: 85.7,
    durationDisclosureThreshold: 5,
    durationBuckets: {
      under1Day: 2,
      oneTo3Days: 1,
      threeTo7Days: 1,
      sevenDaysOrMore: 1,
    },
  });
  assert.doesNotMatch(JSON.stringify(summary), /가상 지표기업|tracked-/);

  await db
    .prepare("DELETE FROM consulting_flows WHERE case_id = 'tracked-under-b'")
    .run();
  const belowThreshold = await readApplicationConsultationSummary({ cases });
  assert.equal(belowThreshold.firstConsultationsCompleted, 5);
  assert.equal(belowThreshold.durationBuckets, null);
});
