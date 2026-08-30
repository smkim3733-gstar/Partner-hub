import { applyFlowCommand, FlowError } from '@/lib/consulting-flow';
import { publicFlow } from '@/lib/consulting-flow-access';
import { describeUpload, parseFlowRequest } from '@/lib/consulting-flow-http';
import {
  assertSameOrigin,
  commitFlow,
  flowBucket,
  flowErrorResponse,
  flowReadiness,
  loadFlowAccess,
} from '@/lib/consulting-flow-store';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ caseId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { flow, user } = await loadFlowAccess(
      request,
      (await context.params).caseId,
    );
    return Response.json(
      {
        flow: publicFlow(flow),
        role: user.role === 'admin' ? 'admin' : 'partner',
        readiness: flowReadiness(),
        canUpload:
          user.role === 'admin' || Boolean(user.permissions?.fileUpload),
      },
      { headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (error) {
    return flowErrorResponse(error);
  }
}
export async function POST(request: Request, context: Context) {
  let uploadedKeys: string[] = [];
  try {
    assertSameOrigin(request);
    const { flow, user } = await loadFlowAccess(
      request,
      (await context.params).caseId,
    );
    const input = await parseFlowRequest(request);
    if (flow.commandIds.includes(input.commandId))
      return Response.json(
        { flow: publicFlow(flow), duplicate: true },
        { headers: { 'cache-control': 'no-store' } },
      );
    if (input.revision !== flow.revision)
      throw new FlowError(
        '다른 변경이 있습니다. 새로고침 후 내용을 확인해 주세요.',
        409,
      );
    if (
      (input.file || input.audio) &&
      user.role !== 'admin' &&
      !user.permissions?.fileUpload
    )
      throw new FlowError('자료 업로드 권한이 필요합니다.', 403);
    const now = new Date().toISOString();
    const upload = input.file
      ? describeUpload(input.file, input.command, now)
      : undefined;
    const audioUpload = input.audio
      ? describeUpload(input.audio, input.command, now, 'audio')
      : undefined;
    if (input.audio && input.file && /\.(mp3|m4a|wav)$/i.test(input.file.name))
      throw new FlowError('음성은 보조 첨부 1개만 등록해 주세요.');
    const next = applyFlowCommand(
      flow,
      input.command,
      {
        id: user.memberId || user.id,
        role: user.role === 'admin' ? 'admin' : 'partner',
        name: user.role === 'admin' ? '김성민 대표' : flow.partnerName,
      },
      { commandId: input.commandId, now, upload, audioUpload },
    );
    if (upload && input.file) {
      await flowBucket().put(upload.key, input.file.stream(), {
        httpMetadata: { contentType: upload.contentType },
      });
      uploadedKeys.push(upload.key);
    }
    if (audioUpload && input.audio) {
      await flowBucket().put(audioUpload.key, input.audio.stream(), {
        httpMetadata: { contentType: audioUpload.contentType },
      });
      uploadedKeys.push(audioUpload.key);
    }
    await commitFlow(flow, next);
    uploadedKeys = [];
    return Response.json(
      { flow: publicFlow(next) },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (uploadedKeys.length) {
      // A failed/ambiguous DB response must never delete a successfully referenced file.
      try {
        const { flow } = await loadFlowAccess(
          request,
          (await context.params).caseId,
        );
        for (const key of uploadedKeys) {
          if (!flow.files.some((f) => f.key === key))
            await flowBucket().delete(key);
        }
      } catch {
        /* Keep the private object for reconciliation when persistence is uncertain. */
      }
    }
    return flowErrorResponse(error);
  }
}
