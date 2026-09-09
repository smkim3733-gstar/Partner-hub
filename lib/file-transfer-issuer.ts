import { companyFileProblem, safeFileName } from './company-file-policy';
import { prepareCompanyFileMetadata } from './company-file-metadata';
import {
  CompanyFileError,
  findCompanyFile,
  mayReadCompanyFile,
  mayUploadCompanyFiles,
  resolveCompanyFileAssignment,
} from './company-files';
import { uploadCaseLink } from './company-file-case';
import { requirePortalUser, PortalAccessError } from './portal-auth';
import { readPortalState } from './portal-state';
import { sessionToken } from './password-store';
import { isCrossSiteRequest } from './request-origin';
import { readBoundedJsonObject, JsonRequestError } from './request-json';
import { privateJsonResponse } from './private-response';
import { FlowError } from './consulting-flow';
import {
  fileTransferPath,
  fileTransferMethod,
  fileTransferRequestMaxBytes,
  parseFileTransferIntent,
  type FileTransferIntent,
} from './file-transfer-contract';
import {
  assertTransferConfig,
  sealTransferTicket,
  type FileTransferConfig,
} from './file-transfer-ticket';
import { loadFlowAccess } from './consulting-flow-store';
import { preflightFlowTransfer } from './flow-transfer-preflight';

export async function issueFileTransfer(
  request: Request,
  config: FileTransferConfig | null,
) {
  if (!config)
    return privateJsonResponse(
      { error: '파일 직접 전송이 연결되지 않았습니다.' },
      { status: 503 },
    );
  try {
    assertTransferConfig(config);
  } catch {
    return privateJsonResponse(
      { error: '파일 전송 설정을 확인해 주세요.' },
      { status: 503 },
    );
  }
  return authorizeFileTransfer(request, config.appOrigin, async (input) => {
    const ticket = await sealTransferTicket(config, input);
    return privateJsonResponse({
      version: 1,
      url: config.transferOrigin + fileTransferPath,
      method: fileTransferMethod(input.intent),
      ...ticket,
    });
  });
}

/** Shared permission preflight for the legacy Worker and native Vercel Blob.
 * The completion callback is server-owned, never supplied by the browser. */
export async function authorizeFileTransfer(
  request: Request,
  appOrigin: string,
  complete: (input: {
    intent: FileTransferIntent;
    session: string;
    userId: string;
  }) => Promise<Response>,
) {
  try {
    if (
      new URL(request.url).origin !== appOrigin ||
      isCrossSiteRequest(request)
    )
      throw new CompanyFileError('허용되지 않은 파일 전송 요청입니다.', 403);
    const state = await readPortalState();
    const user = await requirePortalUser(request, state);
    const session = sessionToken(request);
    if (
      user.authMethod !== 'password' ||
      !session ||
      !/^[a-f0-9]{64}$/.test(session)
    )
      throw new PortalAccessError('독립 운영 계정으로 로그인해 주세요.', 401);
    // FLOW text is bounded separately; raw file bytes are never accepted here.
    const raw = await readBoundedJsonObject(
      request,
      fileTransferRequestMaxBytes,
    );
    if (
      raw.kind !== 'flow-upload' &&
      new TextEncoder().encode(JSON.stringify(raw)).byteLength > 16_384
    )
      throw new FlowError('파일 전송 명세가 너무 큽니다.', 413);
    let intent;
    try {
      if (raw.kind === 'flow-upload') {
        const { payload: _payload, ...scope } = raw;
        intent = parseFileTransferIntent(scope);
      } else intent = parseFileTransferIntent(raw);
    } catch {
      throw new CompanyFileError('파일 전송 정보를 확인해 주세요.', 400);
    }
    if (intent.kind === 'company-upload') {
      if (!mayUploadCompanyFiles(user))
        throw new CompanyFileError('기업자료 업로드 권한이 없습니다.', 403);
      const f = intent.fields;
      if (
        (f.expectedUserId !== undefined && f.expectedUserId !== user.id) ||
        f.consent !== 'confirmed'
      )
        throw new CompanyFileError(
          '제출 계정과 자료 제출 동의를 확인해 주세요.',
          403,
        );
      const prepared = prepareCompanyFileMetadata({
        company: f.company ?? '',
        title: f.title ?? '',
        category: f.category ?? '',
      });
      if (!prepared.ok) throw new CompanyFileError(prepared.error, 400);
      const issue = companyFileProblem(
        { name: safeFileName(intent.file.name), size: intent.file.size },
        prepared.value.category,
      );
      if (issue) throw new CompanyFileError(issue, 400);
      if (
        prepared.value.category === '상담녹취' &&
        f.recordingConsent !== 'confirmed'
      )
        throw new CompanyFileError(
          '녹취자료 저장·공유 동의를 확인해 주세요.',
          400,
        );
      if (
        (f.partnerMemberId?.length ?? 0) > 120 ||
        (f.assignedTrainee?.length ?? 0) > 80
      )
        throw new CompanyFileError('담당 계정 값을 확인해 주세요.', 400);
      const assignment = resolveCompanyFileAssignment(
        user,
        state,
        f.partnerMemberId?.trim(),
        f.assignedTrainee?.trim() ?? '',
      );
      await uploadCaseLink(
        f.caseId ?? null,
        state,
        prepared.value.company,
        assignment.partnerMemberId,
      );
    } else if (intent.kind === 'company-download') {
      const row = await findCompanyFile(intent.fileId);
      if (!row)
        throw new CompanyFileError('요청한 기업자료를 찾을 수 없습니다.', 404);
      if (!mayReadCompanyFile(user, row, state))
        throw new CompanyFileError(
          '담당기업 자료만 내려받을 수 있습니다.',
          403,
        );
    } else if (intent.kind === 'flow-upload') {
      await preflightFlowTransfer(request, user, intent, raw.payload);
    } else {
      const access = await loadFlowAccess(request, intent.caseId);
      if (
        access.user.id !== user.id ||
        !access.flow.files.some((file) => file.id === intent.fileId)
      )
        throw new FlowError(
          '첨부파일 접근 권한 또는 보관 상태를 확인해 주세요.',
          404,
        );
    }
    return await complete({
      intent,
      session,
      userId: user.id,
    });
  } catch (error) {
    if (
      error instanceof CompanyFileError ||
      error instanceof PortalAccessError ||
      error instanceof JsonRequestError ||
      error instanceof FlowError
    )
      return privateJsonResponse(
        { error: error.message },
        { status: error.status },
      );
    return privateJsonResponse(
      { error: '파일 전송 권한을 발급하지 못했습니다.' },
      { status: 503 },
    );
  }
}
