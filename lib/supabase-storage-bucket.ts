import { createHash, randomUUID } from 'node:crypto';
import {
  encodeR2PutOptions,
  nativeR2Object,
  parseR2Object,
  r2HttpLimits,
  r2PrivateKey,
  readR2Bytes,
} from './r2-http-protocol';
import {
  supabaseStorageFailure,
  type SupabaseStorageHttp,
} from './supabase-storage-http';
import type {
  SupabaseStorageManifest,
  SupabaseStorageVersion,
} from './supabase-storage-manifest';

/** R2-shaped storage with real PostgreSQL CAS, not a HEAD-then-overwrite race.
 * Every physical upload has a new path and is verified before publication. */
export function createSupabaseStorageBucket(
  storage: SupabaseStorageHttp,
  manifest: SupabaseStorageManifest,
): R2Bucket {
  async function current(key: string) {
    r2PrivateKey(key, true);
    const head = await manifest.read(key);
    if (!head?.version) return null;
    const version = head.version;
    const wire = parseR2Object(version.wire, key);
    if (!wire.checksums.sha256) return supabaseStorageFailure();
    const actual = await storage.head(version.path);
    if (
      !actual ||
      actual.etag !== wire.httpEtag ||
      actual.size !== wire.size ||
      actual.uploaded !== wire.uploaded
    )
      return supabaseStorageFailure();
    return { wire, actual };
  }
  return {
    async head(key: string) {
      const value = await current(key);
      return value ? nativeR2Object(value.wire) : null;
    },
    async get(key: string, options?: R2GetOptions) {
      if (options && Object.keys(options).length)
        return supabaseStorageFailure();
      const value = await current(key);
      if (!value) return null;
      const object = nativeR2Object(value.wire);
      const body = await storage.get(
        value.actual,
        value.wire.checksums.sha256!,
      );
      const response = new Response(body);
      return {
        key: object.key,
        version: object.version,
        size: object.size,
        etag: object.etag,
        httpEtag: object.httpEtag,
        uploaded: object.uploaded,
        httpMetadata: object.httpMetadata,
        customMetadata: object.customMetadata,
        checksums: object.checksums,
        storageClass: object.storageClass,
        writeHttpMetadata: (headers: Headers) =>
          object.writeHttpMetadata(headers),
        body,
        get bodyUsed() {
          return response.bodyUsed;
        },
        arrayBuffer: () => response.arrayBuffer(),
        text: () => response.text(),
        json<T>() {
          return response.json() as Promise<T>;
        },
        blob: () => response.blob(),
        bytes: () => response.bytes(),
      } as R2ObjectBody;
    },
    async put(
      key: string,
      value: Parameters<R2Bucket['put']>[1],
      options?: R2PutOptions,
    ) {
      r2PrivateKey(key);
      const wireOptions = encodeR2PutOptions(options);
      if (
        wireOptions.storageClass ||
        (wireOptions.onlyIf?.etagDoesNotMatch &&
          wireOptions.onlyIf.etagDoesNotMatch !== '*') ||
        wireOptions.onlyIf?.etagMatches === '*'
      )
        return supabaseStorageFailure();
      const previous = await manifest.read(key);
      const condition = wireOptions.onlyIf;
      if (
        (condition?.etagDoesNotMatch === '*' && previous?.version) ||
        (condition?.etagMatches &&
          previous?.version?.wire.etag !== condition.etagMatches)
      )
        return null;
      const bytes = await readR2Bytes(
        new Response(value as BodyInit | null).body,
        r2HttpLimits.objectBytes,
      );
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (wireOptions.sha256 && wireOptions.sha256 !== sha256)
        return supabaseStorageFailure();
      const revision = randomUUID();
      const path = `partner-hub/objects/v1/${revision}`;
      const saved = await storage.put(path, bytes);
      if (saved.sha256 !== sha256 || saved.size !== bytes.length)
        return supabaseStorageFailure();
      const wire = parseR2Object(
        {
          key,
          version: revision,
          size: saved.size,
          etag: saved.etag.slice(1, -1),
          httpEtag: saved.etag,
          uploaded: saved.uploaded,
          httpMetadata: wireOptions.httpMetadata ?? {},
          customMetadata: wireOptions.customMetadata ?? {},
          checksums: { sha256 },
          storageClass: '',
        },
        key,
      );
      const version: SupabaseStorageVersion = { revision, path, wire };
      const published = await manifest.publish(
        key,
        version,
        condition ? (previous?.revision ?? null) : undefined,
      );
      return published ? nativeR2Object(wire) : null;
    },
    async delete(key: string | string[]) {
      // Existing application handlers authorize and delete one key at a time.
      r2PrivateKey(key, true);
      const previous = await manifest.read(key);
      if (previous?.version && !(await manifest.remove(key, previous.revision)))
        return supabaseStorageFailure();
    },
    list: supabaseStorageFailure,
    createMultipartUpload: supabaseStorageFailure,
    resumeMultipartUpload: supabaseStorageFailure,
  } as R2Bucket;
}
