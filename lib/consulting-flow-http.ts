import {
  FlowError,
  type FlowCommand,
  type FlowFile,
} from '@/lib/consulting-flow';
import { audioFileProblem, transcriptFileProblem } from './transcript-policy';

export async function boundedBody(request: Request, max: number) {
  if (Number(request.headers.get('content-length') || 0) > max)
    throw new FlowError('첨부 용량이 허용 범위를 초과했습니다.', 413);
  if (!request.body) throw new FlowError('요청 내용이 없습니다.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new FlowError('첨부 용량이 허용 범위를 초과했습니다.', 413);
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export async function parseFlowRequest(request: Request) {
  const multipart = request.headers
    .get('content-type')
    ?.startsWith('multipart/form-data');
  const body = await boundedBody(
    request,
    multipart ? 31 * 1024 * 1024 : 400_000,
  );
  let raw: unknown;
  let file: File | undefined;
  let audio: File | undefined;
  if (multipart) {
    const form = await new Response(body, {
      headers: { 'content-type': request.headers.get('content-type')! },
    }).formData();
    const json = form.get('payload');
    if (typeof json !== 'string')
      throw new FlowError('업로드 요청 내용을 확인해 주세요.');
    raw = JSON.parse(json);
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
    if (!request.headers.get('content-type')?.includes('application/json'))
      throw new FlowError('JSON 형식의 요청이 필요합니다.');
    raw = JSON.parse(new TextDecoder().decode(body));
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
const mime: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  txt: 'text/plain',
  md: 'text/markdown',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
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
  const ext = file.name.split('.').at(-1)?.toLowerCase() || '';
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
  if (!allowed.includes(ext))
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
    name: Array.from(file.name, (c) =>
      c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === '/' || c === '\\'
        ? '_'
        : c,
    )
      .join('')
      .slice(0, 180),
    contentType: mime[ext],
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
