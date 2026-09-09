import {
  getConsultingFlow,
  postConsultingFlow,
} from '@/lib/consulting-flow-handlers';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ caseId: string }> };
export async function GET(request: Request, context: Context) {
  return getConsultingFlow(request, context);
}
export async function POST(request: Request, context: Context) {
  return postConsultingFlow(request, context);
}
