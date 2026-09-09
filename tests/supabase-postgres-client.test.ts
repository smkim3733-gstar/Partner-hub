import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createSupabaseDatabaseClient,
  supabasePostgresClientOptions,
  type PostgresJsFactory,
} from '../lib/supabase-postgres-client';

void test('Supabase client disables prepared statements and bounds serverless connections', async () => {
  let observedUrl = '';
  let observedOptions: unknown;
  const queries: string[] = [];
  const executor = {
    async unsafe(query: string) {
      queries.push(query);
      return Object.assign(
        query.startsWith('SELECT') ? [{ ready: 1 }] : [],
        { command: 'SELECT', count: 1 },
      );
    },
  };
  const factory: PostgresJsFactory = (url, options) => {
    observedUrl = url;
    observedOptions = options;
    return {
      ...executor,
      async begin(callback) {
        return callback(executor);
      },
    };
  };
  const url =
    'postgresql://postgres.project:password@aws-0-region.pooler.supabase.com:6543/postgres';
  const db = createSupabaseDatabaseClient(url, factory);
  assert.equal(await db.prepare('SELECT 1 AS ready').first('ready'), 1);
  assert.equal(observedUrl, url);
  assert.deepEqual(observedOptions, supabasePostgresClientOptions);
  assert.equal(supabasePostgresClientOptions.prepare, false);
  assert.equal(supabasePostgresClientOptions.max, 1);
  assert.equal(supabasePostgresClientOptions.types.bigint.parse('1788950935000'), BigInt('1788950935000'));
  assert.deepEqual(queries.slice(0, 4), [
    'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE',
    'SET LOCAL search_path TO partner_hub, pg_catalog',
    "SET LOCAL statement_timeout TO '25000ms'",
    "SET LOCAL lock_timeout TO '5000ms'",
  ]);
});
