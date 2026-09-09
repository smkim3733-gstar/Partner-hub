// Only selected by the native regression harness, never by Sites or Next builds.
import { env as native, waitUntil } from 'cloudflare:workers';
import { createD1HttpDatabase } from '../lib/d1-http-client';
import { createR2HttpBucket } from '../lib/r2-http-client';
const bindings = native as unknown as {
  D1_HTTP?: Fetcher;
  D1_BRIDGE_SECRET: string;
  R2_HTTP?: Fetcher;
  R2_BRIDGE_SECRET: string;
  AI_SOURCE_FILES: R2Bucket;
};
export const env = {
  ...native,
  ...(bindings.D1_HTTP
    ? {
        DB: createD1HttpDatabase({
          origin: 'https://d1-bridge.internal',
          secret: bindings.D1_BRIDGE_SECRET,
          fetcher: (input, init) => bindings.D1_HTTP!.fetch(input, init),
        }),
      }
    : {}),
  ...(bindings.R2_HTTP
    ? {
        AI_SOURCE_FILES: createR2HttpBucket({
          origin: 'https://r2-bridge.internal',
          secret: bindings.R2_BRIDGE_SECRET,
          fetcher: (input, init) => bindings.R2_HTTP!.fetch(input, init),
        }),
      }
    : {}),
};
export { waitUntil };
