import { upload } from '@vercel/blob/client';
import {
  describeCompanyTransfer,
  describeFlowTransfer,
  parseFileTransferIntent,
  fileTransferBusinessPath,
  type FileTransferIntent,
} from './file-transfer-contract';
import { savePrivateDownload } from './file-transfer-client';

const endpoint = '/api/blob-transfers';
function command(body: unknown) {
  return fetch(endpoint, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
}
async function send(intent: FileTransferIntent, form: FormData) {
  const prepared = await command({
    action: 'prepare',
    intent:
      intent.kind === 'flow-upload'
        ? { ...intent, payload: form.get('payload') }
        : intent,
  });
  if (!prepared.ok) return prepared;
  const grant = (await prepared.json()) as {
    id: string;
    expiresAt: number;
    paths: Record<string, string>;
  };
  const files = [...form].filter(
    (entry): entry is [string, File] => entry[1] instanceof File,
  );
  if (
    !/^[a-f0-9-]{36}$/.test(grant.id) ||
    !Number.isSafeInteger(grant.expiresAt) ||
    grant.expiresAt <= Date.now() ||
    grant.expiresAt > Date.now() + 601_000 ||
    !grant.paths ||
    Object.keys(grant.paths).length !== files.length
  )
    throw new Error('파일 전송 응답을 확인하지 못했습니다.');
  for (const [slot, file] of files) {
    const path = `partner-hub/staging/${grant.id}/${slot}`;
    if (!['file', 'audio'].includes(slot) || grant.paths[slot] !== path)
      throw new Error('파일 전송 범위를 확인하지 못했습니다.');
    await upload(path, file, {
      access: 'private',
      handleUploadUrl: endpoint,
      clientPayload: grant.id,
      contentType: 'application/octet-stream',
      multipart: false,
      abortSignal: AbortSignal.timeout(120_000),
    });
  }
  // Do not automatically replay an uncertain business commit. The existing
  // stable request/command key makes an explicit user retry idempotent.
  return command({ action: 'finish', id: grant.id });
}
export async function directCompanyUpload(form: FormData, requestKey: string) {
  return send(await describeCompanyTransfer(form, requestKey), form);
}
export async function directFlowUpload(caseId: string, form: FormData) {
  return send(await describeFlowTransfer(caseId, form), form);
}
export async function downloadPrivateFile(
  intent: Extract<
    FileTransferIntent,
    { kind: 'company-download' | 'flow-download' }
  >,
  fileName: string,
) {
  const validated = parseFileTransferIntent(intent);
  if (
    validated.kind !== 'company-download' &&
    validated.kind !== 'flow-download'
  )
    throw new Error('잘못된 다운로드 요청입니다.');
  // Authorized streaming response: no public Blob URL, read token, proxy Worker
  // or long-lived signed link. Every request rechecks the current session.
  const response = await fetch(fileTransferBusinessPath(validated), {
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(120_000),
  });
  return savePrivateDownload(response, fileName);
}
export async function downloadCompanyFile(fileId: string, fileName: string) {
  return downloadPrivateFile({ kind: 'company-download', fileId }, fileName);
}
