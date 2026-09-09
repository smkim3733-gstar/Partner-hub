import { register } from 'node:module';
import type { TestContext } from 'node:test';
import { env } from 'cloudflare:workers';
import { postgresFixture } from './supabase-postgres-fixture';
import { flushWaitUntil } from './runtime-mock.mjs';

// Select actual standalone auth, retaining only the runtime binding seam.
register('./supabase-auth-loader.mjs', import.meta.url);
export const postgresTestOrigin = 'https://postgres-runtime.example.test';
export async function postgresRuntimeFixture(t: TestContext, options: { flowRoot?: boolean } = {}) {
  const fixture = await postgresFixture(options);
  const runtime = env as unknown as { DB: D1Database };
  const oldDb = runtime.DB;
  const config = {
    PARTNER_HUB_NEXT_BACKEND: 'supabase-v1', PARTNER_HUB_BACKEND_ENABLED: '1',
    PARTNER_HUB_LOCAL_STORAGE: '0', PARTNER_HUB_APP_ORIGIN: postgresTestOrigin,
    SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
    SUPABASE_DATABASE_URL: 'postgresql://postgres.abcdefghijklmnopqrst:synthetic@aws-0-region.pooler.supabase.com:6543/postgres',
    SUPABASE_SECRET_KEY: `sb_secret_${'x'.repeat(32)}`,
    SUPABASE_STORAGE_BUCKET: 'synthetic-private',
  };
  const previous = Object.keys(config).map((key) => [key, process.env[key]] as const);
  Object.assign(process.env, config);
  runtime.DB = fixture.db;
  t.after(async () => {
    await flushWaitUntil();
    runtime.DB = oldDb;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await fixture.close();
  });
  return fixture;
}
