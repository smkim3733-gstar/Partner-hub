import assert from 'node:assert/strict';
import test from 'node:test';
import { portalTaskNavigationLabel, portalTaskNotificationCount } from '../lib/portal-task-notifications';

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

void test('task navigation label exposes the operational attention count on mobile and desktop menus', () => {
  assert.equal(portalTaskNavigationLabel(0), '업무·알림');
  assert.equal(portalTaskNavigationLabel(3), '업무·알림 · 확인 3건');
  assert.equal(portalTaskNavigationLabel(-1), '업무·알림');
});
