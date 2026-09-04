import {
  previewFileRecovery,
  recoverFile,
  recoveryError,
} from '@/lib/file-recovery-store';
import { assertSameOrigin } from '@/lib/consulting-flow-store';
export const dynamic = 'force-dynamic';
const json = (value: unknown) =>
  Response.json(value, { headers: { 'cache-control': 'private, no-store' } });
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return json(await previewFileRecovery(request, (await context.params).id));
  } catch (error) {
    return recoveryError(error);
  }
}
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    return json(await recoverFile(request, (await context.params).id));
  } catch (error) {
    return recoveryError(error);
  }
}
