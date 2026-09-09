import postgres from 'postgres';
import {
  createSupabasePostgresDatabase,
  type SupabasePostgresClient,
  type SupabasePostgresExecutor,
} from './supabase-postgres-database';

type PostgresJsResult = Record<string, unknown>[] & {
  count?: number;
  command?: string;
};
type PostgresJsExecutor = {
  unsafe(
    query: string,
    parameters?: readonly unknown[],
  ): PromiseLike<PostgresJsResult>;
};
type PostgresJsClient = PostgresJsExecutor & {
  begin<T>(
    callback: (transaction: PostgresJsExecutor) => Promise<T>,
  ): PromiseLike<T>;
};
export type PostgresJsFactory = (
  url: string,
  options: typeof supabasePostgresClientOptions,
) => PostgresJsClient;

// Supavisor transaction mode does not support prepared statements. Keep the
// client pool small in Vercel functions and recycle connections frequently.
export const supabasePostgresClientOptions = Object.freeze({
  prepare: false,
  max: 1,
  connect_timeout: 10,
  idle_timeout: 20,
  max_lifetime: 60,
  fetch_types: false,
  ssl: 'require' as const,
  onnotice: false as const,
  // int8 includes epoch milliseconds and COUNT(*). Preserve its type so the
  // D1 adapter can reject unsafe integers instead of silently returning text.
  types: { bigint: postgres.BigInt },
});

function executor(client: PostgresJsExecutor): SupabasePostgresExecutor {
  return {
    async unsafe(query, parameters = []) {
      const rows = await client.unsafe(query, parameters);
      return Object.assign([...rows], {
        count: rows.count,
        command: rows.command,
      });
    },
  };
}

export function createSupabaseDatabaseClient(
  databaseUrl: string,
  factory: PostgresJsFactory,
) {
  const raw = factory(databaseUrl, supabasePostgresClientOptions);
  const client: SupabasePostgresClient = {
    ...executor(raw),
    async begin(callback) {
      return await raw.begin((transaction) => callback(executor(transaction)));
    },
  };
  return createSupabasePostgresDatabase(client);
}
