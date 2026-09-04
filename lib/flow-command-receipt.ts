import {
  FlowError,
  type ConsultingFlow,
  type FlowCommand,
} from './consulting-flow';
import type { PortalUser } from './portal-auth';
import { fileDigest } from './file-upload-key';
import { downloadContentType } from './download-content-type';

export type FlowCommandReceiptErrorReason =
  | 'legacy_unknown'
  | 'different_actor'
  | 'changed_content';

export class FlowCommandReceiptError extends FlowError {
  constructor(
    message: string,
    status: number,
    public readonly reason: FlowCommandReceiptErrorReason,
  ) {
    super(message, status);
  }
}

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
        contentType: downloadContentType(file.name),
        legacyContentType: file.type,
        size: file.size,
        digest: await fileDigest(await file.arrayBuffer()),
      }
    : null;
}
type ReceiptAttachment = Awaited<ReturnType<typeof attachment>>;

function receiptAttachment(
  value: ReceiptAttachment,
  useLegacyContentType: boolean,
) {
  return value
    ? {
        name: value.name,
        type: useLegacyContentType
          ? value.legacyContentType
          : value.contentType,
        size: value.size,
        digest: value.digest,
      }
    : null;
}

export type ComputedFlowCommandReceipt = {
  actorKey: string;
  fingerprint: string;
  /** Used only to resume a matching command saved before MIME normalization. */
  legacyFingerprint?: string;
};

export async function flowCommandReceipt(
  user: PortalUser,
  input: { command: FlowCommand; file?: File; audio?: File },
): Promise<ComputedFlowCommandReceipt> {
  const command = canonical(input.command);
  const file = await attachment(input.file);
  const audio = await attachment(input.audio);
  const fingerprintFor = (useLegacyContentType: boolean) =>
    fileDigest(
      JSON.stringify({
        command,
        file: receiptAttachment(file, useLegacyContentType),
        audio: receiptAttachment(audio, useLegacyContentType),
      }),
    );
  const fingerprint = await fingerprintFor(false);
  const needsLegacyFingerprint = [file, audio].some(
    (value) => value && value.contentType !== value.legacyContentType,
  );
  return {
    actorKey:
      user.role === 'admin' ? `admin:${user.email}` : `member:${user.memberId}`,
    fingerprint,
    ...(needsLegacyFingerprint
      ? { legacyFingerprint: await fingerprintFor(true) }
      : {}),
  };
}
export function isFlowCommandRetry(
  flow: ConsultingFlow,
  commandId: string,
  receipt: ComputedFlowCommandReceipt,
) {
  if (!flow.commandIds.includes(commandId)) return false;
  const saved =
    flow.commandReceipts && Object.hasOwn(flow.commandReceipts, commandId)
      ? flow.commandReceipts[commandId]
      : undefined;
  if (!saved)
    throw new FlowCommandReceiptError(
      '이전 요청의 상세 확인 정보가 없습니다. 새로고침으로 저장 결과를 확인해 주세요.',
      409,
      'legacy_unknown',
    );
  if (saved.actorKey !== receipt.actorKey)
    throw new FlowCommandReceiptError(
      '다른 계정의 요청 번호는 재사용할 수 없습니다.',
      403,
      'different_actor',
    );
  if (
    saved.fingerprint !== receipt.fingerprint &&
    saved.fingerprint !== receipt.legacyFingerprint
  )
    throw new FlowCommandReceiptError(
      '같은 요청 번호의 내용 또는 첨부가 변경되었습니다. 저장 결과를 확인해 주세요.',
      409,
      'changed_content',
    );
  return true;
}
