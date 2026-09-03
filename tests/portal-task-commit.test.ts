import assert from 'node:assert/strict';
import test from 'node:test';
import { commitPortalTask } from '../lib/portal-task-commit';
import { SUPPORT_REQUEST_COMPANY } from '../lib/support-request-metrics';

const requestId = '12345678-1234-4234-8234-123456789abc';
const members = [
  { id: 'partner-1', name: ' 가상 담당자(가상) ', status: '활성', marker: 'one' },
  { id: 'partner-2', name: '다른 담당자', status: '활성', marker: 'two' },
];
const tasks = [{
  id: 'existing-task',
  company: '기존 기업',
  title: '기존 업무',
  kind: '상담',
  assignee: '다른 담당자',
  partnerMemberId: 'partner-2',
  due: '내일',
  dueState: 'upcoming' as const,
  status: '대기' as const,
  priority: '보통' as const,
  related: '기존',
  marker: 'existing',
}];

function input() {
  return {
    requestId,
    assigneeMemberId: 'partner-1',
    draft: {
      title: '  추가서류 확인  ',
      company: '  가상 기업  ',
      due: '  오늘 17:00  ',
      dueState: 'today',
      kind: '서류요청',
      supportCategory: '',
    },
  };
}

void test('direct task commit is immutable, normalized and deterministic for one form request', () => {
  const originalTasks = structuredClone(tasks);
  const originalMembers = structuredClone(members);
  const saved = commitPortalTask(input(), tasks, members, false, 'partner-1');

  assert.equal(saved.task.id, `task-${requestId}`);
  assert.equal(saved.task.title, '추가서류 확인');
  assert.equal(saved.task.company, '가상 기업');
  assert.equal(saved.task.due, '오늘 17:00');
  assert.equal(saved.task.priority, '긴급');
  assert.equal(saved.task.assignee, '가상 담당자');
  assert.equal(saved.task.partnerMemberId, 'partner-1');
  const preserved = saved.tasks.find((item) => item.id === 'existing-task');
  assert.ok(preserved && 'marker' in preserved);
  assert.equal(preserved.marker, 'existing');
  assert.deepEqual(commitPortalTask(input(), tasks, members, false, 'partner-1'), saved);
  assert.deepEqual(tasks, originalTasks);
  assert.deepEqual(members, originalMembers);
});

void test('stable task ID blocks duplicate application and existing collisions', () => {
  const saved = commitPortalTask(input(), tasks, members, false, 'partner-1');
  assert.throws(
    () => commitPortalTask(input(), saved.tasks, members, false, 'partner-1'),
    /이미 같은 업무/,
  );
  assert.throws(
    () => commitPortalTask({ ...input(), requestId: 'invalid' }, tasks, members, false, 'partner-1'),
    /저장 식별자/,
  );
  assert.throws(
    () => commitPortalTask(input(), [{ ...tasks[0], id: `task-${requestId}` }], members, false, 'partner-1'),
    /이미 같은 업무/,
  );
});

void test('task commit rechecks the current account and selected active assignment', () => {
  assert.throws(
    () => commitPortalTask({ ...input(), assigneeMemberId: 'partner-2' }, tasks, members, false, 'partner-1'),
    /현재 계정의 업무 담당 연결/,
  );
  assert.throws(
    () => commitPortalTask(input(), tasks, members, false, null),
    /현재 계정의 업무 담당 연결/,
  );
  assert.throws(
    () => commitPortalTask(input(), tasks, members.map((member) => member.id === 'partner-1' ? { ...member, status: '정지' } : member), false, 'partner-1'),
    /승인된 담당 계정/,
  );
  assert.throws(
    () => commitPortalTask(input(), tasks, [...members, { ...members[0] }], true, 'partner-1'),
    /승인된 담당 계정/,
  );
  assert.throws(
    () => commitPortalTask({ ...input(), assigneeMemberId: 'missing' }, tasks, members, true, null),
    /승인된 담당 계정/,
  );
});

void test('support and administrator-only tasks retain their explicit scope', () => {
  const support = commitPortalTask({
    requestId,
    assigneeMemberId: 'partner-1',
    draft: {
      title: ' 저장 지원 ',
      company: '위조 기업',
      due: '오늘',
      dueState: 'overdue',
      kind: '지원요청',
      supportCategory: 'save_sync',
    },
  }, tasks, members, false, 'partner-1');
  assert.equal(support.task.company, SUPPORT_REQUEST_COMPANY);
  assert.equal(support.task.supportCategory, 'save_sync');
  assert.equal(support.task.priority, '긴급');

  const adminOnly = commitPortalTask({
    ...input(),
    assigneeMemberId: '',
  }, tasks, members, true, null);
  assert.equal(adminOnly.task.partnerMemberId, '');
  assert.equal(adminOnly.task.assignee, '김성민 대표');
});
