import {
  CompanyFileError,
  findCompanyFile,
  type CompanyFileRow,
} from './company-files';
import type { PortalUser } from './portal-auth';
import { fileDigest } from './file-upload-key';

type UploadRecord = {
  file_id: string;
  fingerprint: string;
  created_at: string;
  status: string;
};
export type UploadMetadata = {
  originalName: string;
  company: string;
  category: string;
  title: string;
  assignedTrainee: string;
  partnerMemberId: string;
  caseId: string | null;
  contentType: string;
  sizeBytes: number;
};
export function storedFileResult(row: CompanyFileRow) {
  return {
    id: row.id,
    fileName: row.original_name,
    sizeBytes: row.size_bytes,
    contentType: row.content_type,
    createdAt: row.created_at,
    assignedTrainee: row.assigned_trainee,
    partnerMemberId: row.partner_member_id ?? '',
    ...(row.case_id ? { caseId: row.case_id } : {}),
    category: row.category,
    title: row.title,
  };
}

/** Reserve immutable content before R2. Retrying writes the same bytes at the same key.
 * D1/R2 errors never trigger destructive compensation: their commit may be uncertain. */
export async function storeCompanyUpload(
  db: D1Database,
  bucket: R2Bucket,
  user: PortalUser,
  requestKey: string,
  metadata: UploadMetadata,
  bytes: ArrayBuffer,
) {
  const owner =
    user.role === 'admin' ? `admin:${user.email}` : `member:${user.memberId}`;
  const fingerprint = await fileDigest(
    JSON.stringify(metadata) + (await fileDigest(bytes)),
  );
  await db
    .prepare(`INSERT INTO company_file_upload_requests
    (owner_key, request_key, fingerprint, file_id, created_at, status)
    VALUES (?1, ?2, ?3, ?4, ?5, 'pending') ON CONFLICT(owner_key, request_key) DO NOTHING`)
    .bind(
      owner,
      requestKey,
      fingerprint,
      crypto.randomUUID(),
      new Date().toISOString(),
    )
    .run();
  const record = await db
    .prepare(
      'SELECT file_id, fingerprint, created_at, status FROM company_file_upload_requests WHERE owner_key = ?1 AND request_key = ?2',
    )
    .bind(owner, requestKey)
    .first<UploadRecord>();
  if (!record || record.fingerprint !== fingerprint)
    throw new CompanyFileError(
      '같은 업로드 요청의 파일 또는 자료정보가 변경되었습니다.',
      409,
    );
  if (record.status === 'deleted')
    throw new CompanyFileError(
      '이미 삭제한 업로드입니다. 새 파일 등록으로 진행해 주세요.',
      409,
    );
  if (record.status === 'ready') {
    const saved = await findCompanyFile(record.file_id);
    if (!saved)
      throw new CompanyFileError(
        '기존 파일의 보관 상태를 확인해야 합니다.',
        409,
      );
    return storedFileResult(saved);
  }
  const id = record.file_id;
  const storageKey = `company-source/${id}`;
  await bucket.put(storageKey, bytes, {
    httpMetadata: { contentType: metadata.contentType },
    customMetadata: {
      fileId: id,
      ...(metadata.category === '상담녹취'
        ? { recordingRightsConfirmedAt: record.created_at }
        : {}),
    },
  });
  await db.batch([
    db
      .prepare(`INSERT INTO company_file_objects
      (id, storage_key, original_name, company, category, title, assigned_trainee,
       uploaded_by_user_id, uploaded_by_email, content_type, size_bytes, created_at)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
      WHERE EXISTS (SELECT 1 FROM company_file_upload_requests WHERE file_id = ?1 AND status = 'pending')
      ON CONFLICT(id) DO NOTHING`)
      .bind(
        id,
        storageKey,
        metadata.originalName,
        metadata.company,
        metadata.category,
        metadata.title,
        metadata.assignedTrainee,
        user.id,
        user.email,
        metadata.contentType,
        metadata.sizeBytes,
        record.created_at,
      ),
    db
      .prepare(`INSERT INTO company_file_assignments (file_id, partner_member_id)
      SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM company_file_objects WHERE id = ?1)
      AND EXISTS (SELECT 1 FROM company_file_upload_requests WHERE file_id = ?1 AND status = 'pending')
      ON CONFLICT(file_id) DO NOTHING`)
      .bind(id, metadata.partnerMemberId),
    ...(metadata.caseId
      ? [
          db
            .prepare(`INSERT INTO company_file_case_links (file_id, case_id)
      SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM company_file_objects WHERE id = ?1)
      AND EXISTS (SELECT 1 FROM company_file_upload_requests WHERE file_id = ?1 AND status = 'pending')
      ON CONFLICT(file_id) DO NOTHING`)
            .bind(id, metadata.caseId),
        ]
      : []),
    db
      .prepare(`UPDATE company_file_upload_requests SET status = 'ready' WHERE file_id = ?1 AND status = 'pending'
      AND EXISTS (SELECT 1 FROM company_file_objects WHERE id = ?1)`)
      .bind(id),
  ]);
  const status = await db
    .prepare(
      'SELECT status FROM company_file_upload_requests WHERE file_id = ?1',
    )
    .bind(id)
    .first<{ status: string }>();
  if (status?.status === 'deleted') {
    // Only an explicit authorized deletion permits removing this immutable object.
    await bucket.delete(storageKey);
    throw new CompanyFileError(
      '업로드 중 파일이 삭제되었습니다. 새 파일 등록으로 진행해 주세요.',
      409,
    );
  }
  const row = await findCompanyFile(id);
  if (status?.status !== 'ready' || !row)
    throw new CompanyFileError('파일 저장 확인을 다시 시도해 주세요.', 503);
  return storedFileResult(row);
}
