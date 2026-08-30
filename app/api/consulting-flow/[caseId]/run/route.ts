import { publicFlow } from '@/lib/consulting-flow-access';
import { runNextFlowJob } from '@/lib/consulting-flow-ai';
import {
  assertSameOrigin,
  flowErrorResponse,
  loadFlowAccess,
} from '@/lib/consulting-flow-store';
export const dynamic = 'force-dynamic';
export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  try {
    assertSameOrigin(request);
    const { flow } = await loadFlowAccess(
      request,
      (await context.params).caseId,
    );
    // A partner can run only a previously queued job governed by the representative's policy.
    return Response.json(
      { flow: publicFlow(await runNextFlowJob(flow)) },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return flowErrorResponse(error);
  }
}
