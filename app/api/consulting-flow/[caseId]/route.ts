import { applyFlowCommand, FlowError } from '@/lib/consulting-flow';
import { publicFlow } from '@/lib/consulting-flow-access';
import { describeUpload, parseFlowRequest } from '@/lib/consulting-flow-http';
import { prepareIntakeImport } from '@/lib/consulting-intake-sources';
import { buildAnalysisSourceBlocks } from '@/lib/consulting-flow-ai';
import {
  FLOW_ADMIN_COMMAND_ACTOR_NAME,
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
  flowFileObjectBinding,
  flowReadiness,
  loadFlowAccess,
  recheckFlowAccess,
  reserveFlowUploads,
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
  const fileObjectBindings = new Map<
    string,
    ReturnType<typeof flowFileObjectBinding>
  >();
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
    const candidateUpload = imported?.file ?? describedUpload;
    const actor = {
      id: user.memberId || user.id,
      role: user.role === 'admin' ? ('admin' as const) : ('partner' as const),
      name:
        user.role === 'admin'
          ? FLOW_ADMIN_COMMAND_ACTOR_NAME
          : flow.partnerName,
    };
    const apply = (upload = candidateUpload, audio = audioUpload) =>
      applyFlowCommand(flow, input.command, actor, {
        commandId: input.commandId,
        now,
        upload,
        audioUpload: audio,
        intakeCategory: imported?.category,
      });
    // Validate the complete business transition before creating a durable upload reservation.
    apply();
    const reservations = await reserveFlowUploads({
      caseId: flow.caseId,
      actorKey: receipt.actorKey,
      commandId: input.commandId,
      fingerprint: receipt.fingerprint,
      uploads: [
        ...(candidateUpload
          ? [{ slot: 'file' as const, file: candidateUpload }]
          : []),
        ...(audioUpload ? [{ slot: 'audio' as const, file: audioUpload }] : []),
      ],
    });
    const upload = candidateUpload ? reservations.get('file') : undefined;
    const reservedAudioUpload = audioUpload
      ? reservations.get('audio')
      : undefined;
    const next = apply(upload, reservedAudioUpload);
    const commandAudit = next.audit.at(-1);
    if (
      !commandAudit ||
      commandAudit.id !== input.commandId ||
      commandAudit.action === 'ai_result'
    )
      throw new FlowError('업무 요청 감사기록을 확인할 수 없습니다.', 503);
    next.commandReceipts = {
      ...flow.commandReceipts,
      [input.commandId]: {
        actorKey: receipt.actorKey,
        fingerprint: receipt.fingerprint,
        actor: commandAudit.actor,
        action: commandAudit.action,
        ...(receipt.targetId ? { targetId: receipt.targetId } : {}),
      },
    };
    if (imported) {
      const object = await flowBucket().put(upload!.key, imported.bytes, {
        httpMetadata: { contentType: upload!.contentType },
      });
      fileObjectBindings.set(
        upload!.id,
        flowFileObjectBinding(upload!, object),
      );
    }
    if (upload && input.file) {
      const object = await flowBucket().put(upload.key, input.file.stream(), {
        httpMetadata: { contentType: upload.contentType },
      });
      fileObjectBindings.set(upload.id, flowFileObjectBinding(upload, object));
    }
    if (reservedAudioUpload && input.audio) {
      const object = await flowBucket().put(
        reservedAudioUpload.key,
        input.audio.stream(),
        {
          httpMetadata: { contentType: reservedAudioUpload.contentType },
        },
      );
      fileObjectBindings.set(
        reservedAudioUpload.id,
        flowFileObjectBinding(reservedAudioUpload, object),
      );
    }
    const access = await recheckFlowAccess(
      request,
      flow,
      user,
      Boolean(input.file || input.audio),
    );
    assertFlowLifecycleActive(access.state, flow.caseId);
    await commitFlow(
      flow,
      next,
      access.statePayload,
      fileObjectBindings,
      reservations.size
        ? new Set([...reservations.values()].map((file) => file.id))
        : undefined,
    );
    return privateJsonResponse({ flow: publicFlow(next) });
  } catch (error) {
    // Every uploaded key already has a durable reservation. Do not
    // delete it here: another exact retry can commit the shared key between a
    // FLOW re-read and R2 deletion. Inventory and exact retry recover it safely.
    return flowErrorResponse(error);
  }
}
