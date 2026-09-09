import 'server-only';
import { after } from 'next/server';
import { nextBackendConfig } from './next-backend-config.server';
import { createNextD1HttpDatabase } from './d1-http-client.next';
import { createNextR2HttpBucket } from './r2-http-client.next';

// No network calls or database initialization while importing/building.
function bindings() {
  try {
    const config = nextBackendConfig();
    return {
      DB: createNextD1HttpDatabase(config.d1.origin, config.d1.secret),
      AI_SOURCE_FILES: createNextR2HttpBucket(
        config.r2.origin,
        config.r2.secret,
      ),
    };
  } catch {
    return undefined;
  }
}
const remote = bindings();
export const env = {
  DB: remote?.DB,
  AI_SOURCE_FILES: remote?.AI_SOURCE_FILES,
  get ANTHROPIC_API_KEY() {
    return remote ? process.env.ANTHROPIC_API_KEY : undefined;
  },
  get ANTHROPIC_MODEL() {
    return process.env.ANTHROPIC_MODEL;
  },
  get ANTHROPIC_EXTERNAL_PROCESSING_ENABLED() {
    return remote ? process.env.ANTHROPIC_EXTERNAL_PROCESSING_ENABLED : 'false';
  },
};
export function waitUntil(task: Promise<unknown>) {
  after(task);
}
