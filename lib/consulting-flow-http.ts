import {
  FlowError,
  type FlowCommand,
  type FlowFile,
} from '@/lib/consulting-flow';
import { safeFileName } from './company-file-policy';
import { uploadFileExtension, uploadFileFormat } from './upload-file-formats';
import { audioFileProblem, transcriptFileProblem } from './transcript-policy';
import { JsonRequestError, readBoundedJsonObject } from './request-json';
import {
  isMultipartFormDataContentType,
  MultipartRequestError,
  readBoundedMultipartFormData,
} from './request-multipart';

export async function readFlowJsonObject(request: Request, maxBytes: number) {
  try {
    return await readBoundedJsonObject(request, maxBytes);
  } catch (error) {
    if (error instanceof JsonRequestError)
      throw new FlowError(error.message, error.status);
    throw error;
  }
}
export async function readFlowMultipartFormData(
  request: Request,
  maxBytes: number,
) {
  try {
    return await readBoundedMultipartFormData(request, maxBytes);
  } catch (error) {
    if (error instanceof MultipartRequestError)
      throw new FlowError(error.message, error.status);
    throw error;
  }
}
export async function parseFlowRequest(request: Request) {
  const contentType = request.headers.get('content-type') ?? '';
  const multipart = isMultipartFormDataContentType(contentType);
  let raw: unknown;
  let file: File | undefined;
  let audio: File | undefined;
  if (multipart) {
    const form = await readFlowMultipartFormData(request, 31 * 1024 * 1024);
    const json = form.get('payload');
    if (typeof json !== 'string')
      throw new FlowError('업로드 요청 내용을 확인해 주세요.');
    try {
      raw = JSON.parse(json);
    } catch {
      throw new FlowError('업로드 요청 내용을 확인해 주세요.');
    }
    const attachment = form.get('file');
    if (attachment instanceof File && attachment.size) file = attachment;
    const recording = form.get('audio');
    if (recording instanceof File && recording.size) audio = recording;
    if (
      form.getAll('file').length > 1 ||
      form.getAll('audio').length > 1 ||
      form.getAll('payload').length !== 1
    )
      throw new FlowError('전사문 1개와 보조 음성 1개만 첨부해 주세요.');
  } else {
    raw = await readFlowJsonObject(request, 400_000);
  }
  const value = raw as {
    commandId?: unknown;
    revision?: unknown;
    command?: FlowCommand;
  } | null;
  if (
    !value ||
    typeof value.commandId !== 'string' ||
    !Number.isSafeInteger(value.revision) ||
    !value.command ||
    typeof value.command.type !== 'string'
  )
    throw new FlowError('요청 식별값과 변경 내용을 확인해 주세요.');
  return {
    commandId: value.commandId,
    revision: value.revision as number,
    command: value.command,
    file,
    audio,
  };
}
export function describeUpload(
  file: File,
  command: FlowCommand,
  now: string,
  slot: 'file' | 'audio' = 'file',
): FlowFile {
  if (slot === 'audio' && command.type !== 'save_recording')
    throw new FlowError(
      '보조 음성은 상담 녹취자료 등록에만 첨부할 수 있습니다.',
    );
  const purpose = (
    {
      save_source: 'source',
      save_report: 'report',
      save_recording: 'recording',
      save_transcript: 'transcript',
      receive_document: 'requested_document',
      record_contract: 'signed_contract',
    } as Record<string, string>
  )[command.type];
  if (!purpose)
    throw new FlowError('이 작업에는 첨부파일을 등록할 수 없습니다.');
  if (command.fileConsent !== true)
    throw new FlowError(
      '첨부자료의 저장·담당 파트너 공유 권한을 확인해 주세요.',
    );
  if (file.size > 25 * 1024 * 1024)
    throw new FlowError('첨부파일은 25MB 이하여야 합니다.', 413);
  const ext = uploadFileExtension(file.name);
  const allowed =
    slot === 'audio'
      ? ['mp3', 'm4a', 'wav']
      : purpose === 'transcript'
        ? ['docx', 'txt']
        : purpose === 'recording'
          ? ['mp3', 'm4a', 'wav', 'docx', 'txt']
          : purpose === 'signed_contract'
            ? ['pdf', 'jpg', 'jpeg', 'png']
            : purpose === 'report'
              ? ['pdf', 'docx', 'pptx', 'txt', 'md']
              : ['pdf', 'jpg', 'jpeg', 'png', 'docx', 'xlsx', 'txt'];
  const format = uploadFileFormat(ext);
  if (!allowed.includes(ext) || !format)
    throw new FlowError(
      `이 자료는 ${allowed.join(', ')} 형식으로 첨부해 주세요.`,
    );
  const problem = ['recording', 'transcript'].includes(purpose)
    ? ['docx', 'txt'].includes(ext)
      ? transcriptFileProblem(file)
      : audioFileProblem(file)
    : '';
  if (problem) throw new FlowError(problem);
  const id = crypto.randomUUID();
  return {
    id,
    name: safeFileName(file.name),
    contentType: format.contentType,
    size: file.size,
    key: `consulting-flow/${id}`,
    createdAt: now,
    purpose,
  };
}
export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
}
