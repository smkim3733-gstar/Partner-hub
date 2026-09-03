import {
  SUPPORT_CATEGORIES,
  SUPPORT_REQUEST_COMPANY,
  type SupportCategory,
} from '@/lib/support-request-metrics';

export const PORTAL_TASK_TITLE_MAX_LENGTH = 120;
export const PORTAL_TASK_COMPANY_MAX_LENGTH = 120;
export const PORTAL_TASK_DUE_MAX_LENGTH = 60;
export const PORTAL_INTERNAL_TASK_COMPANY = '내부업무';
export const PORTAL_TASK_KINDS = [
  '서류요청',
  '상담',
  '견적서',
  '계약서',
  '사후관리',
  '내부업무',
  '지원요청',
] as const;

export type PortalTaskDueState = 'upcoming' | 'today' | 'overdue';
export type PortalTaskKind = (typeof PORTAL_TASK_KINDS)[number];

export type PortalTaskDraftInput = {
  title: string;
  company: string;
  due: string;
  dueState: string;
  kind: string;
  supportCategory?: string;
};

export type PreparedPortalTaskDraft = {
  title: string;
  company: string;
  due: string;
  dueState: PortalTaskDueState;
  kind: PortalTaskKind;
  supportCategory?: SupportCategory;
};

export type PortalTaskDraftResult =
  | { ok: true; value: PreparedPortalTaskDraft }
  | { ok: false; error: string };

export function emptyPortalTaskClassification() {
  return { kind: '', supportCategory: '' } as const;
}

export function preparePortalTaskDraft(
  input: PortalTaskDraftInput,
): PortalTaskDraftResult {
  const title = input.title.trim();
  if (!title) return { ok: false, error: '업무명을 입력해 주세요.' };
  if (title.length > PORTAL_TASK_TITLE_MAX_LENGTH)
    return { ok: false, error: `업무명은 ${PORTAL_TASK_TITLE_MAX_LENGTH}자 이하로 입력해 주세요.` };

  const kind = PORTAL_TASK_KINDS.find((candidate) => candidate === input.kind);
  if (!kind) return { ok: false, error: '업무유형을 선택해 주세요.' };

  const supportCategory = kind === '지원요청'
    ? SUPPORT_CATEGORIES.find((candidate) => candidate === input.supportCategory)
    : undefined;
  if (kind === '지원요청' && !supportCategory)
    return { ok: false, error: '지원 요청 유형을 선택해 주세요.' };

  const company = kind === '지원요청'
    ? SUPPORT_REQUEST_COMPANY
    : kind === '내부업무'
      ? PORTAL_INTERNAL_TASK_COMPANY
      : input.company.trim();
  if (!company) return { ok: false, error: '기업명을 입력해 주세요.' };
  if (company.length > PORTAL_TASK_COMPANY_MAX_LENGTH)
    return { ok: false, error: `기업명은 ${PORTAL_TASK_COMPANY_MAX_LENGTH}자 이하로 입력해 주세요.` };

  const due = input.due.trim();
  if (!due) return { ok: false, error: '마감일을 입력해 주세요.' };
  if (due.length > PORTAL_TASK_DUE_MAX_LENGTH)
    return { ok: false, error: `마감일은 ${PORTAL_TASK_DUE_MAX_LENGTH}자 이하로 입력해 주세요.` };

  const dueState = ['upcoming', 'today', 'overdue'].find(
    (candidate): candidate is PortalTaskDueState => candidate === input.dueState,
  );
  if (!dueState)
    return { ok: false, error: '마감 구분을 선택해 주세요.' };

  return {
    ok: true,
    value: {
      title,
      company,
      due,
      dueState,
      kind,
      ...(supportCategory ? { supportCategory } : {}),
    },
  };
}
