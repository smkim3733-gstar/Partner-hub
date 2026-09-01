import test from 'node:test';
import assert from 'node:assert/strict';

import {
  protectSupportRequestTracking,
  readSupportRequestSummary,
  SUPPORT_REQUEST_COMPANY,
} from '../lib/support-request-metrics';

const openedAt = '2026-08-01T00:00:00.000Z';
const now = '2026-08-10T00:00:00.000Z';

function supportTask(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    company: '클라이언트 입력 회사',
    title: `가상 지원 요청 ${id}`,
    kind: '지원요청',
    assignee: '가상 요청자',
    partnerMemberId: 'partner-support',
    due: '미정',
    dueState: 'upcoming',
    status: '대기',
    priority: '보통',
    related: '직접 등록',
    supportCategory: 'account_access',
    ...extra,
  };
}

void test('server protects support category, actor, timestamps and latest reopen cycle', () => {
  const forged = supportTask('support-new', {
    status: '완료',
    supportOpenedAt: '2099-01-01T00:00:00.000Z',
    supportResolvedAt: '2099-01-01T00:00:00.000Z',
    supportResolvedByRole: 'admin',
    supportCycle: 99,
  });
  let state = protectSupportRequestTracking(
    { tasks: [] },
    { tasks: [forged] },
    'partner',
    openedAt,
  );
  let task = (state.tasks as Array<Record<string, unknown>>)[0];
  assert.equal(task.company, SUPPORT_REQUEST_COMPANY);
  assert.equal(task.status, '대기');
  assert.equal(task.supportOpenedAt, openedAt);
  assert.equal(task.supportOrigin, 'partner_self_service');
  assert.equal(task.supportResolvedAt, undefined);
  assert.equal(task.supportCycle, 1);

  state = protectSupportRequestTracking(
    state,
    {
      tasks: [
        {
          ...task,
          status: '진행',
          supportCategory: 'other',
          supportAcknowledgedAt: '2099-01-01T00:00:00.000Z',
        },
      ],
    },
    'partner',
    '2026-08-01T01:00:00.000Z',
  );
  task = (state.tasks as Array<Record<string, unknown>>)[0];
  assert.equal(task.status, '대기');
  assert.equal(task.supportCategory, 'account_access');
  assert.equal(task.supportAcknowledgedAt, undefined);

  state = protectSupportRequestTracking(
    state,
    { tasks: [{ ...task, status: '진행' }] },
    'admin',
    '2026-08-01T02:00:00.000Z',
  );
  task = (state.tasks as Array<Record<string, unknown>>)[0];
  assert.equal(task.status, '진행');
  assert.equal(task.supportAcknowledgedAt, '2026-08-01T02:00:00.000Z');

  state = protectSupportRequestTracking(
    state,
    { tasks: [{ ...task, status: '완료' }] },
    'admin',
    '2026-08-01T03:00:00.000Z',
  );
  task = (state.tasks as Array<Record<string, unknown>>)[0];
  assert.equal(task.supportResolvedAt, '2026-08-01T03:00:00.000Z');
  assert.equal(task.supportResolvedByRole, 'admin');

  state = protectSupportRequestTracking(
    state,
    { tasks: [{ ...task, status: '대기' }] },
    'partner',
    '2026-08-01T04:00:00.000Z',
  );
  task = (state.tasks as Array<Record<string, unknown>>)[0];
  assert.equal(task.status, '대기');
  assert.equal(task.supportOpenedAt, '2026-08-01T04:00:00.000Z');
  assert.equal(task.supportAcknowledgedAt, undefined);
  assert.equal(task.supportResolvedAt, undefined);
  assert.equal(task.supportCycle, 2);

  state = protectSupportRequestTracking(
    state,
    { tasks: [{ ...task, status: '완료' }] },
    'partner',
    '2026-08-01T05:00:00.000Z',
  );
  task = (state.tasks as Array<Record<string, unknown>>)[0];
  assert.equal(task.supportResolvedByRole, 'requester');
});

