import {
  applyFlowCommand,
  FlowError,
  type FlowFile,
} from '@/lib/consulting-flow';
import { publicFlow } from '@/lib/consulting-flow-access';
import { describeUpload, parseFlowRequest } from '@/lib/consulting-flow-http';
import {
  prepareIntakeImport,
  recheckPreparedIntakeImport,
} from '@/lib/consulting-intake-sources';
import { buildAnalysisSourceBlocks } from '@/lib/consulting-flow-ai';
import {
  FLOW_ADMIN_COMMAND_ACTOR_NAME,
  FlowCommandReceiptError,
  flowCommandReceipt,
  isFlowCommandRetry,
  type ComputedFlowCommandReceiptWithDigests,
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
import { r2ObjectSha256Hex, r2Sha256Bytes } from '@/lib/r2-checksum';
import { uploadFileContentProblem } from '@/lib/upload-file-signature';

type Context = { params: Promise<{ caseId: string }> };
export async function getConsultingFlow(request: Request, context: Context) {
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

export async function postConsultingFlow(
  request: Request,
  context: Context,
  validateTransfer?: (form: FormData) => Promise<void>,
) {
  const fileObjectBindings = new Map<
    string,
    ReturnType<typeof flowFileObjectBinding>
  >();
  const fileSha256Bindings = new Map<string, string>();
  try {
    assertSameOrigin(request);
    const initial = await loadFlowAccess(
      request,
      (await context.params).caseId,
    );
    assertFlowLifecycleActive(initial.state, initial.flow.caseId);
    const input = await parseFlowRequest(request, validateTransfer);
    const receipt = (await flowCommandReceipt(initial.user, input, {
      includeAttachmentDigests: true,
    })) as ComputedFlowCommandReceiptWithDigests;
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
    if (input.file || input.audio) {
      // File inspection can decompress or read several megabytes. Recheck after
      // that asynchronous work so revoked access cannot start a new R2 write.
      const contentCheckedAccess = await recheckFlowAccess(
        request,
        flow,
        user,
        true,
      );
      assertFlowLifecycleActive(contentCheckedAccess.state, flow.caseId);
    }
    const imported =
      input.command.type === 'import_intake_source'
        ? await prepareIntakeImport(flow, user, input.command, now)
        : undefined;
    if (imported) {
      // Source R2 reads, document parsing, and SHA-256 hashing happen before a
      // FLOW reservation. Recheck now so stale access cannot create one.
      const sourceCheckedAccess = await recheckFlowAccess(request, flow, user);
      assertFlowLifecycleActive(sourceCheckedAccess.state, flow.caseId);
      // Access revalidation itself performs asynchronous D1 work. Bind the
      // upcoming reservation to the still-current reviewed source snapshot.
      await recheckPreparedIntakeImport(flow, imported);
    }
    const candidateUpload = imported?.file ?? describedUpload;
    const actor = {
      id: user.memberId || user.id,
      role: user.role === 'admin' ? ('admin' as const) : ('partner' as const),
      name:
        user.role === 'admin'
          ? FLOW_ADMIN_COMMAND_ACTOR_NAME
          : flow.partnerName,
    };
    const apply = (
      upload = candidateUpload,
      audio = audioUpload,
      appliedAt = now,
    ) =>
      applyFlowCommand(flow, input.command, actor, {
        commandId: input.commandId,
        now: appliedAt,
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
    if (reservations.size) {
      // Reservation lookup or creation performs asynchronous D1 work. Recheck
      // after it so a revoked actor cannot start an R2 write with stale access.
      const reservationCheckedAccess = await recheckFlowAccess(
        request,
        flow,
        user,
        true,
      );
      assertFlowLifecycleActive(reservationCheckedAccess.state, flow.caseId);
      // Reservation creation is asynchronous D1 work. An intake original may
      // change after the pre-reservation check; stop before copying its bytes.
      if (imported) await recheckPreparedIntakeImport(flow, imported);
    }
    const upload = candidateUpload ? reservations.get('file') : undefined;
    const reservedAudioUpload = audioUpload
      ? reservations.get('audio')
      : undefined;
    const next = apply(
      upload,
      reservedAudioUpload,
      upload?.intakeFileId ? upload.createdAt : now,
    );
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
    const writeUpload = async (
      file: FlowFile,
      body: Parameters<R2Bucket['put']>[1],
      sha256: string | undefined,
    ) => {
      try {
        const binding = await writeReservedFlowUpload(file, body, sha256);
        fileSha256Bindings.set(file.id, sha256!);
        return binding;
      } catch (error) {
        // R2 can fail before commit or after an ambiguous object commit. Check
        // current access before telling the actor to retry the reserved write.
        const failedUploadAccess = await recheckFlowAccess(
          request,
          flow,
          user,
          true,
        );
        assertFlowLifecycleActive(failedUploadAccess.state, flow.caseId);
        throw error;
      }
    };
    if (imported) {
      fileObjectBindings.set(
        upload!.id,
        await writeUpload(upload!, imported.bytes, imported.storageSha256),
      );
      // The original can change while R2 writes the already-reviewed bytes.
      // Preserve the reservation/object, but never commit a stale source copy.
      await recheckPreparedIntakeImport(flow, imported);
    }
    if (upload && input.file) {
      fileObjectBindings.set(
        upload.id,
        await writeUpload(upload, input.file.stream(), receipt.fileSha256),
      );
    }
    if (reservedAudioUpload && input.audio) {
      if (fileObjectBindings.size) {
        // A dual-slot request can lose access after its first R2 write. Stop
        // before writing the second object while retaining both reservations.
        const additionalUploadAccess = await recheckFlowAccess(
          request,
          flow,
          user,
          true,
        );
        assertFlowLifecycleActive(additionalUploadAccess.state, flow.caseId);
      }
      fileObjectBindings.set(
        reservedAudioUpload.id,
        await writeUpload(
          reservedAudioUpload,
          input.audio.stream(),
          receipt.audioSha256,
        ),
      );
    }
    const access = await recheckFlowAccess(
      request,
      flow,
      user,
      Boolean(input.file || input.audio),
    );
    assertFlowLifecycleActive(access.state, flow.caseId);
    // Final access validation performs asynchronous D1 work. Rebind an intake
    // import to its current source immediately before the FLOW transaction.
    if (imported) await recheckPreparedIntakeImport(flow, imported);
    // An object can be replaced after put() returns while final access/source
    // checks run. Re-read every new object so D1 never records stale R2 proof.
    await Promise.all(
      [upload, reservedAudioUpload]
        .filter((file): file is FlowFile => file !== undefined)
        .map(async (file) => {
          const binding = fileObjectBindings.get(file.id);
          const sha256 = fileSha256Bindings.get(file.id);
          if (!binding || !sha256)
            throw new FlowError(
              '첨부파일 보관 증빙을 확인할 수 없습니다. 자료를 다시 등록해 주세요.',
              503,
            );
          let object: R2Object | null;
          try {
            object = await flowBucket().head(file.key);
          } catch {
            throw new FlowError(
              '첨부파일 보관 상태를 확인하지 못했습니다. 같은 자료로 다시 시도해 주세요.',
              503,
            );
          }
          if (
            !object ||
            object.key !== file.key ||
            object.size !== file.size ||
            object.httpMetadata?.contentType !== binding.contentType ||
            object.etag !== binding.etag ||
            r2ObjectSha256Hex(object) !== sha256
          )
            throw new FlowError(
              '첨부파일 보관 상태가 변경되었습니다. 같은 자료로 다시 시도해 주세요.',
              409,
            );
        }),
    );
    try {
      await commitFlow(
        flow,
        next,
        access.statePayload,
        fileObjectBindings,
        reservations.size
          ? new Set([...reservations.values()].map((file) => file.id))
          : undefined,
      );
    } catch (error) {
      // The D1 import-source trigger can reject a source deletion or ledger
      // change that races the final preflight. Re-read it after rollback so the
      // caller receives the precise 404/409 source decision, not a generic save
      // failure. Unexpected persistence failures keep their original error.
      if (imported) await recheckPreparedIntakeImport(flow, imported);
      throw error;
    }
    return privateJsonResponse({ flow: publicFlow(next) });
  } catch (error) {
    // Every uploaded key already has a durable reservation. Do not
    // delete it here: another exact retry can commit the shared key between a
    // FLOW re-read and R2 deletion. Inventory and exact retry recover it safely.
    return flowErrorResponse(error);
  }
}

async function writeReservedFlowUpload(
  file: FlowFile,
  body: Parameters<R2Bucket['put']>[1],
  sha256: string | undefined,
) {
  try {
    if (!sha256 || !/^[0-9a-f]{64}$/.test(sha256))
      throw new FlowError(
        '첨부파일의 보관 체크섬을 확인할 수 없습니다. 자료를 다시 등록해 주세요.',
        503,
      );
    const bucket = flowBucket();
    const existing = await bucket.head(file.key);
    const object = await bucket.put(file.key, body, {
      onlyIf: existing
        ? { etagMatches: existing.etag }
        : { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: file.contentType },
      sha256: r2Sha256Bytes(sha256)!,
    });
    if (object) {
      if (!reservedR2ObjectMatches(file, object, sha256))
        throw new FlowError(
          '첨부파일을 보안 저장소에 안전하게 기록하지 못했습니다.',
          503,
        );
      return flowFileObjectBinding(file, object);
    }
    const winner = await bucket.head(file.key);
    if (winner && reservedR2ObjectMatches(file, winner, sha256))
      return flowFileObjectBinding(file, winner);
    throw new FlowError(
      '첨부파일 보관 상태가 변경되었습니다. 같은 자료로 다시 시도해 주세요.',
      409,
    );
  } catch (error) {
    if (error instanceof FlowError) throw error;
    throw new FlowError(
      '첨부파일을 보안 저장소에 기록하지 못했습니다. 같은 자료로 다시 시도해 주세요.',
      503,
    );
  }
}

function reservedR2ObjectMatches(
  file: FlowFile,
  object: R2Object,
  sha256: string,
) {
  return (
    object.key === file.key &&
    object.size === file.size &&
    object.httpMetadata?.contentType === file.contentType &&
    r2ObjectSha256Hex(object) === sha256
  );
}
