import {
  R2HttpError,
  r2HttpLimits,
  r2HttpPath,
  r2RequestHeader,
  r2ObjectHeader,
  isR2HttpSecret,
  r2PrivateKey,
  r2Record,
  parseR2Request,
  encodeR2Header,
  decodeR2Header,
  encodeR2PutOptions,
  parseR2Object,
  nativeR2Object,
  guardedR2Body,
  readR2Bytes,
  type R2WireRequest,
} from './r2-http-protocol';

type Options = {
  origin: string;
  secret: string;
  fetcher?: typeof fetch;
  allowLoopback?: boolean;
  timeoutMs?: number;
};
type PutValue = Parameters<R2Bucket['put']>[1];
function invalid(): never {
  throw new R2HttpError('R2_HTTP_INVALID_INPUT');
}
function unsupported(): never {
  throw new R2HttpError('R2_HTTP_UNSUPPORTED');
}
async function putBytes(value: PutValue, deadline: number) {
  if (value === null) return new Uint8Array(0);
  if (typeof value === 'string') value = new TextEncoder().encode(value);
  if (value instanceof Blob) {
    if (value.size > r2HttpLimits.objectBytes) invalid();
    return readR2Bytes(value.stream(), r2HttpLimits.objectBytes, deadline);
  }
  if (value instanceof ReadableStream)
    return readR2Bytes(value, r2HttpLimits.objectBytes, deadline);
  const bytes =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : invalid();
  if (bytes.byteLength > r2HttpLimits.objectBytes) invalid();
  return Uint8Array.from(bytes);
}