void test('support summary separates administrator handling, self-close, response and current wait age', () => {
  const waitingOpened = [
    '2026-08-09T23:00:00.000Z',
    '2026-08-09T21:00:00.000Z',
    '2026-08-09T14:00:00.000Z',
    '2026-08-08T00:00:00.000Z',
    '2026-08-06T00:00:00.000Z',
  ];
  const handlingResolved = [
    '2026-08-01T01:00:00.000Z',
    '2026-08-01T03:00:00.000Z',
    '2026-08-01T10:00:00.000Z',
    '2026-08-03T00:00:00.000Z',
    '2026-08-05T00:00:00.000Z',
  ];
  const tracked = (id: string, extra: Record<string, unknown>) =>
    supportTask(id, {
      supportTrackingVersion: 1,
      supportOrigin: 'partner_self_service',
      supportOpenedAt: openedAt,
      supportCycle: 1,
      ...extra,
    });
  const tasks = [
    ...waitingOpened.map((supportOpenedAt, index) =>
      tracked(`waiting-${index}`, { supportOpenedAt }),
    ),
    ...Array.from({ length: 5 }, (_, index) =>
      tracked(`acknowledged-${index}`, {
        status: '진행',
        supportAcknowledgedAt: '2026-08-01T01:00:00.000Z',
        supportCategory: index === 0 ? 'save_sync' : 'account_access',
      }),
    ),
    ...handlingResolved.map((supportResolvedAt, index) =>
      tracked(`resolved-${index}`, {
        status: '완료',
        supportAcknowledgedAt: '2026-08-01T01:00:00.000Z',
        supportResolvedAt,
        supportResolvedByRole: 'admin',
        supportOrigin: index === 0 ? 'admin_logged' : 'partner_self_service',
        supportCategory: index === 0 ? 'files_documents' : 'account_access',
      }),
    ),
    tracked('self-closed', {
      status: '완료',
      supportResolvedAt: '2026-08-01T01:00:00.000Z',
      supportResolvedByRole: 'requester',
      supportCategory: 'consulting_flow',
      supportCycle: 2,
    }),
    supportTask('legacy'),
    tracked('invalid', {
      status: '진행',
      supportAcknowledgedAt: '2026-07-31T23:00:00.000Z',
      supportCategory: 'other',
    }),
    tracked('task-1', {
      status: '진행',
      supportAcknowledgedAt: '2026-08-01T01:00:00.000Z',
    }),
  ];
  const summary = readSupportRequestSummary({ tasks }, now);
  assert.equal(summary.trackedRequests, 17);
  assert.equal(summary.waitingForAcknowledgement, 5);
  assert.equal(summary.acknowledgedOpen, 5);
  assert.equal(summary.adminResolved, 5);
  assert.equal(summary.requesterClosed, 1);
  assert.equal(summary.reopenedCurrentCycles, 1);
  assert.equal(summary.legacyUnmeasurable, 1);
  assert.equal(summary.invalidTransitions, 1);
  assert.equal(summary.partnerSelfService, 16);
  assert.equal(summary.adminLogged, 1);
  assert.deepEqual(summary.unacknowledgedAgeBuckets, {
    under4Hours: 2,
    fourTo24Hours: 1,
    oneTo3Days: 1,
    threeDaysOrMore: 1,
  });
  assert.deepEqual(summary.adminHandlingTimeBuckets, {
    under4Hours: 2,
    fourTo24Hours: 1,
    oneTo3Days: 1,
    threeDaysOrMore: 1,
  });
  assert.deepEqual(summary.responseTimeBuckets, {
    under4Hours: 10,
    fourTo24Hours: 0,
    oneTo3Days: 0,
    threeDaysOrMore: 0,
  });
  assert.doesNotMatch(
    JSON.stringify(summary),
    /가상 지원 요청|partner-support|support-new/,
  );

  const belowThreshold = readSupportRequestSummary(
    { tasks: tasks.filter((task) => !String(task.id).endsWith('-4')) },
    now,
  );
  assert.equal(belowThreshold.unacknowledgedAgeBuckets, null);
  assert.equal(belowThreshold.adminHandlingTimeBuckets, null);
});
