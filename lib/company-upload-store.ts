import {
  companyFileObjectBinding,
  companyFileObjectMatchesIntegrity,
  companyFileMetadataIntegrityGuardSql,
  CompanyFileError,
  findCompanyFile,
  readCompanyFileObjectIntegrity,
  type CompanyFileRow,
} from './company-files';
import type { PortalUser } from './portal-auth';
import { fileDigest } from './file-upload-key';
import { fileStateConflict, fileStateGuard } from './company-file-access';
import { downloadContentType } from './download-content-type';

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
  /** Browser-reported MIME used only to resume requests reserved before MIME normalization. */
  legacyContentType?: string;
  sizeBytes: number;
};
export type UploadDuplicateOutcome = 'safe_retry' | 'request_key_conflict';
export function storedFileResult(row: CompanyFileRow) {
  return {
    id: row.id,
    fileName: row.original_name,
    sizeBytes: row.size_bytes,
    contentType: downloadContentType(row.original_name),
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
  legacyRequestKeys: readonly string[],
  authorize: () => Promise<string | null>,
  onDuplicateObserved?: (outcome: UploadDuplicateOutcome) => void,
) {
  const owner =
    user.role === 'admin' ? `admin:${user.email}` : `member:${user.memberId}`;
  const bytesFingerprint = await fileDigest(bytes);
  const { legacyContentType, ...storedMetadata } = metadata;
  const fingerprint = await fileDigest(
    JSON.stringify(storedMetadata) + bytesFingerprint,
  );
  const legacyFingerprint =
    legacyContentType && legacyContentType !== metadata.contentType
      ? await fileDigest(
          JSON.stringify({
            ...storedMetadata,
            contentType: legacyContentType,
          }) + bytesFingerprint,
        )
      : fingerprint;
  const initialPayload = await authorize();
  const compatibleLegacyKeys = [
    ...new Set(legacyRequestKeys.filter((key) => key !== requestKey)),
  ];
  if (compatibleLegacyKeys.length > 6)
    throw new Error('Too many compatible upload request keys');
  if (compatibleLegacyKeys.length > 0) {
    const currentRecord = await db
      .prepare(
        'SELECT file_id, fingerprint, created_at, status FROM company_file_upload_requests WHERE owner_key = ?1 AND request_key = ?2',
      )
      .bind(owner, requestKey)
      .first<UploadRecord>();
    if (!currentRecord) {
      const placeholders = compatibleLegacyKeys
        .map((_, index) => `?${index + 2}`)
        .join(', ');
      const legacyRecords = await db
        .prepare(
          `SELECT request_key, file_id, fingerprint, created_at, status
           FROM company_file_upload_requests
           WHERE owner_key = ?1 AND request_key IN (${placeholders}) LIMIT 2`,
        )
        .bind(owner, ...compatibleLegacyKeys)
        .all<UploadRecord & { request_key: string }>();
      if (legacyRecords.results.length > 1)
        throw new CompanyFileError(
          '같은 신청 첨부의 이전 저장 기록이 둘 이상입니다. 원본 보관 현황에서 확인해 주세요.',
          409,
        );
      const legacyRequest = legacyRecords.results[0];
      if (
        legacyRequest &&
        legacyRequest.fingerprint !== fingerprint &&
        legacyRequest.fingerprint !== legacyFingerprint
      )
        throw new CompanyFileError(
          '같은 업로드 요청의 파일 또는 자료정보가 변경되었습니다.',
          409,
        );
      if (legacyRequest?.status === 'deleted')
        throw new CompanyFileError(
          '이미 삭제한 업로드입니다. 새 파일 등록으로 진행해 주세요.',
          409,
        );
      if (legacyRequest)
        await db
          .prepare(`UPDATE company_file_upload_requests
            SET request_key = ?1, fingerprint = ?2
            WHERE owner_key = ?3 AND request_key = ?4
            AND NOT EXISTS (
              SELECT 1 FROM company_file_upload_requests
              WHERE owner_key = ?3 AND request_key = ?1
            ) AND ${fileStateGuard('?5')}`)
          .bind(
            requestKey,
            fingerprint,
            owner,
            legacyRequest.request_key,
            initialPayload,
          )
          .run();
    }
  }
  const candidateFileId = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO company_file_upload_requests
    (owner_key, request_key, fingerprint, file_id, created_at, status)
    SELECT ?1, ?2, ?3, ?4, ?5, 'pending' WHERE ${fileStateGuard('?6')}
    ON CONFLICT(owner_key, request_key) DO NOTHING`)
    .bind(
      owner,
      requestKey,
      fingerprint,
      candidateFileId,
      new Date().toISOString(),
      initialPayload,
    )
    .run();
  const record = await db
    .prepare(
      'SELECT file_id, fingerprint, created_at, status FROM company_file_upload_requests WHERE owner_key = ?1 AND request_key = ?2',
    )
    .bind(owner, requestKey)
    .first<UploadRecord>();
  if (!record) throw fileStateConflict();
  const existedBefore = record.file_id !== candidateFileId;
  const observe = (outcome: UploadDuplicateOutcome) => {
    if (!existedBefore) return;
    try {
      onDuplicateObserved?.(outcome);
    } catch {
      // Telemetry must never change upload behavior.
    }
  };
  if (
    record.fingerprint !== fingerprint &&
    record.fingerprint !== legacyFingerprint
  ) {
    if (record.status !== 'deleted') observe('request_key_conflict');
    throw new CompanyFileError(
      '같은 업로드 요청의 파일 또는 자료정보가 변경되었습니다.',
      409,
    );
  }
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
    await authorize();
    await assertNotDeleted(db, bucket, record.file_id, false);
    const integrity = await readCompanyFileObjectIntegrity(saved);
    const object = await bucket.head(saved.storage_key);
    if (!object || !companyFileObjectMatchesIntegrity(saved, object, integrity))
      throw new CompanyFileError(
        '기존 파일의 보관 상태를 확인해야 합니다.',
        409,
      );
    await authorize();
    await assertNotDeleted(db, bucket, record.file_id, false);
    observe('safe_retry');
    return storedFileResult(saved);
  }
  const id = record.file_id;
  const storageKey = `company-source/${id}`;
  await authorize();
  const object = await bucket.put(storageKey, bytes, {
    httpMetadata: { contentType: metadata.contentType },
    customMetadata: {
      fileId: id,
      ...(metadata.category === '상담녹취'
        ? { recordingRightsConfirmedAt: record.created_at }
        : {}),
    },
  });
  const objectBinding = companyFileObjectBinding(
    {
      id,
      storage_key: storageKey,
      content_type: metadata.contentType,
      size_bytes: metadata.sizeBytes,
    },
    object,
  );
  // A prior explicit deletion wins even if authorization was revoked during R2.put.
  await assertNotDeleted(db, bucket, id, true);
  let payload: string | null;
  try {
    payload = await authorize();
  } catch (error) {
    await assertNotDeleted(db, bucket, id, true);
    throw error;
  }
  await db.batch([
    db
      .prepare(`INSERT INTO company_file_objects
      (id, storage_key, original_name, company, category, title, assigned_trainee,
       uploaded_by_user_id, uploaded_by_email, content_type, size_bytes, created_at)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
      WHERE EXISTS (SELECT 1 FROM company_file_upload_requests WHERE file_id = ?1 AND status = 'pending')
      AND ${fileStateGuard('?13')}
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
        payload,
      ),
    db
      .prepare(`INSERT INTO company_file_object_integrity
      (file_id, validation_mode, r2_etag, r2_content_type)
      SELECT ?1, 'etag', ?2, ?3
      WHERE EXISTS (SELECT 1 FROM company_file_objects WHERE id = ?1
        AND storage_key = ?4 AND content_type = ?3 AND size_bytes = ?5)
      AND EXISTS (SELECT 1 FROM company_file_upload_requests
        WHERE file_id = ?1 AND status = 'pending')`)
      .bind(
        id,
        objectBinding.etag,
        objectBinding.contentType,
        storageKey,
        metadata.sizeBytes,
      ),
    db
      .prepare(`INSERT INTO company_file_metadata
      (file_id, original_name, company, category, title, assigned_trainee,
       uploaded_by_user_id, uploaded_by_email, content_type, size_bytes, created_at)
      SELECT f.id, f.original_name, f.company, f.category, f.title,
        f.assigned_trainee, f.uploaded_by_user_id, f.uploaded_by_email,
        f.content_type, f.size_bytes, f.created_at
      FROM company_file_objects f
      WHERE f.id = ?1 AND f.storage_key = ?2 AND f.original_name = ?3
        AND f.company = ?4 AND f.category = ?5 AND f.title = ?6
        AND f.assigned_trainee = ?7 AND f.uploaded_by_user_id = ?8
        AND f.uploaded_by_email = ?9 AND f.content_type = ?10
        AND f.size_bytes = ?11 AND f.created_at = ?12
        AND EXISTS (SELECT 1 FROM company_file_upload_requests
          WHERE file_id = ?1 AND status = 'pending')`)
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
      .prepare(`INSERT INTO company_file_storage_keys (file_id, storage_key)
      SELECT ?1, ?2
      WHERE EXISTS (SELECT 1 FROM company_file_objects WHERE id = ?1 AND storage_key = ?2)
      AND EXISTS (SELECT 1 FROM company_file_upload_requests
        WHERE file_id = ?1 AND status = 'pending')`)
      .bind(id, storageKey),
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
      AND EXISTS (SELECT 1 FROM company_file_objects WHERE id = ?1)
      AND EXISTS (SELECT 1 FROM company_file_object_integrity WHERE file_id = ?1
        AND validation_mode = 'etag' AND r2_etag = ?2 AND r2_content_type = ?3)
      AND EXISTS (SELECT 1 FROM company_file_storage_keys WHERE file_id = ?1
        AND storage_key = ?5)
      AND EXISTS (SELECT 1 FROM company_file_objects f WHERE f.id = ?1
        AND ${companyFileMetadataIntegrityGuardSql})
      AND ${fileStateGuard('?4')}`)
      .bind(
        id,
        objectBinding.etag,
        objectBinding.contentType,
        payload,
        storageKey,
      ),
  ]);
  const status = await db
    .prepare(
      'SELECT status FROM company_file_upload_requests WHERE file_id = ?1',
    )
    .bind(id)
    .first<{ status: string }>();
  if (status?.status === 'deleted')
    await assertNotDeleted(db, bucket, id, true);
  await authorize();
  if (status?.status === 'pending') throw fileStateConflict();
  const row = await findCompanyFile(id);
  if (status?.status !== 'ready' || !row)
    throw new CompanyFileError('파일 저장 확인을 다시 시도해 주세요.', 503);
  await assertNotDeleted(db, bucket, id, false);
  const integrity = await readCompanyFileObjectIntegrity(row);
  const storedObject = await bucket.head(row.storage_key);
  if (
    !storedObject ||
    !companyFileObjectMatchesIntegrity(row, storedObject, integrity)
  )
    throw new CompanyFileError('파일 저장 확인을 다시 시도해 주세요.', 503);
  await authorize();
  await assertNotDeleted(db, bucket, id, false);
  observe('safe_retry');
  return storedFileResult(row);
}

async function assertNotDeleted(
  db: D1Database,
  bucket: R2Bucket,
  id: string,
  wroteBytes: boolean,
) {
  const deleted = await db
    .prepare(
      "SELECT file_id FROM company_file_upload_requests WHERE file_id = ?1 AND status = 'deleted'",
    )
    .bind(id)
    .first();
  if (!deleted) return;
  // Never compensate an uncertain upload by deleting it. Only a durable explicit
  // deletion allows cleanup of bytes written by this in-flight upload.
  if (wroteBytes) await bucket.delete(`company-source/${id}`);
  throw new CompanyFileError(
    '업로드 중 파일이 삭제되었습니다. 새 파일 등록으로 진행해 주세요.',
    409,
  );
}
