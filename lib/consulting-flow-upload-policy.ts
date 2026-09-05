import {
  uploadFileAccept,
  uploadFileExtension,
  uploadFileFormat,
  type UploadFileExtension,
} from './upload-file-formats';
import { MAX_AI_SOURCE_BYTES } from './intake-source-policy';
import {
  MAX_AUDIO_BYTES,
  MAX_TRANSCRIPT_FILE_BYTES,
} from './transcript-policy';

export const storedFlowFilePurposes = [
  'source',
  'source_archived',
  'report',
  'recording',
  'transcript',
  'requested_document',
  'signed_contract',
] as const;
export type StoredFlowFilePurpose = (typeof storedFlowFilePurposes)[number];
export type FlowUploadPurpose = Exclude<
  StoredFlowFilePurpose,
  'source_archived'
>;

export type FlowUploadCommand = { type: string; stage?: unknown };
export type FlowUploadSlot = 'file' | 'audio' | 'document';
export const MAX_FLOW_UPLOAD_BYTES = 25 * 1024 * 1024;

export function isStoredFlowFilePurpose(
  value: unknown,
): value is StoredFlowFilePurpose {
  return (
    typeof value === 'string' &&
    storedFlowFilePurposes.includes(value as StoredFlowFilePurpose)
  );
}

export function storedFlowFileMaxBytes(purpose: unknown, name: unknown) {
  if (!isStoredFlowFilePurpose(purpose) || typeof name !== 'string')
    return undefined;
  if (purpose === 'source' || purpose === 'source_archived')
    return MAX_AI_SOURCE_BYTES;
  if (
    purpose === 'transcript' ||
    (purpose === 'recording' &&
      ['docx', 'txt'].includes(uploadFileExtension(name)))
  )
    return MAX_TRANSCRIPT_FILE_BYTES;
  return MAX_FLOW_UPLOAD_BYTES;
}

const audioExtensions = ['mp3', 'm4a', 'wav'] as const;
const transcriptExtensions = ['docx', 'txt'] as const;
const recordingExtensions = [
  ...audioExtensions,
  ...transcriptExtensions,
] as const;
const sourceExtensions = ['pdf', 'jpg', 'jpeg', 'png', 'txt'] as const;
const reportExtensions = ['pdf', 'docx', 'txt', 'md'] as const;
const presentationExtensions = ['pptx', 'pdf'] as const;
const requestedDocumentExtensions = [
  'pdf',
  'jpg',
  'jpeg',
  'png',
  'docx',
  'xlsx',
  'txt',
] as const;
const signedContractExtensions = ['pdf', 'jpg', 'jpeg', 'png'] as const;
const storedReportExtensions = [...reportExtensions, 'pptx'] as const;
const storedFlowFileExtensionsByPurpose = {
  source: sourceExtensions,
  source_archived: sourceExtensions,
  report: storedReportExtensions,
  recording: recordingExtensions,
  transcript: transcriptExtensions,
  requested_document: requestedDocumentExtensions,
  signed_contract: signedContractExtensions,
} as const satisfies Record<
  StoredFlowFilePurpose,
  readonly UploadFileExtension[]
>;

export const storedFlowFileExtensionRules = storedFlowFilePurposes.flatMap(
  (purpose) =>
    storedFlowFileExtensionsByPurpose[purpose].map((extension) => ({
      purpose,
      extension,
    })),
);

export function storedFlowFileExtensions(
  purpose: unknown,
): readonly UploadFileExtension[] | undefined {
  return isStoredFlowFilePurpose(purpose)
    ? storedFlowFileExtensionsByPurpose[purpose]
    : undefined;
}

export function storedFlowFileFormat(purpose: unknown, name: unknown) {
  if (typeof name !== 'string') return undefined;
  const extension = uploadFileExtension(name);
  if (
    !storedFlowFileExtensions(purpose)?.some((allowed) => allowed === extension)
  )
    return undefined;
  return uploadFileFormat(extension);
}

const purposeByCommand = {
  save_source: 'source',
  save_report: 'report',
  save_recording: 'recording',
  save_transcript: 'transcript',
  receive_document: 'requested_document',
  record_contract: 'signed_contract',
} as const satisfies Record<string, FlowUploadPurpose>;

export function flowUploadPurpose(command: FlowUploadCommand) {
  return purposeByCommand[command.type as keyof typeof purposeByCommand];
}

export function flowUploadExtensions(
  command: FlowUploadCommand,
  slot: FlowUploadSlot = 'file',
): readonly UploadFileExtension[] | undefined {
  if (slot === 'audio')
    return command.type === 'save_recording' ? audioExtensions : undefined;
  if (slot === 'document')
    return ['save_recording', 'save_transcript'].includes(command.type)
      ? transcriptExtensions
      : undefined;
  switch (command.type) {
    case 'save_source':
      return sourceExtensions;
    case 'save_report':
      return Number(command.stage) === 3
        ? presentationExtensions
        : reportExtensions;
    case 'save_recording':
      return recordingExtensions;
    case 'save_transcript':
      return transcriptExtensions;
    case 'receive_document':
      return requestedDocumentExtensions;
    case 'record_contract':
      return signedContractExtensions;
    default:
      return undefined;
  }
}

export function flowUploadAccept(
  command: FlowUploadCommand,
  slot: FlowUploadSlot = 'file',
) {
  const extensions = flowUploadExtensions(command, slot);
  return extensions ? uploadFileAccept(extensions) : undefined;
}

export function flowUploadAllows(
  command: FlowUploadCommand,
  extension: string,
  slot: FlowUploadSlot = 'file',
) {
  return (
    flowUploadExtensions(command, slot)?.some(
      (allowed) => allowed === extension,
    ) ?? false
  );
}

export function flowUploadMaxBytes(
  command: FlowUploadCommand,
  slot: FlowUploadSlot = 'file',
  extension = '',
) {
  if (!flowUploadExtensions(command, slot)) return undefined;
  if (command.type === 'save_source' && slot === 'file')
    return MAX_AI_SOURCE_BYTES;
  if (
    slot === 'document' ||
    (slot === 'file' &&
      ['save_recording', 'save_transcript'].includes(command.type) &&
      ['docx', 'txt'].includes(extension))
  )
    return MAX_TRANSCRIPT_FILE_BYTES;
  if (slot === 'audio') return MAX_AUDIO_BYTES;
  return MAX_FLOW_UPLOAD_BYTES;
}

export function flowUploadMaxMegabytes(
  command: FlowUploadCommand,
  slot: FlowUploadSlot = 'file',
  extension = '',
) {
  const bytes = flowUploadMaxBytes(command, slot, extension);
  return bytes === undefined ? undefined : bytes / (1024 * 1024);
}
