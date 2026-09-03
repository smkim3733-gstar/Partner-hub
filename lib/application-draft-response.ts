import {
  draftCaseId,
  parseApplicationDraft,
  type ApplicationDraft,
  type DraftEnvelope,
} from './application-draft';

export type ApplicationDraftResponseMode = 'read' | 'save' | 'discard';

export class ApplicationDraftResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApplicationDraftResponseError';
  }
}

function asObject(value: unknown) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function serverMessage(value: unknown) {
  const payload = asObject(value);
  return typeof payload?.error === 'string' && payload.error.trim()
    ? payload.error
    : null;
}

function parseEnvelope(
  value: unknown,
  mode: ApplicationDraftResponseMode,
): DraftEnvelope {
  const payload = asObject(value);
  if (
    !payload ||
    !Number.isSafeInteger(payload.revision) ||
    Number(payload.revision) < 0 ||
    (payload.draftId !== null &&
      (typeof payload.draftId !== 'string' ||
        !/^[a-zA-Z0-9-]{10,80}$/.test(payload.draftId))) ||
    (payload.submittedCaseId !== null &&
      typeof payload.submittedCaseId !== 'string') ||
    (payload.updatedAt !== null &&
      (typeof payload.updatedAt !== 'string' ||
        !Number.isFinite(Date.parse(payload.updatedAt))))
  )
    throw new Error('invalid envelope');

  let draft: ApplicationDraft | null = null;
  if (payload.draft !== null) draft = parseApplicationDraft(payload.draft);
  if ((draft === null) !== (payload.draftId === null))
    throw new Error('invalid draft identity');
  if (
    payload.submittedCaseId !== null &&
    (payload.draftId === null ||
      payload.submittedCaseId !== draftCaseId(payload.draftId))
  )
    throw new Error('invalid submitted identity');
  if (
    (mode === 'save' &&
      (draft === null ||
        payload.draftId === null ||
        payload.submittedCaseId !== null)) ||
    (mode === 'discard' &&
      (draft !== null ||
        payload.draftId !== null ||
        payload.submittedCaseId !== null))
  )
    throw new Error('invalid operation result');

  return {
    revision: payload.revision as number,
    draftId: payload.draftId as string | null,
    draft,
    submittedCaseId: payload.submittedCaseId as string | null,
    updatedAt: payload.updatedAt as string | null,
  };
}

export async function readApplicationDraftResponse(
  response: Response,
  mode: ApplicationDraftResponseMode,
): Promise<DraftEnvelope> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApplicationDraftResponseError(
      '임시저장 응답을 읽지 못했습니다. 현재 입력을 유지하고 다시 시도해 주세요.',
      response.status,
    );
  }
  if (!response.ok)
    throw new ApplicationDraftResponseError(
      serverMessage(payload) ||
        '임시저장을 확인하지 못했습니다. 현재 입력을 유지하고 다시 시도해 주세요.',
      response.status,
    );
  try {
    return parseEnvelope(payload, mode);
  } catch {
    throw new ApplicationDraftResponseError(
      '임시저장 응답 형식이 올바르지 않습니다. 현재 입력을 유지하고 다시 확인해 주세요.',
      response.status,
    );
  }
}
