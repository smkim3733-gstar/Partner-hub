import {
  describeCompanyTransfer,
  describeFlowTransfer,
  fileTransferMethod,
  fileTransferPath,
  type FileTransferIntent,
} from './file-transfer-contract';
import { MAX_COMPANY_FILE_BYTES, safeFileName } from './company-file-policy';

class TransferIssuanceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export async function requestFileTransfer(
  intent: FileTransferIntent,
  payload?: string,
) {
  if (intent.kind === 'flow-upload' && typeof payload !== 'string')
    throw new Error('전송할 명령 본문이 필요합니다.');
  const response = await fetch('/api/file-transfers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    body: JSON.stringify(
      intent.kind === 'flow-upload' ? { ...intent, payload } : intent,
    ),
    signal: AbortSignal.timeout(30_000),
  });
  const value = (await response.json()) as {
    version?: unknown;
    url?: unknown;
    method?: unknown;
    token?: unknown;
    expiresAt?: unknown;
    error?: unknown;
  };
  if (!response.ok)
    throw new TransferIssuanceError(
      typeof value.error === 'string'
        ? value.error
        : '파일 전송 권한을 확인하지 못했습니다.',
      response.status,
    );
  if (
    value.version !== 1 ||
    typeof value.url !== 'string' ||
    typeof value.token !== 'string' ||
    value.token.length > 20_000 ||
    !/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/.test(value.token) ||
    value.method !== fileTransferMethod(intent) ||
    !Number.isSafeInteger(value.expiresAt) ||
    (value.expiresAt as number) <= Date.now() / 1000 ||
    (value.expiresAt as number) > Date.now() / 1000 + 121
  )
    throw new Error('파일 전송 응답 형식을 확인하지 못했습니다.');
  const url = new URL(value.url);
  const local =
    url.protocol === 'http:' &&
    url.hostname === '127.0.0.1' &&
    location.protocol === 'http:' &&
    location.hostname === '127.0.0.1';
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== fileTransferPath ||
    (url.protocol !== 'https:' && !local) ||
    url.origin === location.origin
  )
    throw new Error('파일 전송 주소를 확인하지 못했습니다.');
  return {
    url: url.href,
    method: value.method as 'GET' | 'POST',
    token: value.token,
    expiresAt: value.expiresAt as number,
  };
}
export async function directCompanyUpload(form: FormData, requestKey: string) {
  const grant = await requestFileTransfer(
    await describeCompanyTransfer(form, requestKey),
  );
  return sendTransferUpload(grant, form);
}
export async function directFlowUpload(caseId: string, form: FormData) {
  const intent = await describeFlowTransfer(caseId, form);
  let grant;
  try {
    grant = await requestFileTransfer(intent, form.get('payload') as string);
  } catch (error) {
    // Preserve the original FLOW response/status contract, including automatic
    // state refresh on 409. No file bytes were sent when issuance was rejected.
    if (error instanceof TransferIssuanceError)
      return Response.json(
        { error: error.message },
        {
          status: error.status,
          headers: { 'cache-control': 'private, no-store' },
        },
      );
    throw error;
  }
  return sendTransferUpload(grant, form);
}
function sendTransferUpload(
  grant: { url: string; token: string },
  form: FormData,
) {
  // Never forward the Next cookie or DB service secret. No URL bearer, redirects,
  // automatic retries, or fallback through Vercel after an uncertain result.
  return fetch(grant.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${grant.token}` },
    body: form,
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(120_000),
  });
}
export async function downloadPrivateFile(
  intent: Extract<
    FileTransferIntent,
    { kind: 'company-download' | 'flow-download' }
  >,
  fileName: string,
) {
  const grant = await requestFileTransfer(intent);
  const response = await fetch(grant.url, {
    headers: { authorization: `Bearer ${grant.token}` },
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(120_000),
  });
  return savePrivateDownload(response, fileName);
}
export async function savePrivateDownload(
  response: Response,
  fileName: string,
) {
  if (!response.ok)
    throw new Error(
      '원본을 내려받지 못했습니다. 로그인·담당 권한과 보관 상태를 다시 확인해 주세요.',
    );
  const reader = response.body?.getReader();
  if (!reader) throw new Error('원본 응답을 읽지 못했습니다.');
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_COMPANY_FILE_BYTES) {
      await reader.cancel();
      throw new Error('원본 크기를 확인하지 못했습니다.');
    }
    chunks.push(Uint8Array.from(value));
  }
  if (!total) throw new Error('원본 응답이 비어 있습니다.');
  const url = URL.createObjectURL(
    new Blob(chunks, { type: 'application/octet-stream' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFileName(fileName) || '원본파일';
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
export async function downloadCompanyFile(fileId: string, fileName: string) {
  return downloadPrivateFile({ kind: 'company-download', fileId }, fileName);
}
