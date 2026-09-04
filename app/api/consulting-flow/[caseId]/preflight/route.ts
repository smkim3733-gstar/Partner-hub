import { FlowError } from '@/lib/consulting-flow';
import { inspectFirstReport } from '@/lib/consulting-report-preflight';
import { flowErrorResponse, loadFlowAccess } from '@/lib/consulting-flow-store';
import { privateJsonResponse } from '@/lib/private-response';

export const dynamic = 'force-dynamic';
export async function GET(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  try {
    const { user, flow } = await loadFlowAccess(
      request,
      (await context.params).caseId,
    );
    if (user.role !== 'admin')
      throw new FlowError('1차 AI 생성 사전점검은 대표만 할 수 있습니다.', 403);
    return privateJsonResponse(await inspectFirstReport(flow));
  } catch (error) {
    return flowErrorResponse(error);
  }
}
