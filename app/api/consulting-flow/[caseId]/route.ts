import { applyFlowCommand, FlowError } from '@/lib/consulting-flow';
import { publicFlow } from '@/lib/consulting-flow-access';
import { describeUpload, parseFlowRequest } from '@/lib/consulting-flow-http';
import { prepareIntakeImport } from '@/lib/consulting-intake-sources';
import { buildAnalysisSourceBlocks } from '@/lib/consulting-flow-ai';
import {
  FlowCommandReceiptError,
  flowCommandReceipt,
  isFlowCommandRetry,
} from '@/lib/flow-command-receipt';
import { scheduleDuplicateRequestMetric } from '@/lib/duplicate-request-metrics';
import {
  assertFlowLifecycleActive,
  assertSameOrigin,
  commitFlow,
  flowBucket,
  flowErrorResponse,
  flowReadiness,
  loadFlowAccess,
  recheckFlowAccess,
} from '@/lib/consulting-flow-store';
import { privateJsonResponse } from '@/lib/private-response';
import { uploadFileContentProblem } from '@/lib/upload-file-signature';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ caseId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { flow, user } = await loadFlowAccess(
      request,
      (await context.params).caseId,
    );
    return privateJsonResponse({
      flow: publicFlow(flow),
      role: user.role === 'admin' ? 'admin' : 'partner',
      readiness: flowReadiness(),
      canUpload: user.role === 'admin' || Boolean(user.permissions?.fileUpload),
    });
  } catch (error) {
    return flowErrorResponse(error);
  }
}
export async function POST(request: Request, context: Context) {
  let uploadedKeys: string[] = [];
  try {
    assertSameOrigin(request);
    const initial = await loadFlowAccess(
      request,
      (await context.params).caseId,
    );
    assertFlowLifecycleActive(initial.state, initial.flow.caseId);
    const input = await parseFlowRequest(request);
    const receipt = await flowCommandReceipt(initial.user, input);
    const { flow, user, state } = await recheckFlowAccess(
      request,
      initial.flow,
      initial.user,
      Boolean(input.file || input.audio),
    );
    assertFlowLifecycleActive(state, flow.caseId);
    try {
      if (isFlowCommandRetry(flow, input.commandId, receipt)) {
        scheduleDuplicateRequestMetric({
          source: 'flow_command',
          outcome: 'safe_retry',
        });
        return privateJsonResponse({
          flow: publicFlow(flow),
          duplicate: true,
        });
      }
    } catch (error) {
      if (
        error instanceof FlowCommandReceiptError &&
        error.reason !== 'legacy_unknown'
      )
        scheduleDuplicateRequestMetric({
          source: 'flow_command',
          outcome: 'request_key_conflict',
        });
      throw error;
    }
    if (input.revision !== flow.revision)
      throw new FlowError(
        '다른 변경이 있습니다. 새로고침 후 내용을 확인해 주세요.',
        409,
      );
    if (
      input.command.type === 'queue_report1' ||
      (input.command.type === 'retry_job' &&
        flow.jobs.some(
          (job) => job.id === input.command.jobId && job.stage === 1,
        ))
    ) {
      if (user.role !== 'admin')
        throw new FlowError(
          '1차 보고서 생성은 대표만 요청할 수 있습니다.',
          403,
        );
      // Re-read the actual private objects. A previous successful UI check is not authoritative.
      await buildAnalysisSourceBlocks(flow, { stage: 1 });
    }
    if (
      (input.file || input.audio) &&
      user.role !== 'admin' &&
      !user.permissions?.fileUpload
    )
      throw new FlowError('자료 업로드 권한이 필요합니다.', 403);
    const now = new Date().toISOString();
    if (
      input.command.type === 'import_intake_source' &&
      (input.file || input.audio)
    )
      throw new FlowError(
        '신청자료 불러오기에는 새 파일을 첨부할 수 없습니다.',
      );
    const describedUpload = input.file
      ? describeUpload(input.file, input.command, now)
      : undefined;
    const audioUpload = input.audio
      ? describeUpload(input.audio, input.command, now, 'audio')
      : undefined;
    if (input.audio && input.file && /\.(mp3|m4a|wav)$/i.test(input.file.name))
      throw new FlowError('음성은 보조 첨부 1개만 등록해 주세요.');
    for (const file of [input.file, input.audio]) {
      if (!file) continue;
      const contentProblem = await uploadFileContentProblem(file);
      if (contentProblem) throw new FlowError(contentProblem, 400);
    }
    const imported =
      input.command.type === 'import_intake_source'
        ? await prepareIntakeImport(flow, user, input.command, now)
        : undefined;
    const upload = imported?.file ?? describedUpload;
    const next = applyFlowCommand(
      flow,
      input.command,
      {
        id: user.memberId || user.id,
        role: user.role === 'admin' ? 'admin' : 'partner',
        name: user.role === 'admin' ? '김성민 대표' : flow.partnerName,
      },
      {
        commandId: input.commandId,
        now,
        upload,
        audioUpload,
        intakeCategory: imported?.category,
      },
    );
    next.commandReceipts = {
      ...flow.commandReceipts,
      [input.commandId]: receipt,
    };
    if (imported) {
      await flowBucket().put(imported.file.key, imported.bytes, {
        httpMetadata: { contentType: imported.file.contentType },
      });
      uploadedKeys.push(imported.file.key);
    }
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
    const access = await recheckFlowAccess(
      request,
      flow,
      user,
      Boolean(input.file || input.audio),
    );
    assertFlowLifecycleActive(access.state, flow.caseId);
    await commitFlow(flow, next, access.statePayload);
    uploadedKeys = [];
    return privateJsonResponse({ flow: publicFlow(next) });
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
