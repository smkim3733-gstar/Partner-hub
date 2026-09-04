import {
  uploadFileAccept,
  type UploadFileExtension,
} from './upload-file-formats';
import { MAX_AI_SOURCE_BYTES } from './intake-source-policy';
import {
  MAX_AUDIO_BYTES,
  MAX_TRANSCRIPT_FILE_BYTES,
} from './transcript-policy';

export type FlowUploadPurpose =
  | 'source'
  | 'report'
  | 'recording'
  | 'transcript'
  | 'requested_document'
  | 'signed_contract';

export type FlowUploadCommand = { type: string; stage?: unknown };
export type FlowUploadSlot = 'file' | 'audio' | 'document';
export const MAX_FLOW_UPLOAD_BYTES = 25 * 1024 * 1024;

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
