import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

export const r2HttpPath = '/internal/r2/v1/object';
export const r2RequestHeader = 'x-partner-hub-r2-request';
export const r2ObjectHeader = 'x-partner-hub-r2-object';
export const r2HttpLimits = {
  objectBytes: 25 * 1024 * 1024,
  headerBytes: 8192,
  jsonBytes: 16_384,
  timeoutMs: 120_000,
} as const;
export class R2HttpError extends Error {
  constructor(
    public readonly code:
      | 'R2_HTTP_INVALID_INPUT'
      | 'R2_HTTP_UNSUPPORTED'
      | 'R2_HTTP_AUTH_FAILED'
      | 'R2_HTTP_OUTCOME_UNKNOWN',
  ) {
    super(code);
  }
}
export function invalidR2(): never {
  throw new R2HttpError('R2_HTTP_INVALID_INPUT');
}
export function r2Record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalidR2();
}
function text(value: unknown, max = 1024): value is string {
  return (
    typeof value === 'string' &&
    value.length <= max &&
    !Array.from(value).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  );
}
export function r2PrivateKey(
  value: unknown,
  allowLegacy = false,
): asserts value is string {
  if (
    typeof value !== 'string' ||
    (!/^(company-source|consulting-flow)\/[A-Za-z0-9_-]{1,200}$/.test(value) &&
      !(allowLegacy && /^[A-Za-z0-9_-]{1,200}$/.test(value)))
  )
    invalidR2();
}
export function isR2HttpSecret(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
export function encodeR2Header(value: unknown) {
  const encoded = Buffer.from(JSON.stringify(value)).toString('base64url');
  if (!encoded || encoded.length > r2HttpLimits.headerBytes) invalidR2();
  return encoded;
}
export function decodeR2Header(value: string | null): unknown {
  if (
    !value ||
    value.length > r2HttpLimits.headerBytes ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    invalidR2();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) invalidR2();
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return invalidR2();
  }
}
const httpFields = {
  contentType: 'content-type',
  contentLanguage: 'content-language',
  contentDisposition: 'content-disposition',
  contentEncoding: 'content-encoding',
  cacheControl: 'cache-control',
} as const;
type WireHttpMetadata = Partial<
  Record<keyof typeof httpFields | 'cacheExpiry', string>
>;
function httpMetadata(value: unknown): WireHttpMetadata {
  if (!r2Record(value)) invalidR2();
  keys(value, [...Object.keys(httpFields), 'cacheExpiry']);
  for (const [key, item] of Object.entries(value)) {
    if (
      !text(item) ||
      (key === 'cacheExpiry' &&
        (!Number.isFinite(Date.parse(item)) ||
          new Date(item).toISOString() !== item))
    )
      invalidR2();
  }
  return value as WireHttpMetadata;
}
function customMetadata(value: unknown): Record<string, string> {
  if (
    !r2Record(value) ||
    Buffer.byteLength(JSON.stringify(value)) > 2048 ||
    Object.entries(value).some(
      ([key, item]) =>
        !text(key, 256) ||
        !text(item, 1024) ||
        ['__proto__', 'constructor', 'prototype'].includes(key),
    )
  )
    invalidR2();
  return value as Record<string, string>;
}
export type R2WirePutOptions = {
  onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string };
  httpMetadata?: WireHttpMetadata;
  customMetadata?: Record<string, string>;
  sha256?: string;
  storageClass?: string;
};
function parsePutOptions(value: unknown): R2WirePutOptions {
  if (!r2Record(value)) invalidR2();
  keys(value, [
    'onlyIf',
    'httpMetadata',
    'customMetadata',
    'sha256',
    'storageClass',
  ]);
  if (value.onlyIf !== undefined) {
    if (!r2Record(value.onlyIf)) invalidR2();
    keys(value.onlyIf, ['etagMatches', 'etagDoesNotMatch']);
    if (
      Object.keys(value.onlyIf).length !== 1 ||
      Object.values(value.onlyIf).some((etag) => !text(etag, 256) || !etag)
    )
      invalidR2();
  }
  if (value.httpMetadata !== undefined) httpMetadata(value.httpMetadata);
  if (value.customMetadata !== undefined) customMetadata(value.customMetadata);
  if (value.sha256 !== undefined && !isR2HttpSecret(value.sha256)) invalidR2();
  if (
    value.storageClass !== undefined &&
    !['Standard', 'InfrequentAccess'].includes(value.storageClass as string)
  )
    invalidR2();
  return value as R2WirePutOptions;
}
export function encodeR2PutOptions(
  options: R2PutOptions = {},
): R2WirePutOptions {
  if (!r2Record(options)) invalidR2();
  if (
    Object.keys(options).some(
      (key) =>
        ![
          'onlyIf',
          'httpMetadata',
          'customMetadata',
          'sha256',
          'storageClass',
        ].includes(key),
    ) ||
    options.onlyIf instanceof Headers ||
    options.httpMetadata instanceof Headers
  )
    throw new R2HttpError('R2_HTTP_UNSUPPORTED');
  const wire: Record<string, unknown> = { ...options };
  if (options.sha256 !== undefined) {
    const checksum = options.sha256;
    wire.sha256 =
      typeof checksum === 'string'
        ? checksum
        : ArrayBuffer.isView(checksum)
          ? Buffer.from(
              checksum.buffer,
              checksum.byteOffset,
              checksum.byteLength,
            ).toString('hex')
          : Buffer.from(checksum).toString('hex');
  }
  const metadata = options.httpMetadata as R2HTTPMetadata | undefined;
  if (metadata)
    wire.httpMetadata = {
      ...metadata,
      ...(metadata.cacheExpiry
        ? { cacheExpiry: metadata.cacheExpiry.toISOString() }
        : {}),
    };
  return parsePutOptions(wire);
}
export function nativeR2PutOptions(wire: R2WirePutOptions): R2PutOptions {
  parsePutOptions(wire);
  const { httpMetadata, ...rest } = wire;
  return {
    ...rest,
    ...(httpMetadata
      ? {
          httpMetadata: {
            ...httpMetadata,
            ...(httpMetadata.cacheExpiry
              ? { cacheExpiry: new Date(httpMetadata.cacheExpiry) }
              : {}),
          } as R2HTTPMetadata,
        }
      : {}),
  };
}
export type R2WireRequest =
  | { version: 1; operation: 'get' | 'head' | 'delete'; key: string }
  | {
      version: 1;
      operation: 'put';
      key: string;
      size: number;
      options: R2WirePutOptions;
    };
