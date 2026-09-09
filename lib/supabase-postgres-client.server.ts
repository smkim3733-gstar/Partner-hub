import 'server-only';
import postgres from 'postgres';
import {
  createSupabaseDatabaseClient,
  type PostgresJsFactory,
} from './supabase-postgres-client';
import { supabaseBackendConfig } from './supabase-backend-config.server';

let cached: D1Database | undefined;

export function supabaseDatabase() {
  if (cached) return cached;
  const config = supabaseBackendConfig();
  return (cached = createSupabaseDatabaseClient(
    config.databaseUrl,
    postgres as unknown as PostgresJsFactory,
  ));
}
