import {
  describeCompanyTransfer,
  describeFlowTransfer,
  parseFileTransferIntent,
  fileTransferBusinessPath,
  type FileTransferIntent,
} from './file-transfer-contract';
import { savePrivateDownload } from './file-transfer-client';

type Upload = {
  path: string;
  url: string;
  method: 'PUT';
  headers: { 'content-type': string };
};
type Grant = { id: string; expiresAt: number; uploads: Record<string, Upload> };
const uuid =
  '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const failure = () => new Error('파일 전송 응답을 확인하지 못했습니다.');
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: object, expected: string[]) {
  return Object.keys(value).sort().join(',') === expected.sort().join(',');
}
export function parseSupabaseTransferGrant(
  value: unknown,
  slots: string[],
): Grant {
  if (
    !record(value) ||
    !keys(value, ['id', 'expiresAt', 'uploads']) ||
    typeof value.id !== 'string' ||
    !new RegExp(`^${uuid}$`).test(value.id) ||
    !Number.isSafeInteger(value.expiresAt) ||
    (value.expiresAt as number) <= Date.now() ||
    (value.expiresAt as number) > Date.now() + 601_000 ||
    !record(value.uploads) ||
    !keys(value.uploads, [...slots]) ||
    slots.some((slot) => !['file', 'audio'].includes(slot))
  )
    throw failure();
  const origins = new Set<string>(),
    paths = new Set<string>();
  for (const upload of Object.values(value.uploads)) {
    if (
      !record(upload) ||
      !keys(upload, ['path', 'url', 'method', 'headers']) ||
      typeof upload.path !== 'string' ||
      !new RegExp(`^partner-hub/staging/v1/${uuid}$`).test(upload.path) ||
      typeof upload.url !== 'string' ||
      upload.url.length > 8192 ||
      upload.method !== 'PUT' ||
      !record(upload.headers) ||
      !keys(upload.headers, ['content-type']) ||
      upload.headers['content-type'] !== 'application/octet-stream'
    )
      throw failure();
    const url = new URL(upload.url);
    if (
      !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url.origin) ||
      url.username ||
      url.password ||
      url.hash ||
      !new RegExp(
        `^/storage/v1/object/upload/sign/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?/${upload.path}$`,
      ).test(url.pathname) ||
      !/^\?token=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(
        url.search,
      ) ||
      url.href !== upload.url ||
      paths.has(upload.path)
    )
      throw failure();
    origins.add(url.origin);
    paths.add(upload.path);
  }
  if (origins.size !== 1) throw failure();
  return value as Grant;
}
function command(body: unknown) {
  return fetch('/api/blob-transfers', {
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
  const files = [...form].filter(
    (entry): entry is [string, File] => entry[1] instanceof File,
  );
  const grant = parseSupabaseTransferGrant(
    await prepared.json(),
    files.map(([slot]) => slot),
  );
  for (const [slot, file] of files) {
    if (Date.now() >= grant.expiresAt) throw failure();
    const upload = grant.uploads[slot];
    // Only the single-purpose staging capability leaves this origin. Never
    // forward app cookies, service keys, public read links or arbitrary headers.
    const result = await fetch(upload.url, {
      method: 'PUT',
      headers: upload.headers,
      body: file,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(
        Math.min(120_000, grant.expiresAt - Date.now()),
      ),
    });
    await result.body?.cancel().catch(() => {});
    if (!result.ok)
      throw new Error(
        '파일 전송을 완료하지 못했습니다. 원본을 보존하고 다시 시도해 주세요.',
      );
  }
  if (Date.now() >= grant.expiresAt) throw failure();
  // Stable business keys make an explicit retry safe; do not automatically
  // repeat an uncertain provider write or business commit.
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
    throw failure();
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
