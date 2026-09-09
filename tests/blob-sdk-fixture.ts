import { createHash } from 'node:crypto';
import * as blobSdk from '@vercel/blob';
import assert from 'node:assert/strict';
export function blobFixture() {
  const objects = new Map<string, Uint8Array>();
  const calls: string[] = [];
  function info(path: string) {
    const bytes = objects.get(path);
    if (!bytes) return null;
    return {
      pathname: path,
      size: bytes.length,
      contentType: 'application/octet-stream',
      uploadedAt: new Date('2026-09-09T00:00:00Z'),
      etag: `"${createHash('sha256').update(bytes).digest('hex')}"`,
      url: `https://synthetic.private.blob.vercel-storage.com/${path}`,
      downloadUrl: '',
      cacheControl: 'private',
      contentDisposition: '',
    };
  }
  const sdk = {
    async put(
      path: string,
      value: BodyInit,
      options: { access: string; allowOverwrite?: boolean; ifMatch?: string },
    ) {
      calls.push('put');
      assert.equal(options.access, 'private');
      const old = info(path);
      if (
        (options.ifMatch && options.ifMatch !== old?.etag) ||
        (!options.allowOverwrite && old)
      )
        throw new blobSdk.BlobPreconditionFailedError();
      objects.set(
        path,
        new Uint8Array(await new Response(value).arrayBuffer()),
      );
      return info(path)!;
    },
    async head(path: string) {
      calls.push('head');
      const result = info(path);
      if (!result) throw new blobSdk.BlobNotFoundError();
      return result;
    },
    async get(path: string, options: { access: string; useCache: boolean }) {
      calls.push('get');
      assert.equal(options.access, 'private');
      assert.equal(options.useCache, false);
      const blob = info(path);
      if (!blob) return null;
      return {
        statusCode: 200,
        blob,
        stream: new Response(Uint8Array.from(objects.get(path)!)).body!,
        headers: new Headers(),
      };
    },
    async del(path: string) {
      calls.push('del');
      objects.delete(path);
    },
  } as unknown as typeof blobSdk;
  return { objects, calls, sdk };
}
