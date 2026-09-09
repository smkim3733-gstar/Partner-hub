import { handleUpload } from '@vercel/blob/client';
import * as blobSdk from '@vercel/blob';
import { createHash, randomUUID } from 'node:crypto';
import { authorizeFileTransfer } from './file-transfer-issuer';
import { dispatchFileTransfer } from './file-transfer-dispatch';
import {
  parseFileTransferIntent,
  type FileTransferIntent,
  type TransferFile,
} from './file-transfer-contract';
import { readBoundedJsonObject, JsonRequestError } from './request-json';
import { sessionToken } from './password-store';
import { nextBackendRequestAllowed } from './next-backend-config';
import { privateJsonResponse } from './private-response';
import { readR2Bytes } from './r2-http-protocol';
import { FlowError } from './consulting-flow';

type UploadIntent = Extract<
  FileTransferIntent,
  { kind: 'company-upload' | 'flow-upload' }
>;
type Row = {
  id: string;
  user_id: string;
  session_hash: string;
  intent: string;
  payload: string | null;
  created_at: number;
  expires_at: number;
};
const digest = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
const stagePath = (id: string, slot: string) =>
  `partner-hub/staging/${id}/${slot}`;
const slots = (intent: UploadIntent) =>
  intent.kind === 'company-upload' ? { file: intent.file } : intent.files;
