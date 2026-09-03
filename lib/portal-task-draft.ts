import { SUPPORT_REQUEST_COMPANY } from '@/lib/support-request-metrics';

export const PORTAL_TASK_TITLE_MAX_LENGTH = 120;
export const PORTAL_TASK_COMPANY_MAX_LENGTH = 120;
export const PORTAL_TASK_DUE_MAX_LENGTH = 60;
export const PORTAL_INTERNAL_TASK_COMPANY = '내부업무';

export type PortalTaskDueState = 'upcoming' | 'today' | 'overdue';

export type PortalTaskDraftInput = {
  title: string;
  company: string;
  due: string;
  dueState: string;
  kind: string;
};

export type PreparedPortalTaskDraft = {
  title: string;
  company: string;
  due: string;
  dueState: PortalTaskDueState;
};

export type PortalTaskDraftResult =
  | { ok: true; value: PreparedPortalTaskDraft }
  | { ok: false; error: string };

export function preparePortalTaskDraft(
  input: PortalTaskDraftInput,
): PortalTaskDraftResult {
  const title = input.title.trim();
  if (!title) return { ok: false, error: '업무명을 입력해 주세요.' };
  if (title.length > PORTAL_TASK_TITLE_MAX_LENGTH)
    return { ok: false, error: `업무명은 ${PORTAL_TASK_TITLE_MAX_LENGTH}자 이하로 입력해 주세요.` };

  const company = input.kind === '지원요청'
    ? SUPPORT_REQUEST_COMPANY
    : input.kind === '내부업무'
      ? PORTAL_INTERNAL_TASK_COMPANY
      : input.company.trim();
  if (!company) return { ok: false, error: '기업명을 입력해 주세요.' };
  if (company.length > PORTAL_TASK_COMPANY_MAX_LENGTH)
    return { ok: false, error: `기업명은 ${PORTAL_TASK_COMPANY_MAX_LENGTH}자 이하로 입력해 주세요.` };

  const due = input.due.trim();
  if (!due) return { ok: false, error: '마감일을 입력해 주세요.' };
  if (due.length > PORTAL_TASK_DUE_MAX_LENGTH)
    return { ok: false, error: `마감일은 ${PORTAL_TASK_DUE_MAX_LENGTH}자 이하로 입력해 주세요.` };

  if (!['upcoming', 'today', 'overdue'].includes(input.dueState))
    return { ok: false, error: '마감 구분을 선택해 주세요.' };

  return {
    ok: true,
    value: {
      title,
      company,
      due,
      dueState: input.dueState as PortalTaskDueState,
    },
  };
}
