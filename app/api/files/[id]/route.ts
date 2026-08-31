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

export const dynamic = 'force-dynamic';

function errorResponse(error: unknown) {
  if (error instanceof PortalAccessError || error instanceof CompanyFileError) {
    return Response.json({ error: error.message }, { status: error.status });
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
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) {
      throw new CompanyFileError('허용되지 않은 삭제 요청입니다.', 403);
    }
    const state = await readPortalState();
    const currentUser = await requirePortalUser(request, state);
    const { id } = await context.params;
    const row = await findCompanyFile(id);
    if (!row) return new Response(null, { status: 204 });
    const canDelete =
      currentUser.role === 'admin' ||
      row.uploaded_by_user_id === currentUser.id ||
      mayReadCompanyFile(currentUser, row, state);
    if (!canDelete)
      throw new CompanyFileError('담당기업 자료만 삭제할 수 있습니다.', 403);

    const db = companyFileDatabase();
    await ensureCompanyFileTables(db);
    // Tombstone first: an in-flight or delayed upload must never recreate the file.
    await db
      .prepare(
        "UPDATE company_file_upload_requests SET status = 'deleted' WHERE file_id = ?1",
      )
      .bind(id)
      .run();
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
    return new Response(null, { status: 204 });
  } catch (error) {
    const response = errorResponse(error);
    if (response) return response;
    console.error('Failed to delete company file', error);
    return Response.json(
      { error: '기업자료를 삭제하지 못했습니다.' },
      { status: 500 },
    );
  }
}
