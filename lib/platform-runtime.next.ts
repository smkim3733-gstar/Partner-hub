import 'server-only';
import { after } from 'next/server';
import { loadNextLocalBindings } from '@/lib/next-local-bindings';

const local = await loadNextLocalBindings();

// Only opted-in local development can have bindings at this stage.
// Production D1/R2 adapters remain absent until storage migration is configured.
// Never interpret process.env.DB or process.env.AI_SOURCE_FILES as bindings.
export const env: {
  DB?: D1Database;
  AI_SOURCE_FILES?: R2Bucket;
  readonly ANTHROPIC_API_KEY?: string;
  readonly ANTHROPIC_MODEL?: string;
  readonly ANTHROPIC_EXTERNAL_PROCESSING_ENABLED?: string;
} = {
  DB: local?.DB,
  AI_SOURCE_FILES: local?.AI_SOURCE_FILES,
  get ANTHROPIC_API_KEY() {
    return local ? undefined : process.env.ANTHROPIC_API_KEY;
  },
  get ANTHROPIC_MODEL() {
    return process.env.ANTHROPIC_MODEL;
  },
  get ANTHROPIC_EXTERNAL_PROCESSING_ENABLED() {
    return local ? 'false' : process.env.ANTHROPIC_EXTERNAL_PROCESSING_ENABLED;
  },
};

export function waitUntil(task: Promise<unknown>) {
  after(task);
}
