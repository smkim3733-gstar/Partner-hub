import { postCompanyFile } from './company-file-post';
import { GET as getCompanyFile } from '@/app/api/files/[id]/route';
import {
  describeCompanyTransfer,
  describeFlowTransfer,
  fileTransferMethod,
  fileTransferBusinessPath,
} from './file-transfer-contract';
import { postConsultingFlow } from './consulting-flow-handlers';
import { GET as getFlowFile } from '@/app/api/consulting-flow/[caseId]/files/[fileId]/route';
import { FlowError } from './consulting-flow';
import {
  assertTransferTime,
  type TransferClaims,
} from './file-transfer-ticket';
import { sessionCookie } from './password-store';
import { requirePortalUser, PortalAccessError } from './portal-auth';
import { readPortalState } from './portal-state';
import { CompanyFileError } from './company-files';
import { privateJsonResponse } from './private-response';

function deadlineBody(
  body: ReadableStream<Uint8Array> | null,
  expiresAt: number,
) {
  if (!body) return null;
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const remaining = expiresAt * 1000 - Date.now();
        if (remaining <= 0) throw new Error('Transfer expired');
        const part = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Transfer expired')),
              remaining,
            );
          }),
        ]);
        if (part.done) controller.close();
        else controller.enqueue(part.value);
      } catch {
        void reader.cancel().catch(() => {});
        controller.error(new Error('File transfer interrupted'));
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** Only the decrypted, exact-scope session enters existing handlers. Caller
 * cookies, Sites identity, paths, idempotency keys and forwarding headers do not. */
export async function dispatchFileTransfer(
  incoming: Request,
  claims: TransferClaims,
) {
  assertTransferTime(claims);
  const upload = fileTransferMethod(claims.intent) === 'POST';
  const url = claims.origin + fileTransferBusinessPath(claims.intent);
  const base = new Request(url);
  const headers = new Headers({
    origin: claims.origin,
    cookie: sessionCookie(base, claims.session).split(';')[0],
  });
  if (claims.intent.kind === 'company-upload')
    headers.set('idempotency-key', claims.intent.requestKey);
  if (upload) {
    for (const key of ['content-type', 'content-length']) {
      const value = incoming.headers.get(key);
      if (value !== null) headers.set(key, value);
    }
  }
  const authRequest = new Request(url, {
    method: upload ? 'POST' : 'GET',
    headers,
  });
  let user;
  try {
    user = await requirePortalUser(authRequest, await readPortalState());
  } catch (error) {
    if (error instanceof PortalAccessError)
      return privateJsonResponse(
        { error: error.message },
        { status: error.status },
      );
    throw error;
  }
  const request = new Request(url, {
    method: upload ? 'POST' : 'GET',
    headers,
    ...(upload
      ? { body: deadlineBody(incoming.body, claims.exp), duplex: 'half' }
      : {}),
  } as RequestInit & { duplex?: 'half' });
  if (user.id !== claims.sub || user.authMethod !== 'password')
    return privateJsonResponse(
      { error: '전송을 요청한 계정으로 다시 로그인해 주세요.' },
      { status: 403 },
    );
  if (claims.intent.kind === 'company-download')
    return getCompanyFile(request, {
      params: Promise.resolve({ id: claims.intent.fileId }),
    });
  if (claims.intent.kind === 'flow-download')
    return getFlowFile(request, {
      params: Promise.resolve({
        caseId: claims.intent.caseId,
        fileId: claims.intent.fileId,
      }),
    });
  if (claims.intent.kind === 'flow-upload') {
    const expected = claims.intent;
    return postConsultingFlow(
      request,
      { params: Promise.resolve({ caseId: expected.caseId }) },
      async (form) => {
        try {
          const actual = await describeFlowTransfer(expected.caseId, form);
          assertTransferTime(claims);
          if (JSON.stringify(actual) !== JSON.stringify(expected))
            throw new Error();
        } catch {
          throw new FlowError(
            '발급된 전송 권한과 명령·첨부가 다르거나 만료되었습니다.',
            403,
          );
        }
      },
    );
  }
  const expected = claims.intent;
  return postCompanyFile(request, async (form) => {
    try {
      const actual = await describeCompanyTransfer(form, expected.requestKey);
      assertTransferTime(claims);
      if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw new Error();
    } catch {
      throw new CompanyFileError(
        '발급된 전송 권한과 파일·자료정보가 다르거나 만료되었습니다.',
        403,
      );
    }
  });
}
