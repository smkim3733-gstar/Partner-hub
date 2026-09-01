import { publicFlow } from '@/lib/consulting-flow-access';
import { runNextFlowJob } from '@/lib/consulting-flow-ai';
import {
  assertFlowLifecycleActive,
  assertSameOrigin,
  flowErrorResponse,
  loadFlowAccess,
  recheckFlowAccess,
} from '@/lib/consulting-flow-store';
export const dynamic = 'force-dynamic';
export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  try {
    assertSameOrigin(request);
    const { flow, user, state } = await loadFlowAccess(
      request,
      (await context.params).caseId,
    );
    assertFlowLifecycleActive(state, flow.caseId);
    const next = await runNextFlowJob(
      flow,
      async () => {
        const access = await recheckFlowAccess(request, flow, user);
        assertFlowLifecycleActive(access.state, flow.caseId);
        return access.statePayload;
      },
    );
    const access = await recheckFlowAccess(request, next, user);
    assertFlowLifecycleActive(access.state, flow.caseId);
    // A partner can run only a previously queued job governed by the representative's policy.
    return Response.json(
      { flow: publicFlow(next) },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return flowErrorResponse(error);
  }
}