class TransferError extends FlowError {
  constructor(status: number) {
    super('파일 전송 정보·로그인·권한 또는 유효시간을 확인해 주세요.', status);
  }
}
function jsonRequest(original: Request, body: unknown) {
  const headers = new Headers(original.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json');
  return new Request(original.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

/** Injected SDK allows offline safety tests; production passes only official SDK. */
export function createBlobTransferHandler(
  db: D1Database,
  config: { appOrigin: string; blobToken: string },
  sdk = blobSdk,
) {
  process.env.VERCEL_BLOB_RETRIES = '0';
  function options() {
    return {
      token: config.blobToken,
      abortSignal: AbortSignal.timeout(120_000),
    };
  }
  async function stored(request: Request, id: unknown) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id))
      throw new TransferError(400);
    const session = sessionToken(request);
    if (!session || !/^[a-f0-9]{64}$/.test(session))
      throw new TransferError(401);
    const row = await db
      .prepare(
        'SELECT * FROM vercel_blob_transfers WHERE id = ?1 AND session_hash = ?2 AND expires_at > ?3',
      )
      .bind(id, digest(session), Date.now())
      .first<Row>();
    if (!row) throw new TransferError(403);
    const intent = parseFileTransferIntent(JSON.parse(row.intent));
    if (intent.kind !== 'company-upload' && intent.kind !== 'flow-upload')
      throw new TransferError(400);
    const raw =
      intent.kind === 'flow-upload'
        ? { ...intent, payload: row.payload }
        : intent;
    let authorized = false;
    const rejection = await authorizeFileTransfer(
      jsonRequest(request, raw),
      config.appOrigin,
      async (input) => {
        if (
          input.userId !== row.user_id ||
          digest(input.session) !== row.session_hash
        )
          throw new TransferError(403);
        authorized = true;
        return new Response(null, { status: 204 });
      },
    );
    return { row, intent, session, rejection: authorized ? null : rejection };
  }
  return async function handle(request: Request): Promise<Response> {
    try {
      if (!nextBackendRequestAllowed(request, config))
        throw new TransferError(403);
      const raw = await readBoundedJsonObject(request, 1024 * 1024);
      if (raw.action === 'prepare') {
        const scope = raw.intent;
        return await authorizeFileTransfer(
          jsonRequest(request, scope),
          config.appOrigin,
          async (input) => {
            if (
              input.intent.kind !== 'company-upload' &&
              input.intent.kind !== 'flow-upload'
            )
              throw new TransferError(400);
            const id = randomUUID(),
              createdAt = Date.now();
            // Bound abandoned staging reservations per session. Expired rows are
            // removed only by the explicit cleanup command after token expiry.
            const inserted = await db
              .prepare(`INSERT INTO vercel_blob_transfers
            (id,user_id,session_hash,intent,payload,created_at,expires_at)
            SELECT ?1,?2,?3,?4,?5,?6,?7 WHERE
            (SELECT COUNT(*) FROM vercel_blob_transfers WHERE session_hash = ?3 AND expires_at > ?6) < 20`)
              .bind(
                id,
                input.userId,
                digest(input.session),
                JSON.stringify(input.intent),
                input.intent.kind === 'flow-upload'
                  ? (scope as { payload: string }).payload
                  : null,
                createdAt,
                createdAt + 600_000,
              )
              .run();
            if (inserted.meta.changes !== 1) throw new TransferError(429);
            return privateJsonResponse({
              id,
              expiresAt: createdAt + 600_000,
              paths: Object.fromEntries(
                Object.keys(slots(input.intent)).map((slot) => [
                  slot,
                  stagePath(id, slot),
                ]),
              ),
            });
          },
        );
      }
      if (raw.type === 'blob.generate-client-token') {
        const body = raw as unknown as Extract<
          Parameters<typeof handleUpload>[0]['body'],
          { type: 'blob.generate-client-token' }
        >;
        if (
          !body.payload ||
          body.payload.multipart !== false ||
          typeof body.payload.clientPayload !== 'string'
        )
          throw new TransferError(400);
        const value = await stored(request, body.payload.clientPayload);
        if (value.rejection) return value.rejection;
        const entry = Object.entries(slots(value.intent)).find(
          ([slot]) => stagePath(value.row.id, slot) === body.payload.pathname,
        );
        if (!entry) throw new TransferError(403);
        const result = await handleUpload({
          request,
          body,
          token: config.blobToken,
          onBeforeGenerateToken: async () => ({
            maximumSizeInBytes: entry[1].size,
            allowedContentTypes: ['application/octet-stream'],
            validUntil: value.row.expires_at,
            addRandomSuffix: false,
            allowOverwrite: false,
          }),
        });
        return privateJsonResponse(result);
      }
      if (raw.action === 'finish') {
        const value = await stored(request, raw.id);
        if (value.rejection) return value.rejection;
        const form = new FormData();
        if (value.intent.kind === 'company-upload') {
          for (const [key, field] of Object.entries(value.intent.fields))
            form.set(key, field);
        } else form.set('payload', value.row.payload!);
        for (const [slot, descriptor] of Object.entries(
          slots(value.intent),
        ) as [string, TransferFile][]) {
          // Read only server-derived paths, never URLs supplied by a browser or webhook.
          const result = await sdk.get(stagePath(value.row.id, slot), {
            ...options(),
            access: 'private',
            useCache: false,
          });
          if (!result || result.statusCode !== 200)
            throw new TransferError(409);
          if (result.blob.size !== descriptor.size) {
            await result.stream.cancel();
            throw new TransferError(409);
          }
          const bytes = await readR2Bytes(result.stream, descriptor.size);
          if (
            bytes.length !== descriptor.size ||
            digest(bytes) !== descriptor.sha256
          )
            throw new TransferError(409);
          form.set(
            slot,
            new File([Uint8Array.from(bytes)], descriptor.name, {
              type: descriptor.type,
            }),
          );
        }
        if (value.row.expires_at <= Date.now()) throw new TransferError(403);
        const iat = Math.floor(Date.now() / 1000);
        // All original signature, consent, revision, receipt, ownership and
        // commit-time session checks run again before business persistence.
        return await dispatchFileTransfer(
          new Request(request.url, { method: 'POST', body: form }),
          {
            v: 1,
            iat,
            exp: iat + 120,
            nonce: value.row.id,
            sub: value.row.user_id,
            session: value.session,
            origin: config.appOrigin,
            aud: config.appOrigin,
            intent: value.intent,
          },
        );
      }
      // No unsigned upload-completed callback may commit a business record.
      throw new TransferError(400);
    } catch (error) {
      return privateJsonResponse(
        {
          error:
            error instanceof TransferError || error instanceof JsonRequestError
              ? error.message
              : '파일 전송을 완료하지 못했습니다. 원본과 요청 정보는 보존됩니다.',
        },
        {
          status:
            error instanceof TransferError || error instanceof JsonRequestError
              ? error.status
              : 503,
        },
      );
    }
  };
}