export function parseR2Request(value: unknown): R2WireRequest {
  if (
    !r2Record(value) ||
    value.version !== 1 ||
    !['get', 'head', 'put', 'delete'].includes(value.operation as string)
  )
    invalidR2();
  // Historical flat keys remain readable/deletable through the existing
  // ownership ledger checks. New writes are confined to the two namespaces.
  r2PrivateKey(value.key, value.operation !== 'put');
  keys(
    value,
    value.operation === 'put'
      ? ['version', 'operation', 'key', 'size', 'options']
      : ['version', 'operation', 'key'],
  );
  if (value.operation === 'put') {
    if (
      !Number.isSafeInteger(value.size) ||
      (value.size as number) < 0 ||
      (value.size as number) > r2HttpLimits.objectBytes
    )
      invalidR2();
    parsePutOptions(value.options);
  }
  return value as R2WireRequest;
}
const checksumSizes = {
  md5: 32,
  sha1: 40,
  sha256: 64,
  sha384: 96,
  sha512: 128,
} as const;
export type R2WireObject = {
  key: string;
  version: string;
  size: number;
  etag: string;
  httpEtag: string;
  uploaded: string;
  httpMetadata: WireHttpMetadata;
  customMetadata: Record<string, string>;
  checksums: R2StringChecksums;
  storageClass: string;
};
export function parseR2Object(value: unknown, key: string): R2WireObject {
  if (!r2Record(value)) invalidR2();
  keys(value, [
    'key',
    'version',
    'size',
    'etag',
    'httpEtag',
    'uploaded',
    'httpMetadata',
    'customMetadata',
    'checksums',
    'storageClass',
  ]);
  if (
    value.key !== key ||
    !text(value.version, 256) ||
    !value.version ||
    !text(value.etag, 256) ||
    !value.etag ||
    value.httpEtag !== `"${value.etag}"` ||
    !Number.isSafeInteger(value.size) ||
    (value.size as number) < 0 ||
    (value.size as number) > r2HttpLimits.objectBytes ||
    typeof value.uploaded !== 'string' ||
    !Number.isFinite(Date.parse(value.uploaded)) ||
    new Date(value.uploaded).toISOString() !== value.uploaded ||
    // Native local R2 returns an empty storageClass for its default class.
    // Preserve that observed value; do not invent a Standard-class guarantee.
    !['', 'Standard', 'InfrequentAccess'].includes(
      value.storageClass as string,
    ) ||
    !r2Record(value.checksums)
  )
    invalidR2();
  httpMetadata(value.httpMetadata);
  customMetadata(value.customMetadata);
  keys(value.checksums, Object.keys(checksumSizes));
  for (const [name, checksum] of Object.entries(value.checksums))
    if (
      typeof checksum !== 'string' ||
      checksum.length !== checksumSizes[name as keyof typeof checksumSizes] ||
      !/^[a-f0-9]+$/.test(checksum)
    )
      invalidR2();
  return value as R2WireObject;
}
export function encodeR2Object(object: R2Object): R2WireObject {
  const checksums: Record<string, string> = {};
  for (const name of Object.keys(
    checksumSizes,
  ) as (keyof typeof checksumSizes)[]) {
    const checksum = object.checksums[name];
    if (checksum) checksums[name] = Buffer.from(checksum).toString('hex');
  }
  return parseR2Object(
    {
      key: object.key,
      version: object.version,
      size: object.size,
      etag: object.etag,
      httpEtag: object.httpEtag,
      uploaded: object.uploaded.toISOString(),
      httpMetadata: Object.fromEntries(
        Object.entries({
          ...object.httpMetadata,
          ...(object.httpMetadata?.cacheExpiry
            ? { cacheExpiry: object.httpMetadata.cacheExpiry.toISOString() }
            : {}),
        }).filter(([, value]) => value !== undefined),
      ),
      customMetadata: object.customMetadata ?? {},
      checksums,
      storageClass: object.storageClass,
    },
    object.key,
  );
}
export function nativeR2Object(wire: R2WireObject): R2Object {
  const metadata = nativeR2PutOptions({ httpMetadata: wire.httpMetadata })
    .httpMetadata as R2HTTPMetadata;
  const checksums: R2Checksums = {
    ...Object.fromEntries(
      Object.entries(wire.checksums).map(([name, value]) => [
        name,
        Uint8Array.from(Buffer.from(value!, 'hex')).buffer,
      ]),
    ),
    toJSON: () => ({ ...wire.checksums }),
  };
  return {
    ...wire,
    uploaded: new Date(wire.uploaded),
    httpMetadata: metadata,
    checksums,
    writeHttpMetadata(headers: Headers) {
      for (const [key, name] of Object.entries(httpFields)) {
        const value = metadata[key as keyof typeof httpFields];
        if (value !== undefined) headers.set(name, value);
      }
      if (metadata.cacheExpiry)
        headers.set('expires', metadata.cacheExpiry.toUTCString());
    },
  };
}