export function createR2HttpBucket(options: Options): R2Bucket {
  let origin: URL;
  try {
    origin = new URL(options.origin);
  } catch {
    return invalid();
  }
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/' ||
    (origin.protocol !== 'https:' &&
      !(
        options.allowLoopback &&
        origin.protocol === 'http:' &&
        ['127.0.0.1', '[::1]', 'localhost'].includes(origin.hostname)
      )) ||
    !isR2HttpSecret(options.secret)
  )
    invalid();
  const timeoutMs = options.timeoutMs ?? r2HttpLimits.timeoutMs;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > r2HttpLimits.timeoutMs
  )
    invalid();
  const endpoint = new URL(r2HttpPath, origin).href;
  const secret = options.secret;
  const fetcher = options.fetcher ?? fetch;
  async function execute(
    operation: R2WireRequest,
    bytes?: Uint8Array,
    deadline = Date.now() + timeoutMs,
  ): Promise<R2ObjectBody | R2Object | null | undefined> {
    const encoded = encodeR2Header(parseR2Request(operation));
    const controller = new AbortController();
    let response: Response | undefined;
    let streamReturned = false;
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => {
          controller.abort();
          reject(new R2HttpError('R2_HTTP_OUTCOME_UNKNOWN'));
        },
        Math.max(0, deadline - Date.now()),
      );
    });
    try {
      return await Promise.race([
        timeout,
        (async () => {
          response = await fetcher(endpoint, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${secret}`,
              'content-type': 'application/octet-stream',
              [r2RequestHeader]: encoded,
            },
            ...(bytes ? { body: bytes as BodyInit } : {}),
            signal: controller.signal,
            redirect: 'manual',
            cache: 'no-store',
            credentials: 'omit',
          });
          if (controller.signal.aborted) {
            void response.body?.cancel().catch(() => {});
            throw new Error();
          }
          if (
            response.headers.get('x-partner-hub-r2-version') !== '1' ||
            response.headers.has('content-encoding')
          )
            throw new Error();
          if (response.status !== 200 && response.status !== 204) {
            const body = JSON.parse(
              new TextDecoder('utf-8', { fatal: true }).decode(
                await readR2Bytes(
                  response.body,
                  r2HttpLimits.jsonBytes,
                  deadline,
                ),
              ),
            );
            if (
              !r2Record(body) ||
              body.version !== 1 ||
              Object.keys(body).sort().join(',') !== 'code,version'
            )
              throw new Error();
            if (
              (response.status === 401 || response.status === 403) &&
              body.code === 'R2_HTTP_AUTH_FAILED'
            )
              throw new R2HttpError('R2_HTTP_AUTH_FAILED');
            if (
              (operation.operation === 'get' ||
                operation.operation === 'head') &&
              response.status === 404 &&
              body.code === 'R2_HTTP_NOT_FOUND'
            )
              return null;
            if (
              operation.operation === 'put' &&
              operation.options.onlyIf &&
              response.status === 412 &&
              body.code === 'R2_HTTP_PRECONDITION_FAILED'
            )
              return null;
            throw new Error();
          }
          if (operation.operation === 'delete') {
            if (
              response.status !== 204 ||
              (await readR2Bytes(response.body, 0, deadline)).byteLength
            )
              throw new Error();
            return undefined;
          }
          if (
            response.status !== 200 ||
            response.headers.get('content-type') !== 'application/octet-stream'
          )
            throw new Error();
          const wire = parseR2Object(
            decodeR2Header(response.headers.get(r2ObjectHeader)),
            operation.key,
          );
          const object = nativeR2Object(wire);
          if (operation.operation !== 'get') {
            if ((await readR2Bytes(response.body, 0, deadline)).byteLength)
              throw new Error();
            if (
              operation.operation === 'put' &&
              (object.size !== operation.size ||
                (operation.options.sha256 &&
                  wire.checksums.sha256 !== operation.options.sha256))
            )
              throw new Error();
            return object;
          }
          const contentLength = response.headers.get('content-length');
          if (
            !response.body ||
            (contentLength !== null &&
              (!/^\d+$/.test(contentLength) ||
                Number(contentLength) !== object.size))
          )
            throw new Error();
          const body = guardedR2Body(
            response.body,
            object.size,
            deadline,
            wire.checksums.sha256,
          );
          const consumer = new Response(body, {
            headers: object.httpMetadata?.contentType
              ? { 'content-type': object.httpMetadata.contentType }
              : {},
          });
          streamReturned = true;
          return {
            ...wire,
            uploaded: object.uploaded,
            httpMetadata: object.httpMetadata,
            checksums: object.checksums,
            writeHttpMetadata: (headers: Headers) =>
              object.writeHttpMetadata(headers),
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
            bytes: async () => new Uint8Array(await consumer.arrayBuffer()),
          };
        })(),
      ]);
    } catch (error) {
      if (error instanceof R2HttpError && error.code === 'R2_HTTP_AUTH_FAILED')
        throw error;
      throw new R2HttpError('R2_HTTP_OUTCOME_UNKNOWN');
    } finally {
      clearTimeout(timer!);
      if (!streamReturned) {
        controller.abort();
        void response?.body?.cancel().catch(() => {});
      }
    }
  }
  return {
    async head(key: string) {
      r2PrivateKey(key, true);
      return (await execute({
        version: 1,
        operation: 'head',
        key,
      })) as R2Object | null;
    },
    async get(key: string, getOptions?: R2GetOptions) {
      r2PrivateKey(key, true);
      if (
        getOptions !== undefined &&
        (!r2Record(getOptions) || Object.keys(getOptions).length)
      )
        unsupported();
      return (await execute({
        version: 1,
        operation: 'get',
        key,
      })) as R2ObjectBody | null;
    },
    async put(key: string, value: PutValue, putOptions?: R2PutOptions) {
      r2PrivateKey(key);
      const wire = encodeR2PutOptions(putOptions);
      const deadline = Date.now() + timeoutMs;
      const bytes = await putBytes(value, deadline);
      return (await execute(
        {
          version: 1,
          operation: 'put',
          key,
          size: bytes.byteLength,
          options: wire,
        },
        bytes,
        deadline,
      )) as R2Object | null;
    },
    async delete(key: string | string[]) {
      if (typeof key !== 'string') unsupported();
      r2PrivateKey(key, true);
      await execute({ version: 1, operation: 'delete', key });
    },
    list: unsupported,
    createMultipartUpload: unsupported,
    resumeMultipartUpload: unsupported,
  } as R2Bucket;
}
