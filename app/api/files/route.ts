import {
  companyFileBucket,
  companyFileCategories,
  companyFileDatabase,
  CompanyFileError,
  ensureCompanyFileTables,
  mayUploadCompanyFiles,
  resolveCompanyFileAssignment,
  safeFileName,
} from '@/lib/company-files';
import { PortalAccessError, requirePortalUser } from '@/lib/portal-auth';
import { readPortalState } from '@/lib/portal-state';
import {
  companyFileProblem,
  MAX_COMPANY_FILE_BYTES,
} from '@/lib/company-file-policy';
import { boundedBody } from '@/lib/consulting-flow-http';
import { FlowError } from '@/lib/consulting-flow';
import { uploadCaseLink } from '@/lib/company-file-case';

export const dynamic = 'force-dynamic';

function field(form: FormData, key: string, maxLength: number) {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function categoryField(form: FormData) {
  const value = field(form, 'category', 40);
  return companyFileCategories.find((category) => category === value) ?? null;
}

function errorResponse(error: unknown) {
  if (
    error instanceof PortalAccessError ||
    error instanceof CompanyFileError ||
    error instanceof FlowError
  ) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return null;
}

function checkSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    throw new CompanyFileError('허용되지 않은 업로드 요청입니다.', 403);
  }
}

export async function POST(request: Request) {
  let storedKey = '';
  try {
    checkSameOrigin(request);
    const state = await readPortalState();
    const currentUser = await requirePortalUser(request, state);
    if (!mayUploadCompanyFiles(currentUser)) {
      throw new CompanyFileError(
        '현재 계정에는 기업자료 업로드 권한이 없습니다.',
        403,
      );
    }

    const contentTypeHeader = request.headers.get('content-type') || '';
    if (!contentTypeHeader.startsWith('multipart/form-data'))
      throw new CompanyFileError('파일 업로드 형식이 올바르지 않습니다.', 400);
    const bytes = await boundedBody(
      request,
      MAX_COMPANY_FILE_BYTES + 1024 * 1024,
    );
    let form: FormData;
    try {
      form = await new Response(bytes, {
        headers: { 'content-type': contentTypeHeader },
      }).formData();
    } catch {
      throw new CompanyFileError('파일 업로드 요청을 읽지 못했습니다.', 400);
    }
    if (
      [
        'file',
        'company',
        'title',
        'category',
        'assignedTrainee',
        'partnerMemberId',
        'caseId',
        'consent',
        'recordingConsent',
      ].some((key) => form.getAll(key).length > 1)
    )
      throw new CompanyFileError(
        '파일과 자료정보는 요청당 한 개씩 전달해 주세요.',
        400,
      );
    if (field(form, 'consent', 20) !== 'confirmed') {
      throw new CompanyFileError(
        '기업자료 제출 권한과 개인정보 마스킹 여부를 확인해 주세요.',
        400,
      );
    }

    const fileValue = form.get('file');
    if (!(fileValue instanceof File) || fileValue.size === 0) {
      throw new CompanyFileError('업로드할 파일을 선택해 주세요.', 400);
    }
    if (fileValue.size > MAX_COMPANY_FILE_BYTES) {
      throw new CompanyFileError(
        '파일 한 개의 크기는 25MB 이하여야 합니다.',
        413,
      );
    }

    const originalName = safeFileName(fileValue.name);
    const company = field(form, 'company', 100);
    const title = field(form, 'title', 150);
    const category = categoryField(form);
    if (!company || !title || !category) {
      throw new CompanyFileError(
        '기업명·자료명·자료종류를 모두 확인해 주세요.',
        400,
      );
    }
    const fileProblem = companyFileProblem(
      { name: originalName, size: fileValue.size },
      category,
    );
    if (fileProblem) throw new CompanyFileError(fileProblem, 400);
    if (
      category === '상담녹취' &&
      field(form, 'recordingConsent', 20) !== 'confirmed'
    )
      throw new CompanyFileError(
        '녹취자료의 저장·내부 검토·담당 파트너 공유 권한을 확인해 주세요.',
        400,
      );

    const rawMemberId = form.get('partnerMemberId');
    if (
      rawMemberId !== null &&
      (typeof rawMemberId !== 'string' || rawMemberId.length > 120)
    )
      throw new CompanyFileError('담당 계정 값이 올바르지 않습니다.', 400);
    const { assignedTrainee, partnerMemberId } = resolveCompanyFileAssignment(
      currentUser,
      state,
      typeof rawMemberId === 'string' ? rawMemberId.trim() : undefined,
      field(form, 'assignedTrainee', 80),
    );
    const caseId = await uploadCaseLink(
      form.get('caseId'),
      state,
      company,
      partnerMemberId,
    );
    const id = crypto.randomUUID();
    storedKey = `company-source/${id}`;
    const createdAt = new Date().toISOString();
    const contentType = fileValue.type || 'application/octet-stream';
    const bucket = companyFileBucket();
    const db = companyFileDatabase();
    await ensureCompanyFileTables(db);

    await bucket.put(storedKey, await fileValue.arrayBuffer(), {
      httpMetadata: { contentType },
      customMetadata: {
        fileId: id,
        ...(category === '상담녹취'
          ? { recordingRightsConfirmedAt: createdAt }
          : {}),
      },
    });

    try {
      await db.batch([
        db
          .prepare(`
          INSERT INTO company_file_objects (
            id, storage_key, original_name, company, category, title,
            assigned_trainee, uploaded_by_user_id, uploaded_by_email,
            content_type, size_bytes, created_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
        `)
          .bind(
            id,
            storedKey,
            originalName,
            company,
            category,
            title,
            assignedTrainee,
            currentUser.id,
            currentUser.email,
            contentType,
            fileValue.size,
            createdAt,
          ),
        db
          .prepare(
            'INSERT INTO company_file_assignments (file_id, partner_member_id) VALUES (?1, ?2)',
          )
          .bind(id, partnerMemberId),
        ...(caseId
          ? [
              db
                .prepare(
                  'INSERT INTO company_file_case_links (file_id, case_id) VALUES (?1, ?2)',
                )
                .bind(id, caseId),
            ]
          : []),
      ]);
    } catch (error) {
      await bucket.delete(storedKey);
      storedKey = '';
      throw error;
    }

    return Response.json(
      {
        file: {
          id,
          fileName: originalName,
          sizeBytes: fileValue.size,
          contentType,
          createdAt,
          assignedTrainee,
          partnerMemberId,
          ...(caseId ? { caseId } : {}),
          category,
          title,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    const response = errorResponse(error);
    if (response) return response;
    console.error('Failed to upload company file', { storedKey, error });
    return Response.json(
      { error: '기업자료를 보안 저장소에 등록하지 못했습니다.' },
      { status: 500 },
    );
  }
}
