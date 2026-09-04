import { companyFileCategories } from './company-file-policy';
import { COMPANY_DOCUMENT_STATUSES } from './company-document-review';
import {
  PORTAL_TASK_DUE_STATES,
  PORTAL_TASK_KINDS,
} from './portal-task-draft';
import { SUPPORT_CATEGORIES } from './support-request-metrics';
import { WORK_TASK_STATUSES } from './work-task-status';

type IntegrityRecord = Record<string, unknown>;

const workTaskPriorities = ['긴급', '보통'] as const;
const scheduleSources = ['partner', 'google'] as const;
const scheduleShareModes = [
  'all_with_assignee',
  'all_busy',
  'private',
] as const;
const scheduleStatuses = [
  '확정',
  '일정요청',
  '일정 확정',
  '바쁨',
  // Partner responses replace masked status with this value before the same
  // client contract validates it.
  '예약됨',
] as const;

function isRecord(value: unknown): value is IntegrityRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function records(value: unknown): IntegrityRecord[] | null {
  return Array.isArray(value) && value.every(isRecord) ? value : null;
}

function isTrimmedText(value: unknown) {
  return typeof value === 'string' && Boolean(value) && value === value.trim();
}

function hasRequiredText(record: IntegrityRecord, fields: readonly string[]) {
  return fields.every((field) => isTrimmedText(record[field]));
}

function taskStateError(value: unknown): string | null {
  const items = records(value);
  if (!items) return null;
  for (const item of items) {
    if (
      !hasRequiredText(item, [
        'company',
        'title',
        'assignee',
        'due',
        'related',
      ])
    )
      return '업무 필수 표시 필드가 올바르지 않습니다.';
    if (!PORTAL_TASK_KINDS.includes(item.kind as never))
      return '업무 유형이 올바르지 않습니다.';
    if (!PORTAL_TASK_DUE_STATES.includes(item.dueState as never))
      return '업무 마감 구분이 올바르지 않습니다.';
    if (!WORK_TASK_STATUSES.includes(item.status as never))
      return '업무 상태가 올바르지 않습니다.';
    if (!workTaskPriorities.includes(item.priority as never))
      return '업무 우선순위가 올바르지 않습니다.';
    if (
      Object.hasOwn(item, 'supportCategory') &&
      !SUPPORT_CATEGORIES.includes(item.supportCategory as never)
    )
      return '업무 지원 요청 유형이 올바르지 않습니다.';
  }
  return null;
}

function companyDocumentStateError(value: unknown): string | null {
  const items = records(value);
  if (!items) return null;
  for (const item of items) {
    if (
      !hasRequiredText(item, [
        'company',
        'title',
        'assignedTrainee',
        'submittedBy',
        'updatedAt',
        'version',
      ])
    )
      return '기업자료 필수 표시 필드가 올바르지 않습니다.';
    if (!companyFileCategories.includes(item.category as never))
      return '기업자료 종류가 올바르지 않습니다.';
    if (!COMPANY_DOCUMENT_STATUSES.includes(item.status as never))
      return '기업자료 상태가 올바르지 않습니다.';
    if (typeof item.sensitive !== 'boolean')
      return '기업자료 민감자료 표시가 올바르지 않습니다.';
  }
  return null;
}

function scheduleStateError(value: unknown): string | null {
  const items = records(value);
  if (!items) return null;
  for (const item of items) {
    if (
      !hasRequiredText(item, [
        'date',
        'weekday',
        'time',
        'end',
        'company',
        'service',
        'method',
        'status',
        'tone',
      ])
    )
      return '일정 필수 표시 필드가 올바르지 않습니다.';
    if (!scheduleSources.includes(item.source as never))
      return '일정 출처가 올바르지 않습니다.';
    if (!scheduleStatuses.includes(item.status as never))
      return '일정 상태가 올바르지 않습니다.';
    if (!scheduleShareModes.includes(item.shareMode as never))
      return '일정 공개범위가 올바르지 않습니다.';
    if (Object.hasOwn(item, 'private') && typeof item.private !== 'boolean')
      return '일정 비공개 표시가 올바르지 않습니다.';
  }
  return null;
}

export function operationalRecordStateError(
  tasks: unknown,
  companyDocuments: unknown,
  schedule: unknown,
): string | null {
  return (
    taskStateError(tasks) ??
    companyDocumentStateError(companyDocuments) ??
    scheduleStateError(schedule)
  );
}
