import 'server-only';
import { after } from 'next/server';
import { createClient } from '@libsql/client/web';
import { createTursoDatabase } from './turso-database';
import { createVercelBlobBucket } from './vercel-blob-bucket';
import { vercelStorageConfig } from './vercel-storage-config.server';
import { guardTursoSchema } from './vercel-schema-guard';

// No connection, schema mutation or provider request at import/build time.
let cached: { DB: D1Database; AI_SOURCE_FILES: R2Bucket } | undefined;
function bindings() {
  const config = vercelStorageConfig();
  return (cached ??= {
    DB: createTursoDatabase(
      guardTursoSchema(
        createClient({
          url: config.databaseUrl,
          authToken: config.authToken,
          intMode: 'number',
        }),
      ),
    ),
    AI_SOURCE_FILES: createVercelBlobBucket(config.blobToken),
  });
}
export const env = {
  get DB() {
    return bindings().DB;
  },
  get AI_SOURCE_FILES() {
    return bindings().AI_SOURCE_FILES;
  },
  get ANTHROPIC_API_KEY() {
    vercelStorageConfig();
    return process.env.ANTHROPIC_API_KEY;
  },
  get ANTHROPIC_MODEL() {
    return process.env.ANTHROPIC_MODEL;
  },
  get ANTHROPIC_EXTERNAL_PROCESSING_ENABLED() {
    return process.env.ANTHROPIC_EXTERNAL_PROCESSING_ENABLED ?? 'false';
  },
};
export function waitUntil(task: Promise<unknown>) {
  after(task);
}
