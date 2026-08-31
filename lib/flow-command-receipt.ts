import {
  FlowError,
  type ConsultingFlow,
  type FlowCommand,
} from './consulting-flow';
import type { PortalUser } from './portal-auth';
import { fileDigest } from './file-upload-key';

function canonical(value: unknown, depth = 0): unknown {
  if (depth > 30) throw new FlowError('요청 내용이 너무 복잡합니다.');
  if (Array.isArray(value))
    return value.map((item) => canonical(item, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item, depth + 1)]),
    );
  return value;
}
async function attachment(file?: File) {
  return file
    ? {
        name: file.name,
        type: file.type,
        size: file.size,
        digest: await fileDigest(await file.arrayBuffer()),
      }
    : null;
}
export async function flowCommandReceipt(
  user: PortalUser,
  input: { command: FlowCommand; file?: File; audio?: File },
) {
  return {
    actorKey:
      user.role === 'admin' ? `admin:${user.email}` : `member:${user.memberId}`,
    fingerprint: await fileDigest(
      JSON.stringify({
        command: canonical(input.command),
        file: await attachment(input.file),
        audio: await attachment(input.audio),
      }),
    ),
  };
}
export function isFlowCommandRetry(
  flow: ConsultingFlow,
  commandId: string,
  receipt: { actorKey: string; fingerprint: string },
) {
  if (!flow.commandIds.includes(commandId)) return false;
  const saved =
    flow.commandReceipts && Object.hasOwn(flow.commandReceipts, commandId)
      ? flow.commandReceipts[commandId]
      : undefined;
  if (!saved)
    throw new FlowError(
      '이전 요청의 상세 확인 정보가 없습니다. 새로고침으로 저장 결과를 확인해 주세요.',
      409,
    );
  if (saved.actorKey !== receipt.actorKey)
    throw new FlowError('다른 계정의 요청 번호는 재사용할 수 없습니다.', 403);
  if (saved.fingerprint !== receipt.fingerprint)
    throw new FlowError(
      '같은 요청 번호의 내용 또는 첨부가 변경되었습니다. 저장 결과를 확인해 주세요.',
      409,
    );
  return true;
}
