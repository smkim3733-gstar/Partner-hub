import { FlowError } from '@/lib/consulting-flow';
import {
  flowBucket,
  flowErrorResponse,
  loadFlowAccess,
} from '@/lib/consulting-flow-store';
export const dynamic = 'force-dynamic';
export async function GET(
  request: Request,
  context: { params: Promise<{ caseId: string; fileId: string }> },
) {
  try {
    const { caseId, fileId } = await context.params;
    const { flow } = await loadFlowAccess(request, caseId);
    const file = flow.files.find((f) => f.id === fileId);
    if (!file) throw new FlowError('첨부파일을 찾을 수 없습니다.', 404);
    const object = await flowBucket().get(file.key);
    if (!object)
      throw new FlowError('저장된 첨부파일을 찾을 수 없습니다.', 404);
    return new Response(object.body, {
      headers: {
        'content-type': file.contentType,
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return flowErrorResponse(error);
  }
}
