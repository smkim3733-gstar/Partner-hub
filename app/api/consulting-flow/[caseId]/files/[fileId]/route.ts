import { FlowError } from '@/lib/consulting-flow';
import {
  flowBucket,
  flowErrorResponse,
  loadFlowAccess,
  recheckFlowAccess,
} from '@/lib/consulting-flow-store';
import { readRouteParam } from '@/lib/request-path';
import { privateResponseHeaders } from '@/lib/private-response';
export const dynamic = 'force-dynamic';
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
      const access = await recheckFlowAccess(request, flow, user);
      if (
        !access.flow.files.some(
          (item) => item.id === file.id && item.key === file.key,
        )
      )
        throw new FlowError('첨부파일 접근 상태가 변경되었습니다.', 404);
    } catch (error) {
      await object.body.cancel().catch(() => {});
      throw error;
    }
    return new Response(object.body, {
      headers: privateResponseHeaders({
        'content-type': file.contentType,
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      }),
    });
  } catch (error) {
    return flowErrorResponse(error);
  }
}
