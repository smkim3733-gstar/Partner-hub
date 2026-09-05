import { FlowError } from '@/lib/consulting-flow';
import {
  flowBucket,
  flowErrorResponse,
  loadFlowAccess,
  recheckFlowAccess,
} from '@/lib/consulting-flow-store';
import { readRouteParam } from '@/lib/request-path';
import { privateResponseHeaders } from '@/lib/private-response';
import { attachmentContentDisposition } from '@/lib/content-disposition';
import { downloadContentType } from '@/lib/download-content-type';
export const dynamic = 'force-dynamic';

function attachmentStorageConflict() {
  return new FlowError(
    '첨부파일 보관 상태가 저장 원장과 일치하지 않습니다. 관리자에게 확인해 주세요.',
    409,
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ caseId: string; fileId: string }> },
) {
  try {
    const { caseId, fileId: rawFileId } = await context.params;
    const { flow, user } = await loadFlowAccess(request, caseId);
    const fileId = readRouteParam(
      rawFileId,
      120,
      '첨부파일 식별값을 확인해 주세요.',
    );
    const file = flow.files.find((f) => f.id === fileId);
    if (!file) throw new FlowError('첨부파일을 찾을 수 없습니다.', 404);
    const object = await flowBucket().get(file.key);
    if (!object)
      throw new FlowError('저장된 첨부파일을 찾을 수 없습니다.', 404);
    try {
      if (object.size !== file.size) throw attachmentStorageConflict();
      const access = await recheckFlowAccess(request, flow, user);
      const currentFile = access.flow.files.find((item) => item.id === file.id);
      if (!currentFile || currentFile.key !== file.key)
        throw new FlowError('첨부파일 접근 상태가 변경되었습니다.', 404);
      if (
        currentFile.name !== file.name ||
        currentFile.size !== file.size ||
        object.size !== currentFile.size
      )
        throw attachmentStorageConflict();
    } catch (error) {
      await object.body.cancel().catch(() => {});
      throw error;
    }
    return new Response(object.body, {
      headers: privateResponseHeaders({
        'content-type': downloadContentType(file.name),
        'content-disposition': attachmentContentDisposition(file.name),
      }),
    });
  } catch (error) {
    return flowErrorResponse(error);
  }
}
