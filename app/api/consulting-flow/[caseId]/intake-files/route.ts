import {
  listIntakeSources,
  previewIntakeSource,
  requireIntakeReviewer,
} from '@/lib/consulting-intake-sources';
import { loadFlowAccess, flowErrorResponse } from '@/lib/consulting-flow-store';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ caseId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { user, flow } = await loadFlowAccess(
      request,
      (await context.params).caseId,
    );
    requireIntakeReviewer(user);
    const params = new URL(request.url).searchParams;
    const result = params.has('fileId')
      ? await previewIntakeSource(flow, params.get('fileId'))
      : await listIntakeSources(flow);
    return Response.json(result, {
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch (error) {
    return flowErrorResponse(error);
  }
}
