import { MAX_COMPANY_FILE_BYTES } from './company-file-policy';
import { fileDigest } from './file-digest';
import { flowUploadPurpose } from './consulting-flow-upload-policy';
import type { FlowCommand } from './consulting-flow';

export const fileTransferPath = '/v1/files/transfer';
export const fileTransferLifetimeSeconds = 120;
export const fileTransferRequestMaxBytes = 1024 * 1024;
export const flowTransferPayloadMaxBytes = 400_000;
export type TransferFile = {
  name: string;
  size: number;
  type: string;
  sha256: string;
};
export const companyTransferFields = [
  'company',
  'title',
  'category',
  'assignedTrainee',
  'partnerMemberId',
  'caseId',
  'consent',
  'recordingConsent',
  'expectedUserId',
] as const;
export type CompanyTransferUpload = {
  kind: 'company-upload';
  requestKey: string;
  fields: Record<string, string>;
  file: TransferFile;
};
export type FlowTransferUpload = {
  kind: 'flow-upload';
  caseId: string;
  commandId: string;
  revision: number;
  commandType: string;
  payloadSha256: string;
  files: Partial<Record<'file' | 'audio', TransferFile>>;
};
export type FileTransferIntent =
  | CompanyTransferUpload
  | { kind: 'company-download'; fileId: string }
  | FlowTransferUpload
  | { kind: 'flow-download'; caseId: string; fileId: string };
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).sort().join(',') === keys.sort().join(',');
}
function resourceId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 120 &&
    value === value.trim() &&
    !Array.from(value).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  );
}
function commandId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(value);
}
function parseTransferFile(value: unknown): TransferFile {
  if (
    !object(value) ||
    !exactKeys(value, ['name', 'size', 'type', 'sha256']) ||
    typeof value.name !== 'string' ||
    !value.name ||
    value.name.length > 512 ||
    Array.from(value.name).some((character) => character.charCodeAt(0) < 32) ||
    !Number.isSafeInteger(value.size) ||
    (value.size as number) <= 0 ||
    (value.size as number) > MAX_COMPANY_FILE_BYTES ||
    typeof value.type !== 'string' ||
    value.type.length > 127 ||
    /[^\x20-\x7e]/.test(value.type) ||
    typeof value.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.sha256)
  )
    throw new Error('Invalid transfer file');
  // Multipart supplies the default MIME for a browser File with an empty type.
  return {
    name: value.name,
    size: value.size as number,
    type: value.type || 'application/octet-stream',
    sha256: value.sha256,
  };
}
export function fileTransferMethod(intent: FileTransferIntent) {
  return intent.kind === 'company-upload' || intent.kind === 'flow-upload'
    ? 'POST'
    : 'GET';
}
export function fileTransferBusinessPath(intent: FileTransferIntent) {
  switch (intent.kind) {
    case 'company-upload':
      return '/api/files';
    case 'company-download':
      return `/api/files/${encodeURIComponent(intent.fileId)}`;
    case 'flow-upload':
      return `/api/consulting-flow/${encodeURIComponent(intent.caseId)}`;
    case 'flow-download':
      return `/api/consulting-flow/${encodeURIComponent(intent.caseId)}/files/${encodeURIComponent(intent.fileId)}`;
  }
}
export function parseFileTransferIntent(value: unknown): FileTransferIntent {
  if (!object(value)) throw new Error('Invalid file transfer intent');
  if (
    value.kind === 'flow-download' &&
    exactKeys(value, ['kind', 'caseId', 'fileId']) &&
    resourceId(value.caseId) &&
    resourceId(value.fileId)
  )
    return {
      kind: 'flow-download',
      caseId: value.caseId,
      fileId: value.fileId,
    };
  if (value.kind === 'flow-upload') {
    if (
      !exactKeys(value, [
        'kind',
        'caseId',
        'commandId',
        'revision',
        'commandType',
        'payloadSha256',
        'files',
      ]) ||
      !resourceId(value.caseId) ||
      !commandId(value.commandId) ||
      !Number.isSafeInteger(value.revision) ||
      (value.revision as number) < 0 ||
      typeof value.commandType !== 'string' ||
      !flowUploadPurpose({ type: value.commandType }) ||
      typeof value.payloadSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.payloadSha256) ||
      !object(value.files) ||
      Object.keys(value.files).some(
        (key) => key !== 'file' && key !== 'audio',
      ) ||
      Object.keys(value.files).length === 0
    )
      throw new Error('Invalid FLOW transfer intent');
    const files: FlowTransferUpload['files'] = {};
    for (const slot of ['file', 'audio'] as const)
      if (Object.hasOwn(value.files, slot))
        files[slot] = parseTransferFile(value.files[slot]);
    if (
      (files.audio && value.commandType !== 'save_recording') ||
      Object.values(files).reduce((sum, file) => sum + file.size, 0) >
        30 * 1024 * 1024
    )
      throw new Error('Invalid FLOW transfer slots');
    return {
      kind: 'flow-upload',
      caseId: value.caseId,
      commandId: value.commandId,
      revision: value.revision as number,
      commandType: value.commandType,
      payloadSha256: value.payloadSha256,
      files,
    };
  }
  if (
    value.kind === 'company-download' &&
    exactKeys(value, ['kind', 'fileId']) &&
    typeof value.fileId === 'string' &&
    /^[a-zA-Z0-9-]{10,80}$/.test(value.fileId)
  )
    return { kind: value.kind, fileId: value.fileId };
  if (
    value.kind !== 'company-upload' ||
    !exactKeys(value, ['kind', 'requestKey', 'fields', 'file']) ||
    typeof value.requestKey !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.requestKey) ||
    !object(value.fields)
  )
    throw new Error('Invalid file transfer intent');
  const { fields } = value;
  const file = parseTransferFile(value.file);
  if (
    Object.keys(fields).some(
      (key) => !(companyTransferFields as readonly string[]).includes(key),
    ) ||
    Object.values(fields).some(
      (field) => typeof field !== 'string' || field.length > 1000,
    ) ||
    JSON.stringify(fields).length > 4000
  )
    throw new Error('Invalid file transfer intent');
  return {
    kind: 'company-upload',
    requestKey: value.requestKey,
    fields: Object.fromEntries(
      Object.entries(fields).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    ) as Record<string, string>,
    file,
  };
}
export async function describeCompanyTransfer(
  form: FormData,
  requestKey: string,
): Promise<CompanyTransferUpload> {
  const file = form.get('file');
  if (!(file instanceof File) || form.getAll('file').length !== 1)
    throw new Error('Invalid transfer file');
  const fields: Record<string, string> = {};
  for (const [key, value] of form) {
    if (key === 'file') continue;
    if (
      !(companyTransferFields as readonly string[]).includes(key) ||
      typeof value !== 'string' ||
      Object.hasOwn(fields, key)
    )
      throw new Error('Invalid transfer field');
    fields[key] = value;
  }
  const intent = parseFileTransferIntent({
    kind: 'company-upload',
    requestKey,
    fields,
    file: {
      name: file.name,
      type: file.type,
      size: file.size,
      sha256: await fileDigest(await file.arrayBuffer()),
    },
  });
  if (intent.kind !== 'company-upload')
    throw new Error('Invalid transfer kind');
  return intent;
}

