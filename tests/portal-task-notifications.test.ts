import assert from 'node:assert/strict';
import test from 'node:test';
import {
  portalTaskNavigationLabel,
  portalTaskNavigationFilter,
  portalTaskNeedsAttention,
  portalTaskNotificationCount,
} from '../lib/portal-task-notifications';

void test('task notifications exclude reserved pilot examples and completed work', () => {
  assert.equal(portalTaskNotificationCount([
    { id: 'task-1', status: '대기', dueState: 'overdue' },
    { id: 'task-operational-today', status: '진행', dueState: 'today' },
    { id: 'task-operational-done', status: '완료', dueState: 'overdue' },
    { id: 'task-operational-later', status: '대기', dueState: 'upcoming' },
  ]), 1);
});

void test('task notifications use only the server-authorized candidate list supplied by the caller', () => {
  const privateTask = { id: 'task-private', status: '대기', dueState: 'overdue' };
  assert.equal(portalTaskNotificationCount([]), 0);
  assert.equal(portalTaskNotificationCount([privateTask]), 1);
});

void test('attention filter uses the exact same operational criteria as the notification count', () => {
  const tasks = [
    { id: 'task-2', status: '대기', dueState: 'today' },
    { id: 'task-overdue', status: '대기', dueState: 'overdue' },
    { id: 'task-today', status: '진행', dueState: 'today' },
    { id: 'task-complete', status: '완료', dueState: 'overdue' },
    { id: 'task-upcoming', status: '대기', dueState: 'upcoming' },
  ];
  const attentionTasks = tasks.filter(portalTaskNeedsAttention);

  assert.deepEqual(attentionTasks.map((task) => task.id), ['task-overdue', 'task-today']);
  assert.equal(attentionTasks.length, portalTaskNotificationCount(tasks));
});

void test('task navigation label exposes the operational attention count on mobile and desktop menus', () => {
  assert.equal(portalTaskNavigationLabel(0), '업무·알림');
  assert.equal(portalTaskNavigationLabel(3), '업무·알림 · 확인 3건');
  assert.equal(portalTaskNavigationLabel(-1), '업무·알림');
  assert.equal(portalTaskNavigationFilter(0), 'all');
  assert.equal(portalTaskNavigationFilter(3), 'attention');
});
