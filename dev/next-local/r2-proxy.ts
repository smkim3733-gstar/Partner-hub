import { MAX_COMPANY_FILE_BYTES } from '../../lib/company-file-policy';
import { nextLocalStorageEnabled } from '../../lib/next-local-storage-policy.mjs';

/** A Node File stream loses its known length across Wrangler's local RPC.
 * Buffer only this development boundary, before the first put, retaining all
 * conditional-write and checksum options. The native Worker stays streaming. */
export function createLocalR2Bucket(bucket: R2Bucket): R2Bucket {
  if (!nextLocalStorageEnabled(process.env))
    throw new Error('Local R2 adaptation requires opted-in local next dev.');
  return new Proxy(bucket, {
    get(target, property) {
      if (property === 'put')
        return async (...args: Parameters<R2Bucket['put']>) => {
          const [key, value, options] = args;
          return target.put(key, await localR2PutValue(value), options);
        };
      const member = Reflect.get(target, property, target);
      return typeof member === 'function' ? member.bind(target) : member;
    },
  });
}

export async function localR2PutValue(value: Parameters<R2Bucket['put']>[1]) {
  if (!(value instanceof ReadableStream)) return value;
  const reader = value.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      if (!(part.value instanceof Uint8Array))
        throw new Error('Local R2 stream must contain bytes.');
      size += part.value.byteLength;
      if (size > MAX_COMPANY_FILE_BYTES)
        throw new Error('Local R2 stream exceeds the private file limit.');
      chunks.push(Uint8Array.from(part.value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}
