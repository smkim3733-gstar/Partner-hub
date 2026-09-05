import { env } from 'cloudflare:workers';
import {
  applicationDraftsIdentityTriggerSql,
  applicationDraftsInsertTriggerSql,
  applicationDraftsNoDeleteTriggerSql,
  applicationDraftsTableSql,
  applicationDraftsTransitionTriggerSql,
} from '@/db/schema';
import { PortalAccessError, type PortalUser } from './portal-auth';
import { FlowError } from './consulting-flow';
import { draftCaseId } from './application-draft';

export const draftOwnerKey = (user: PortalUser) =>
  user.role === 'admin' ? `admin:${user.email}` : `member:${user.memberId}`;
export async function applicationDraftDatabase() {
  const db = (env as unknown as { DB: D1Database }).DB;
  await db.batch([
    db.prepare(applicationDraftsTableSql),
    db.prepare(applicationDraftsIdentityTriggerSql),
    db.prepare(applicationDraftsInsertTriggerSql),
    db.prepare(applicationDraftsTransitionTriggerSql),
    db.prepare(applicationDraftsNoDeleteTriggerSql),
  ]);
  return db;
}

/** A case ID is a reference, never permission to use another person's draft. */
export async function assertNewDraftCases(
  current: unknown,
  next: Record<string, unknown>,
  user: PortalUser,
) {
  const existing = new Set(
    ((current as { cases?: Array<{ id: string }> } | null)?.cases ?? []).map(
      (item) => item.id,
    ),
  );
  const incoming = (
    (next.cases ?? []) as Array<{
      id?: string;
      applicationDraftRevision?: number;
    }>
  ).filter(
    (item) =>
      typeof item.id === 'string' &&
      item.id.startsWith('case-draft-') &&
      !existing.has(item.id),
  );
  if (!incoming.length) return null;
  if (incoming.length > 1)
    throw new FlowError('한 번에 하나의 임시저장 신청만 제출해 주세요.');
  const row = await (
    await applicationDraftDatabase()
  )
    .prepare(
      'SELECT draft_id, revision, payload FROM application_drafts WHERE owner_key = ?1',
    )
    .bind(draftOwnerKey(user))
    .first<{ draft_id: string; revision: number; payload: string | null }>();
  for (const item of incoming) {
    if (!row?.payload || draftCaseId(row.draft_id) !== item.id)
      throw new PortalAccessError(
        '현재 계정의 임시저장으로 접수해 주세요.',
        403,
      );
    if (item.applicationDraftRevision !== row.revision)
      throw new FlowError(
        '다른 창에서 신청서 임시저장을 수정했습니다. 최신 신청서를 확인한 후 제출해 주세요.',
        409,
      );
  }
  return {
    ownerKey: draftOwnerKey(user),
    draftId: row!.draft_id,
    revision: row!.revision,
  };
}
