import 'server-only';
import { readSupabaseBackendConfig } from './supabase-backend-config';

export function supabaseBackendConfig() {
  return readSupabaseBackendConfig(process.env);
}
