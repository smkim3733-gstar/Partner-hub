import {
  listIntakeSources,
  previewIntakeSource,
  requireIntakeReviewer,
} from '@/lib/consulting-intake-sources';
import { loadFlowAccess, flowErrorResponse } from '@/lib/consulting-flow-store';
import { readSingleQueryParam } from '@/lib/request-query';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ caseId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { user, flow } = await loadFlowAccess(
      request,
      (await context.params).caseId,
    );
    requireIntakeReviewer(user);
    const fileId = readSingleQueryParam(new URL(request.url), 'fileId', 120);
    const result =
      fileId !== null
        ? await previewIntakeSource(flow, fileId)
        : await listIntakeSources(flow);
    return Response.json(result, {
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch (error) {
    return flowErrorResponse(error);
  }
}
