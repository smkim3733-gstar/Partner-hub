import { createHash, randomUUID } from 'node:crypto';
import { authorizeFileTransfer } from './file-transfer-issuer';
import { dispatchFileTransfer } from './file-transfer-dispatch';
import {
  parseFileTransferIntent,
  type FileTransferIntent,
} from './file-transfer-contract';
import { readBoundedJsonObject, JsonRequestError } from './request-json';
import { sessionToken } from './password-store';
import { nextBackendRequestAllowed } from './next-backend-config';
import { privateJsonResponse } from './private-response';
import { readR2Bytes } from './r2-http-protocol';
import { FlowError } from './consulting-flow';
import {
  assertSupabaseObjectPath,
  type SupabaseStorageHttp,
} from './supabase-storage-http';

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
  file_path: string | null;
  audio_path: string | null;
  created_at: number;
  expires_at: number;
  retain_until: number;
};
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
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
function exactKeys(value: object, keys: string[]) {
  return Object.keys(value).sort().join(',') === keys.sort().join(',');
}

/** JSON-only Vercel control plane. Storage URLs/paths in finish requests are
 * forbidden; private reads use the immutable server reservation exclusively.
 * The database adapter runs each statement/batch in SERIALIZABLE isolation. */
export function createSupabaseTransferHandler(
  db: D1Database,
  config: { appOrigin: string },
  storage: SupabaseStorageHttp,
) {
  async function stored(request: Request, id: unknown) {
    if (typeof id !== 'string' || !uuid.test(id)) throw new TransferError(400);
    const session = sessionToken(request);
    if (!session || !/^[a-f0-9]{64}$/.test(session))
      throw new TransferError(401);
    const row = await db
      .prepare(`SELECT * FROM supabase_file_transfers
      WHERE id = ?1 AND session_hash = ?2 AND expires_at > ?3`)
      .bind(id, digest(session), Date.now())
      .first<Row>();
    if (!row) throw new TransferError(403);
    const intent = parseFileTransferIntent(JSON.parse(row.intent));
    if (
      (intent.kind !== 'company-upload' && intent.kind !== 'flow-upload') ||
      JSON.stringify(intent) !== row.intent ||
      row.expires_at !== row.created_at + 600_000 ||
      row.retain_until !== row.expires_at + 7_380_000
    )
      throw new TransferError(503);
    for (const slot of ['file', 'audio'] as const) {
      const path = row[`${slot}_path`];
      if (
        Boolean(slots(intent)[slot as keyof ReturnType<typeof slots>]) !==
        (path !== null)
      )
        throw new TransferError(503);
      if (path !== null) {
        assertSupabaseObjectPath(path);
        if (!path.startsWith('partner-hub/staging/'))
          throw new TransferError(503);
      }
    }
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
      if (
        request.method !== 'POST' ||
        !nextBackendRequestAllowed(request, config)
      )
        throw new TransferError(403);
      const raw = await readBoundedJsonObject(request, 1024 * 1024);
      if (raw.action === 'prepare' && exactKeys(raw, ['action', 'intent'])) {
        return await authorizeFileTransfer(
          jsonRequest(request, raw.intent),
          config.appOrigin,
          async (input) => {
            if (
              input.intent.kind !== 'company-upload' &&
              input.intent.kind !== 'flow-upload'
            )
              throw new TransferError(400);
            // No grant is issued for an unbounded or publicly readable bucket.
            await storage.assertStagingBucket();
            const id = randomUUID(),
              createdAt = Date.now();
            const paths = Object.fromEntries(
              Object.keys(slots(input.intent)).map((slot) => [
                slot,
                `partner-hub/staging/v1/${randomUUID()}`,
              ]),
            );
            const inserted = await db
              .prepare(`INSERT INTO supabase_file_transfers
            (id,user_id,session_hash,intent,payload,file_path,audio_path,created_at,expires_at,retain_until)
            SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10 WHERE
            (SELECT COUNT(*) FROM supabase_file_transfers WHERE user_id = ?2 AND retain_until > ?8) < 20`)
              .bind(
                id,
                input.userId,
                digest(input.session),
                JSON.stringify(input.intent),
                input.intent.kind === 'flow-upload'
                  ? (raw.intent as { payload: string }).payload
                  : null,
                paths.file ?? null,
                paths.audio ?? null,
                createdAt,
                createdAt + 600_000,
                createdAt + 7_980_000,
              )
              .run();
            if (inserted.meta.changes !== 1) throw new TransferError(429);
            // Recheck session/ownership/revision after the durable reservation and
            // again before signing each slot. A provider token is never stored.
            const uploads: Record<
              string,
              Awaited<ReturnType<SupabaseStorageHttp['signStagingUpload']>>
            > = {};
            for (const [slot, path] of Object.entries(paths)) {
              const value = await stored(request, id);
              if (value.rejection) return value.rejection;
              uploads[slot] = await storage.signStagingUpload(path);
            }
            const value = await stored(request, id);
            if (value.rejection) return value.rejection;
            return privateJsonResponse({
              id,
              expiresAt: createdAt + 600_000,
              uploads,
            });
          },
        );
      }
      if (raw.action === 'finish' && exactKeys(raw, ['action', 'id'])) {
        const value = await stored(request, raw.id);
        if (value.rejection) return value.rejection;
        const form = new FormData();
        if (value.intent.kind === 'company-upload') {
          for (const [key, field] of Object.entries(value.intent.fields))
            form.set(key, field);
        } else form.set('payload', value.row.payload!);
        for (const [slot, descriptor] of Object.entries(slots(value.intent))) {
          const path =
            slot === 'file' ? value.row.file_path! : value.row.audio_path!;
          const object = await storage.head(path);
          if (!object || object.size !== descriptor.size)
            throw new TransferError(409);
          const bytes = await readR2Bytes(
            await storage.get(object, descriptor.sha256),
            descriptor.size,
          );
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
        // Expiry and current authorization must still hold after slow byte I/O.
        const final = await stored(request, raw.id);
        if (final.rejection) return final.rejection;
        const now = Math.floor(Date.now() / 1000);
        const exp = Math.min(
          now + 120,
          Math.floor(value.row.expires_at / 1000),
        );
        if (exp <= now) throw new TransferError(403);
        // Internal dispatch runs the original signature/consent/revision/receipt,
        // file reservation and commit-time session checks. No uncertain replay.
        return await dispatchFileTransfer(
          new Request(request.url, { method: 'POST', body: form }),
          {
            v: 1,
            // Dispatch requires an exact 120-second authorization window. End
            // that internal window early, never beyond the reservation deadline.
            iat: exp - 120,
            exp,
            nonce: value.row.id,
            sub: value.row.user_id,
            session: value.session,
            origin: config.appOrigin,
            aud: config.appOrigin,
            intent: value.intent,
          },
          () => {
            if (
              Date.now() >= value.row.expires_at ||
              Math.floor(Date.now() / 1000) >= exp
            )
              throw new FlowError(
                '파일 제출 유효시간이 지났습니다. 같은 원본으로 다시 제출해 주세요.',
                403,
              );
          },
        );
      }
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
