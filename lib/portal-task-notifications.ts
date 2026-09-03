import { operationalPilotRecords } from '@/lib/pilot-readiness';

export type PortalTaskNotificationCandidate = {
  id?: unknown;
  status: string;
  dueState: string;
};

export function portalTaskNotificationCount<T extends PortalTaskNotificationCandidate>(
  tasks: T[],
) {
  return operationalPilotRecords('task', tasks).filter(
    (task) =>
      task.status !== '완료' &&
      (task.dueState === 'today' || task.dueState === 'overdue'),
  ).length;
}

export function portalTaskNavigationLabel(count: number) {
  return count > 0 ? `업무·알림 · 확인 ${count}건` : '업무·알림';
}