export function parseFlowTransferPayload(payload: unknown) {
  if (
    typeof payload !== 'string' ||
    new TextEncoder().encode(payload).byteLength > flowTransferPayloadMaxBytes
  )
    throw new Error('Invalid FLOW transfer payload');
  const value: unknown = JSON.parse(payload);
  if (
    !object(value) ||
    !exactKeys(value, ['commandId', 'revision', 'command']) ||
    !commandId(value.commandId) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    !object(value.command) ||
    typeof value.command.type !== 'string' ||
    !flowUploadPurpose({ type: value.command.type }) ||
    value.command.fileConsent !== true
  )
    throw new Error('Invalid FLOW transfer command or consent');
  return {
    commandId: value.commandId,
    revision: value.revision as number,
    command: value.command as FlowCommand,
  };
}
export async function describeFlowTransfer(
  caseId: string,
  form: FormData,
): Promise<FlowTransferUpload> {
  for (const key of form.keys())
    if (
      !['payload', 'file', 'audio'].includes(key) ||
      form.getAll(key).length !== 1
    )
      throw new Error('Invalid FLOW transfer fields');
  const payload = form.get('payload');
  const input = parseFlowTransferPayload(payload);
  const files: FlowTransferUpload['files'] = {};
  for (const slot of ['file', 'audio'] as const) {
    if (!form.has(slot)) continue;
    const file = form.get(slot);
    if (!(file instanceof File)) throw new Error('Invalid FLOW transfer file');
    files[slot] = parseTransferFile({
      name: file.name,
      size: file.size,
      type: file.type,
      sha256: await fileDigest(await file.arrayBuffer()),
    });
  }
  const intent = parseFileTransferIntent({
    kind: 'flow-upload',
    caseId,
    commandId: input.commandId,
    revision: input.revision,
    commandType: input.command.type,
    payloadSha256: await fileDigest(payload as string),
    files,
  });
  if (intent.kind !== 'flow-upload')
    throw new Error('Invalid FLOW transfer kind');
  return intent;
}
