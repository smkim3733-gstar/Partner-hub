import {
  companyFileBucket,
  companyFileDatabase,
  CompanyFileError,
  ensureCompanyFileTables,
  findCompanyFile,
  mayReadCompanyFile,
} from '@/lib/company-files';
import { PortalAccessError, requirePortalUser } from '@/lib/portal-auth';
import { readPortalState } from '@/lib/portal-state';
import {
  currentFileAccess,
  fileStateConflict,
  fileStateGuard,
} from '@/lib/company-file-access';
import { isCrossSiteRequest } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

function errorResponse(error: unknown) {
  if (error instanceof PortalAccessError || error instanceof CompanyFileError) {
    return Response.json(
      { error: error.message },
      {
        status: error.status,
        headers: { 'cache-control': 'private, no-store' },
      },
    );
  }
  return null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const state = await readPortalState();
    const currentUser = await requirePortalUser(request, state);
    const { id } = await context.params;
    const row = await findCompanyFile(id);
    if (!row)
      throw new CompanyFileError('요청한 기업자료를 찾을 수 없습니다.', 404);
    if (!mayReadCompanyFile(currentUser, row, state)) {
      throw new CompanyFileError('담당기업 자료만 내려받을 수 있습니다.', 403);
    }

    const deleted = await companyFileDatabase()
      .prepare(
        "SELECT file_id FROM company_file_upload_requests WHERE file_id = ?1 AND status = 'deleted'",
      )
      .bind(id)
      .first();
    if (deleted)
      throw new CompanyFileError('삭제 처리 중인 기업자료입니다.', 404);

    const object = await companyFileBucket().get(row.storage_key);
    if (!object)
      throw new CompanyFileError('원본파일을 찾을 수 없습니다.', 404);
    try {
      const latestRow = await findCompanyFile(id);
      const access = await currentFileAccess(request, currentUser);
      if (!latestRow || latestRow.storage_key !== row.storage_key)
        throw new CompanyFileError('요청한 기업자료를 찾을 수 없습니다.', 404);
      if (!mayReadCompanyFile(access.user, latestRow, access.state))
        throw new CompanyFileError(
          '담당기업 자료만 내려받을 수 있습니다.',
          403,
        );
      const available = await companyFileDatabase()
        .prepare(`SELECT f.id FROM company_file_objects f
        LEFT JOIN company_file_assignments a ON a.file_id = f.id
        WHERE f.id = ?1 AND f.storage_key = ?2 AND a.partner_member_id IS ?3 AND f.assigned_trainee = ?4
        AND NOT EXISTS (SELECT 1 FROM company_file_upload_requests u WHERE u.file_id = f.id AND u.status = 'deleted')
        AND ${fileStateGuard('?5')}`)
        .bind(
          id,
          row.storage_key,
          latestRow.partner_member_id ?? null,
          latestRow.assigned_trainee,
          access.payload,
        )
        .first();
      if (!available)
        throw new CompanyFileError(
          '기업자료 접근 상태가 변경되었습니다. 다시 확인해 주세요.',
          404,
        );
    } catch (error) {
      // Do not expose a prefetched body after revocation or deletion.
      await object.body.cancel().catch(() => {});
      throw error;
    }
    const encodedName = encodeURIComponent(row.original_name);

    return new Response(object.body, {
      headers: {
        'cache-control': 'private, no-store',
        'content-disposition': `attachment; filename*=UTF-8''${encodedName}`,
        'content-type': row.content_type || 'application/octet-stream',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    const response = errorResponse(error);
    if (response) return response;
    console.error('Failed to download company file', error);
    return Response.json(
      { error: '기업자료를 내려받지 못했습니다.' },
      { status: 500, headers: { 'cache-control': 'private, no-store' } },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    if (isCrossSiteRequest(request)) {
      throw new CompanyFileError('허용되지 않은 삭제 요청입니다.', 403);
    }
    const state = await readPortalState();
    const currentUser = await requirePortalUser(request, state);
    const { id } = await context.params;
    const db = companyFileDatabase();
    await ensureCompanyFileTables(db);
    const row = await findCompanyFile(id);
    const access = await currentFileAccess(request, currentUser);
    if (!row) {
      const pending = await db
        .prepare(
          "SELECT owner_key FROM company_file_upload_requests WHERE file_id = ?1 AND status IN ('pending', 'ready')",
        )
        .bind(id)
        .first<{ owner_key: string }>();
      if (
        pending &&
        access.user.role !== 'admin' &&
        pending.owner_key !== `member:${access.user.memberId}`
      )
        throw new CompanyFileError('담당기업 자료만 삭제할 수 있습니다.', 403);
      if (pending)
        throw new CompanyFileError(
          '업로드 처리 중입니다. 저장 결과를 확인한 후 삭제해 주세요.',
          409,
        );
      return new Response(null, {
        status: 204,
        headers: { 'cache-control': 'private, no-store' },
      });
    }
    const canDelete =
      access.user.role === 'admin' ||
      row.uploaded_by_user_id === access.user.id ||
      mayReadCompanyFile(access.user, row, access.state);
    if (!canDelete)
      throw new CompanyFileError('담당기업 자료만 삭제할 수 있습니다.', 403);

    // Authorize the durable deletion decision against the same state, including
    // legacy files without an upload ledger. R2 failure leaves the tombstone.
    const decision = await db
      .prepare(`INSERT INTO company_file_upload_requests
        (owner_key, request_key, fingerprint, file_id, created_at, status)
        SELECT ?1, 'delete', 'legacy-explicit-delete', f.id, f.created_at, 'deleted'
        FROM company_file_objects f LEFT JOIN company_file_assignments a ON a.file_id = f.id
        WHERE f.id = ?2 AND f.storage_key = ?3 AND a.partner_member_id IS ?4
        AND f.assigned_trainee = ?5 AND f.uploaded_by_user_id = ?6 AND ${fileStateGuard('?7')}
        ON CONFLICT(file_id) DO UPDATE SET status = 'deleted'`)
      .bind(
        `legacy-delete:${id}`,
        id,
        row.storage_key,
        row.partner_member_id ?? null,
        row.assigned_trainee,
        row.uploaded_by_user_id,
        access.payload,
      )
      .run();
    if (decision.meta.changes !== 1) {
      await currentFileAccess(request, currentUser);
      if (await findCompanyFile(id)) throw fileStateConflict();
      return new Response(null, {
        status: 204,
        headers: { 'cache-control': 'private, no-store' },
      });
    }
    await companyFileBucket().delete(row.storage_key);
    await db.batch([
      db
        .prepare('DELETE FROM company_file_case_links WHERE file_id = ?1')
        .bind(id),
      db
        .prepare('DELETE FROM company_file_assignments WHERE file_id = ?1')
        .bind(id),
      db.prepare('DELETE FROM company_file_objects WHERE id = ?1').bind(id),
    ]);
    return new Response(null, {
      status: 204,
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch (error) {
    const response = errorResponse(error);
    if (response) return response;
    console.error('Failed to delete company file', error);
    return Response.json(
      { error: '기업자료를 삭제하지 못했습니다.' },
      { status: 500, headers: { 'cache-control': 'private, no-store' } },
    );
  }
}
