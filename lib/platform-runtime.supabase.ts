import 'server-only';
import { after } from 'next/server';
import { supabaseDatabase } from '@/lib/supabase-postgres-client.server';
import { supabaseBackendConfig } from './supabase-backend-config.server';
import { createSupabaseStorageHttp } from './supabase-storage-http';
import { createSupabaseStorageManifest } from './supabase-storage-manifest';
import { createSupabaseStorageBucket } from './supabase-storage-bucket';

let cached: { DB: D1Database; AI_SOURCE_FILES: R2Bucket } | undefined;

function bindings() {
  try {
    const config = supabaseBackendConfig();
    if (!cached) {
      const DB = supabaseDatabase();
      cached = {
        DB,
        AI_SOURCE_FILES: createSupabaseStorageBucket(
          createSupabaseStorageHttp(config),
          createSupabaseStorageManifest(DB),
        ),
      };
    }
    return cached;
  } catch {
    return undefined;
  }
}
export const env = {
  // Configuration and clients are request-time concerns, not build-time I/O.
  // The client module caches the database after successful configuration.
  get DB(): D1Database | undefined {
    return bindings()?.DB;
  },
  get AI_SOURCE_FILES(): R2Bucket | undefined {
    return bindings()?.AI_SOURCE_FILES;
  },
  get ANTHROPIC_API_KEY() {
    return bindings() ? process.env.ANTHROPIC_API_KEY : undefined;
  },
  get ANTHROPIC_MODEL() {
    return process.env.ANTHROPIC_MODEL;
  },
  get ANTHROPIC_EXTERNAL_PROCESSING_ENABLED() {
    return bindings()
      ? process.env.ANTHROPIC_EXTERNAL_PROCESSING_ENABLED
      : 'false';
  },
};

export function waitUntil(task: Promise<unknown>) {
  after(task);
}
