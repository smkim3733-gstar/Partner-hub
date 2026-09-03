import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyWorkTaskStatusDraft,
  createSupportAcknowledgementDraft,
  createWorkTaskCompletionDraft,
  workTaskStatusImpact,
} from '../lib/work-task-status';
import { protectSupportRequestTracking } from '../lib/support-request-metrics';

void test('task completion remains isolated until explicit apply', () => {
  const task = {
    id: 'task-review',
    kind: '서류요청',
    status: '진행',
    title: '가상 서류 확인',
  };
  const original = structuredClone(task);
  const draft = createWorkTaskCompletionDraft(task, false);
  assert.deepEqual(task, original);
  assert.equal(draft.expectedStatus, '진행');
  assert.equal(draft.nextStatus, '완료');
  assert.match(workTaskStatusImpact(draft), /알림에서 제외/);
  const changed = applyWorkTaskStatusDraft(task, draft, false);
  assert.equal(changed.status, '완료');
  assert.deepEqual(task, original);
});

void test('support acknowledgement, resolution and reopen follow each actor rule', () => {
  const waiting = {
    id: 'support-waiting',
    kind: '지원요청',
    status: '대기',
    supportTrackingVersion: 1,
    supportCategory: 'files_documents',
    supportOrigin: 'partner_self_service',
    supportOpenedAt: '2026-09-03T00:00:00.000Z',
    supportCycle: 1,
  };
  const acknowledgement = createSupportAcknowledgementDraft(waiting, true);
  assert.equal(acknowledgement.nextStatus, '진행');
  assert.match(workTaskStatusImpact(acknowledgement), /응답시간 지표/);
  assert.equal(applyWorkTaskStatusDraft(waiting, acknowledgement, true).status, '진행');
  assert.throws(() => createSupportAcknowledgementDraft(waiting, false), /다시 확인/);

  const completion = createWorkTaskCompletionDraft(waiting, false);
  const confirmed = applyWorkTaskStatusDraft(waiting, completion, false);
  const saved = protectSupportRequestTracking(
    { tasks: [waiting] },
    { tasks: [confirmed] },
    'partner',
    '2026-09-03T01:00:00.000Z',
  ) as { tasks: Array<Record<string, unknown>> };
  assert.equal(saved.tasks[0]?.status, '완료');
  assert.equal(saved.tasks[0]?.supportResolvedAt, '2026-09-03T01:00:00.000Z');
  assert.equal(saved.tasks[0]?.supportResolvedByRole, 'requester');

  const completed = { ...waiting, status: '완료' };
  const partnerReopen = createWorkTaskCompletionDraft(completed, false);
  assert.equal(partnerReopen.nextStatus, '대기');
  assert.match(workTaskStatusImpact(partnerReopen), /새 지원 요청 주기/);
  const adminReopen = createWorkTaskCompletionDraft(completed, true);
  assert.equal(adminReopen.nextStatus, '진행');
  assert.equal(applyWorkTaskStatusDraft(completed, adminReopen, true).status, '진행');
});

void test('task status apply rejects stale, mismatched and tampered drafts', () => {
  const task = { id: 'task-guarded', kind: '기업상담', status: '대기' };
  const draft = createWorkTaskCompletionDraft(task, false);
  assert.throws(
    () => createWorkTaskCompletionDraft({ ...task, status: '임의상태' }, false),
    /현재 업무 상태/,
  );
  assert.throws(
    () => applyWorkTaskStatusDraft({ ...task, id: 'other' }, draft, false),
    /업무를 다시 확인/,
  );
  assert.throws(
    () => applyWorkTaskStatusDraft({ ...task, status: '진행' }, draft, false),
    /내용·담당·마감 또는 상태가 변경/,
  );
  assert.throws(
    () => applyWorkTaskStatusDraft({ ...task, kind: '서류요청' }, draft, false),
    /내용·담당·마감 또는 상태가 변경/,
  );
  assert.throws(
    () => applyWorkTaskStatusDraft({ ...task, title: '바뀐 업무' }, draft, false),
    /내용·담당·마감 또는 상태가 변경/,
  );
  assert.throws(
    () => applyWorkTaskStatusDraft({ ...task, due: '내일' }, draft, false),
    /내용·담당·마감 또는 상태가 변경/,
  );
  assert.throws(
    () => applyWorkTaskStatusDraft(task, draft, true),
    /계정 권한/,
  );
  assert.throws(
    () => applyWorkTaskStatusDraft(task, { ...draft, nextStatus: '진행' }, false),
    /변경 내용을 다시 확인/,
  );
});
