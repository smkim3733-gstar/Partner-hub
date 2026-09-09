import { applyFlowCommand, FlowError } from './consulting-flow';
import { describeUpload } from './consulting-flow-http';
import {
  assertFlowLifecycleActive,
  loadFlowAccess,
} from './consulting-flow-store';
import { FLOW_ADMIN_COMMAND_ACTOR_NAME } from './flow-command-receipt';
import {
  parseFlowTransferPayload,
  type FlowTransferUpload,
} from './file-transfer-contract';
import { fileDigest } from './file-digest';
import type { PortalUser } from './portal-auth';

/** No reservation, file read, AI call or durable command occurs at issuance.
 * The byte-owning Worker must run the full original command/receipt checks. */
export async function preflightFlowTransfer(
  request: Request,
  expected: PortalUser,
  intent: FlowTransferUpload,
  payload: unknown,
) {
  let input;
  try {
    input = parseFlowTransferPayload(payload);
    if (
      (await fileDigest(payload as string)) !== intent.payloadSha256 ||
      input.commandId !== intent.commandId ||
      input.revision !== intent.revision ||
      input.command.type !== intent.commandType
    )
      throw new Error();
  } catch {
    throw new FlowError('전송 명령과 본문이 일치하지 않습니다.', 400);
  }
  const { flow, user, state } = await loadFlowAccess(request, intent.caseId);
  if (
    user.id !== expected.id ||
    user.role !== expected.role ||
    user.memberId !== expected.memberId
  )
    throw new FlowError(
      '계정 정보가 변경되었습니다. 다시 로그인해 주세요.',
      403,
    );
  assertFlowLifecycleActive(state, flow.caseId);
  if (user.role !== 'admin' && !user.permissions?.fileUpload)
    throw new FlowError('자료 업로드 권한이 필요합니다.', 403);
  const now = new Date().toISOString();
  const upload = intent.files.file
    ? describeUpload(intent.files.file, input.command, now)
    : undefined;
  const audioUpload = intent.files.audio
    ? describeUpload(intent.files.audio, input.command, now, 'audio')
    : undefined;
  if (
    intent.files.file &&
    intent.files.audio &&
    /\.(mp3|m4a|wav)$/i.test(intent.files.file.name)
  )
    throw new FlowError('음성은 보조 첨부 1개만 등록해 주세요.', 400);
  // A completed retry is allowed to reach the original receipt check even after
  // later workflow revisions. This does not assert that the supplied hashes match.
  if (flow.commandIds.includes(input.commandId)) return;
  if (flow.revision !== input.revision)
    throw new FlowError(
      '다른 변경이 있습니다. 새로고침 후 내용을 확인해 주세요.',
      409,
    );
  applyFlowCommand(
    flow,
    input.command,
    {
      id: user.memberId || user.id,
      role: user.role === 'admin' ? 'admin' : 'partner',
      name:
        user.role === 'admin'
          ? FLOW_ADMIN_COMMAND_ACTOR_NAME
          : flow.partnerName,
    },
    { commandId: input.commandId, now, upload, audioUpload },
  );
}
