import { isPilotSeedRecord } from '@/lib/pilot-readiness';

export type PortalTaskNotificationCandidate = {
  id?: unknown;
  status: string;
  dueState: string;
};

export function portalTaskNeedsAttention(
  task: PortalTaskNotificationCandidate,
) {
  return !isPilotSeedRecord('task', task)
    && task.status !== '완료'
    && (task.dueState === 'today' || task.dueState === 'overdue');
}

export function portalTaskNotificationCount<T extends PortalTaskNotificationCandidate>(
  tasks: T[],
) {
  return tasks.filter(portalTaskNeedsAttention).length;
}

export function portalTaskNavigationLabel(count: number) {
  return count > 0 ? `업무·알림 · 확인 ${count}건` : '업무·알림';
}

export function portalTaskNavigationFilter(count: number) {
  return count > 0 ? 'attention' as const : 'all' as const;
}