/** A bounded, single-pass stream. Truncation, corruption, timeout and cancel
 * remain observable; no implicit retry or complete-looking partial object. */
export function guardedR2Body(
  source: ReadableStream<Uint8Array>,
  expectedSize: number,
  deadline: number,
  sha256?: string,
) {
  const reader = source.getReader();
  const hash = sha256 ? createHash('sha256') : undefined;
  let total = 0;
  let terminal = false;
  let timer: ReturnType<typeof setTimeout>;
  const finish = () => {
    terminal = true;
    clearTimeout(timer);
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setTimeout(
        () => {
          if (terminal) return;
          finish();
          void reader.cancel().catch(() => {});
          controller.error(new R2HttpError('R2_HTTP_OUTCOME_UNKNOWN'));
        },
        Math.max(0, deadline - Date.now()),
      );
    },
    async pull(controller) {
      try {
        const part = await reader.read();
        if (terminal) return;
        if (part.done) {
          if (total !== expectedSize || (hash && hash.digest('hex') !== sha256))
            throw new Error();
          finish();
          controller.close();
        } else {
          if (!(part.value instanceof Uint8Array)) throw new Error();
          total += part.value.byteLength;
          if (total > expectedSize || total > r2HttpLimits.objectBytes)
            throw new Error();
          hash?.update(part.value);
          controller.enqueue(part.value);
        }
      } catch {
        if (terminal) return;
        finish();
        void reader.cancel().catch(() => {});
        controller.error(new R2HttpError('R2_HTTP_OUTCOME_UNKNOWN'));
      }
    },
    cancel(reason) {
      finish();
      return reader.cancel(reason);
    },
  });
}
export async function readR2Bytes(
  source: ReadableStream<Uint8Array> | null,
  max: number,
  deadline = Date.now() + r2HttpLimits.timeoutMs,
) {
  if (!source) return new Uint8Array(0);
  const reader = source.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    for (;;) {
      const part = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new R2HttpError('R2_HTTP_OUTCOME_UNKNOWN')),
            Math.max(0, deadline - Date.now()),
          );
        }),
      ]);
      clearTimeout(timer);
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) invalidR2();
      total += part.value.byteLength;
      if (total > max) invalidR2();
      chunks.push(Uint8Array.from(part.value));
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
