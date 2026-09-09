import 'server-only';
import { env } from './platform-runtime.supabase';
import { supabaseBackendConfig } from './supabase-backend-config.server';
import { createSupabaseStorageHttp } from './supabase-storage-http';
import { createSupabaseTransferHandler } from './supabase-file-transfer';
import { privateJsonResponse } from './private-response';

// Retain the existing JSON control endpoint; provider choice is build-owned.
export async function handleBlobTransfer(request: Request) {
  try {
    const config = supabaseBackendConfig();
    const db = env.DB;
    if (!db) throw new Error('SUPABASE_UNAVAILABLE');
    return await createSupabaseTransferHandler(
      db,
      config,
      createSupabaseStorageHttp(config),
    )(request);
  } catch {
    return privateJsonResponse(
      { error: '파일 저장소 연결을 확인해 주세요.' },
      { status: 503 },
    );
  }
}
