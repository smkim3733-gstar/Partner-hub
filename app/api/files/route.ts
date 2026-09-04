import {
  companyFileBucket,
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
import {
  COMPANY_FILE_COMPANY_MAX_LENGTH,
  COMPANY_FILE_TITLE_MAX_LENGTH,
  prepareCompanyFileMetadata,
} from '@/lib/company-file-metadata';
import { readFlowMultipartFormData } from '@/lib/consulting-flow-http';
import { FlowError } from '@/lib/consulting-flow';
import { uploadCaseLink } from '@/lib/company-file-case';
import { storeCompanyUpload } from '@/lib/company-upload-store';
import {
  currentFileAccess,
  fileStateConflict,
} from '@/lib/company-file-access';
import { scheduleDuplicateRequestMetric } from '@/lib/duplicate-request-metrics';
import { isCrossSiteRequest } from '@/lib/request-origin';
import { isMultipartFormDataContentType } from '@/lib/request-multipart';
import { HeaderRequestError, readIdempotencyKey } from '@/lib/request-header';

export const dynamic = 'force-dynamic';

function field(form: FormData, key: string, maxLength: number) {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function errorResponse(error: unknown) {
  if (
    error instanceof PortalAccessError ||
    error instanceof CompanyFileError ||
    error instanceof FlowError ||
    error instanceof HeaderRequestError
  ) {
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

function checkSameOrigin(request: Request) {
  if (isCrossSiteRequest(request)) {
    throw new CompanyFileError('허용되지 않은 업로드 요청입니다.', 403);
  }
}

export async function POST(request: Request) {
  try {
    checkSameOrigin(request);
    const state = await readPortalState();
    const currentUser = await requirePortalUser(request, state);
    const suppliedKey = readIdempotencyKey(request);
    if (!mayUploadCompanyFiles(currentUser)) {
      throw new CompanyFileError(
        '현재 계정에는 기업자료 업로드 권한이 없습니다.',
        403,
      );
    }

    const contentTypeHeader = request.headers.get('content-type') || '';
    if (!isMultipartFormDataContentType(contentTypeHeader))
      throw new CompanyFileError('파일 업로드 형식이 올바르지 않습니다.', 400);
    const form = await readFlowMultipartFormData(
      request,
      MAX_COMPANY_FILE_BYTES + 1024 * 1024,
    );
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
        'expectedUserId',
      ].some((key) => form.getAll(key).length > 1)
    )
      throw new CompanyFileError(
        '파일과 자료정보는 요청당 한 개씩 전달해 주세요.',
        400,
      );
    if (
      form.has('expectedUserId') &&
      form.get('expectedUserId') !== currentUser.id
    )
      throw new CompanyFileError(
        '작성하던 계정으로 로그인한 후 파일을 제출해 주세요.',
        403,
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
    const metadata = prepareCompanyFileMetadata({
      company: field(form, 'company', COMPANY_FILE_COMPANY_MAX_LENGTH + 1),
      title: field(form, 'title', COMPANY_FILE_TITLE_MAX_LENGTH + 1),
      category: field(form, 'category', 41),
    });
    if (!metadata.ok) throw new CompanyFileError(metadata.error, 400);
    const { company, title, category } = metadata.value;
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
    const db = companyFileDatabase();
    await ensureCompanyFileTables(db);
    const stored = await storeCompanyUpload(
      db,
      companyFileBucket(),
      currentUser,
      suppliedKey ?? `legacy-${crypto.randomUUID()}`,
      {
        originalName,
        company,
        title,
        category,
        assignedTrainee,
        partnerMemberId,
        caseId,
        contentType: fileValue.type || 'application/octet-stream',
        sizeBytes: fileValue.size,
      },
      await fileValue.arrayBuffer(),
      async () => {
        const access = await currentFileAccess(request, currentUser);
        if (!mayUploadCompanyFiles(access.user))
          throw new CompanyFileError(
            '현재 계정에는 기업자료 업로드 권한이 없습니다.',
            403,
          );
        const assignment = resolveCompanyFileAssignment(
          access.user,
          access.state,
          typeof rawMemberId === 'string' ? rawMemberId.trim() : undefined,
          field(form, 'assignedTrainee', 80),
        );
        if (
          assignment.partnerMemberId !== partnerMemberId ||
          assignment.assignedTrainee !== assignedTrainee
        )
          throw fileStateConflict();
        await uploadCaseLink(
          form.get('caseId'),
          access.state,
          company,
          partnerMemberId,
        );
        return access.payload;
      },
      (outcome) =>
        scheduleDuplicateRequestMetric({ source: 'file_upload', outcome }),
    );
    if (suppliedKey === null)
      scheduleDuplicateRequestMetric({
        source: 'file_upload',
        outcome: 'unkeyed_request',
      });
    return Response.json(
      { file: stored },
      { status: 201, headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (error) {
    const response = errorResponse(error);
    if (response) return response;
    console.error('Failed to upload company file', error);
    return Response.json(
      { error: '기업자료를 보안 저장소에 등록하지 못했습니다.' },
      { status: 500, headers: { 'cache-control': 'private, no-store' } },
    );
  }
}
