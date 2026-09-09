import * as blobSdk from '@vercel/blob';
import { createHash } from 'node:crypto';
import {
  r2PrivateKey,
  r2HttpLimits,
  encodeR2PutOptions,
  parseR2Object,
  nativeR2Object,
  guardedR2Body,
  readR2Bytes,
} from './r2-http-protocol';

// One atomic object contains metadata + SHA-256 + original bytes. No sidecar
// race, synthetic ETag or loss of the existing immutable upload ledgers.
const headerBytes = 8192;
const magic = new TextEncoder().encode('PHBLOB1\n');
const failed = (): never => {
  throw new Error('VERCEL_BLOB_FAILED_OR_OUTCOME_UNKNOWN');
};
type Sdk = Pick<typeof blobSdk, 'put' | 'get' | 'head' | 'del'>;
type Metadata = {
  size: number;
  sha256: string;
  httpMetadata: object;
  customMetadata: object;
};
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
export const vercelObjectPath = (key: string) => `partner-hub/v1/${key}`;

export function createVercelBlobBucket(
  token: string,
  sdk: Sdk = blobSdk,
): R2Bucket {
  // Pinned SDK's documented environment switch is process-wide, constant and
  // non-secret. Unknown mutations must not be replayed by its default retries.
  process.env.VERCEL_BLOB_RETRIES = '0';
  function options() {
    return { token, abortSignal: AbortSignal.timeout(r2HttpLimits.timeoutMs) };
  }
  function object(
    key: string,
    meta: Metadata,
    provider: { etag: string; uploadedAt: Date },
  ) {
    if (!/^"[^"\r\n]{1,256}"$/.test(provider.etag)) return failed();
    const etag = provider.etag.slice(1, -1);
    return nativeR2Object(
      parseR2Object(
        {
          key,
          version: etag,
          etag,
          httpEtag: provider.etag,
          uploaded: provider.uploadedAt.toISOString(),
          size: meta.size,
          checksums: { sha256: meta.sha256 },
          httpMetadata: meta.httpMetadata,
          customMetadata: meta.customMetadata,
          storageClass: '',
        },
        key,
      ),
    );
  }
  async function read(key: string, headOnly: boolean) {
    r2PrivateKey(key, true);
    const result = await sdk.get(vercelObjectPath(key), {
      ...options(),
      access: 'private',
      useCache: false,
    });
    if (result === null) return null;
    if (
      result.statusCode !== 200 ||
      result.blob.size < headerBytes ||
      result.blob.size > headerBytes + r2HttpLimits.objectBytes
    ) {
      await result.stream?.cancel();
      return failed();
    }
    const reader = result.stream.getReader();
    let transferred = false;
    try {
      const header = new Uint8Array(headerBytes);
      let offset = 0;
      let remainder: Uint8Array | undefined;
      while (offset < headerBytes) {
        const part = await reader.read();
        if (part.done) return failed();
        const count = Math.min(part.value.byteLength, headerBytes - offset);
        header.set(part.value.subarray(0, count), offset);
        offset += count;
        if (count < part.value.byteLength)
          remainder = part.value.subarray(count);
      }
      if (!magic.every((byte, i) => header[i] === byte)) return failed();
      const length = new DataView(header.buffer).getUint32(8);
      if (
        length < 2 ||
        length > headerBytes - 12 ||
        header.subarray(12 + length).some((byte) => byte !== 0)
      )
        return failed();
      const meta: Metadata = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(
          header.subarray(12, 12 + length),
        ),
      );
      if (meta.size + headerBytes !== result.blob.size) return failed();
      const info = object(key, meta, result.blob);
      if (headOnly) return info;
      const source = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            if (remainder) {
              controller.enqueue(remainder);
              remainder = undefined;
              return;
            }
            const part = await reader.read();
            if (part.done) controller.close();
            else controller.enqueue(part.value);
          } catch {
            controller.error(new Error('VERCEL_BLOB_READ_FAILED'));
          }
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      });
      const body = guardedR2Body(
        source,
        info.size,
        Date.now() + r2HttpLimits.timeoutMs,
        meta.sha256,
      );
      const consumer = new Response(body);
      transferred = true;
      return {
        key: info.key,
        version: info.version,
        size: info.size,
        etag: info.etag,
        httpEtag: info.httpEtag,
        uploaded: info.uploaded,
        httpMetadata: info.httpMetadata,
        customMetadata: info.customMetadata,
        checksums: info.checksums,
        storageClass: info.storageClass,
        writeHttpMetadata: (headers: Headers) =>
          info.writeHttpMetadata(headers),
        body,
        get bodyUsed() {
          return consumer.bodyUsed;
        },
        arrayBuffer: () => consumer.arrayBuffer(),
        text: () => consumer.text(),
        json<T>() {
          return consumer.json() as Promise<T>;
        },
        blob: () => consumer.blob(),
        bytes: () => consumer.bytes(),
      } as R2ObjectBody;
    } finally {
      if (!transferred) await reader.cancel().catch(() => {});
    }
  }
  return {
    head: (key: string) => read(key, true),
    get(key: string, opts?: R2GetOptions) {
      if (opts && Object.keys(opts).length) return failed();
      return read(key, false);
    },
    async put(
      key: string,
      value: Parameters<R2Bucket['put']>[1],
      opts?: R2PutOptions,
    ) {
      r2PrivateKey(key);
      const wire = encodeR2PutOptions(opts);
      if (
        wire.storageClass ||
        (wire.onlyIf?.etagDoesNotMatch &&
          wire.onlyIf.etagDoesNotMatch !== '*') ||
        wire.onlyIf?.etagMatches === '*'
      )
        return failed();
      const response = new Response(value as BodyInit | null);
      const bytes = await readR2Bytes(response.body, r2HttpLimits.objectBytes);
      const sha256 = hash(bytes);
      if (wire.sha256 && sha256 !== wire.sha256) return failed();
      const meta: Metadata = {
        size: bytes.byteLength,
        sha256,
        httpMetadata: wire.httpMetadata ?? {},
        customMetadata: wire.customMetadata ?? {},
      };
      const json = new TextEncoder().encode(JSON.stringify(meta));
      if (json.length > headerBytes - 12) return failed();
      const envelope = new Uint8Array(headerBytes + bytes.length);
      envelope.set(magic);
      new DataView(envelope.buffer).setUint32(8, json.length);
      envelope.set(json, 12);
      envelope.set(bytes, headerBytes);
      try {
        const saved = await sdk.put(vercelObjectPath(key), envelope, {
          ...options(),
          access: 'private',
          contentType: 'application/octet-stream',
          addRandomSuffix: false,
          allowOverwrite: wire.onlyIf?.etagDoesNotMatch !== '*',
          ...(wire.onlyIf?.etagMatches
            ? { ifMatch: `"${wire.onlyIf.etagMatches}"` }
            : {}),
          cacheControlMaxAge: 60,
        });
        const current = await sdk.head(vercelObjectPath(key), options());
        if (current.etag !== saved.etag || current.size !== envelope.byteLength)
          return failed();
        return object(key, meta, current);
      } catch (error) {
        if (wire.onlyIf && error instanceof blobSdk.BlobPreconditionFailedError)
          return null;
        // An already-existing pathname may be a lost successful write. Never
        // mistake an untyped provider error for proof that the write failed.
        return failed();
      }
    },
    async delete(key: string | string[]) {
      r2PrivateKey(key, true);
      await sdk.del(vercelObjectPath(key), options());
    },
    list: failed,
    createMultipartUpload: failed,
    resumeMultipartUpload: failed,
  } as R2Bucket;
}
