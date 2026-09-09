import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSupabaseBackendConfig } from '../lib/supabase-backend-config';
import { supabaseBackendSelected } from '../lib/supabase-backend-policy.mjs';
import { nextRemoteBackendSelected } from '../lib/next-backend-policy.mjs';
import { vercelStorageSelected } from '../lib/vercel-storage-policy.mjs';
import { vercelRateLimitClientKey } from '../lib/vercel-client-address';

const projectRef = 'yievsveuxjnbygatvjtb';
const configured = {
  PARTNER_HUB_NEXT_BACKEND: 'supabase-v1',
  PARTNER_HUB_BACKEND_ENABLED: '1',
  PARTNER_HUB_APP_ORIGIN: 'https://partner.example.test',
  SUPABASE_URL: `https://${projectRef}.supabase.co`,
  SUPABASE_DATABASE_URL: `postgresql://postgres.${projectRef}:encoded-password@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require`,
  SUPABASE_SECRET_KEY: `sb_secret_${'a'.repeat(32)}`,
  SUPABASE_STORAGE_BUCKET: 'partner-hub-private',
};

void test('Next Supabase aliases select its runtime, admin authentication and Vercel address boundary together', async () => {
  const keys = [
    'PARTNER_HUB_NEXT_BACKEND',
    'PARTNER_HUB_LOCAL_STORAGE',
    'NODE_ENV',
  ];
  const previous = keys.map((key) => process.env[key]);
  try {
    process.env.PARTNER_HUB_NEXT_BACKEND = 'supabase-v1';
    process.env.PARTNER_HUB_LOCAL_STORAGE = '0';
    Object.assign(process.env, { NODE_ENV: 'production' });
    const { default: config } = await import('../next.config');
    const aliases = config.turbopack!.resolveAlias!;
    for (const platformModule of [
      'runtime',
      'server-gate',
      'admin-auth',
      'auth-capabilities',
    ])
      assert.equal(
        aliases[`@/lib/platform-${platformModule}`],
        `./lib/platform-${platformModule}.supabase.ts`,
      );
    assert.equal(
      aliases['@/lib/platform-client-address'],
      './lib/platform-client-address.remote.ts',
    );
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});

void test('Supabase backend requires explicit selection and rejects local mixing', () => {
  assert.equal(supabaseBackendSelected(configured), true);
  assert.equal(nextRemoteBackendSelected(configured), false);
  assert.equal(vercelStorageSelected({ ...configured, VERCEL: '1' }), false);
  assert.equal(supabaseBackendSelected({ VERCEL: '1' }), false);
  assert.equal(
    supabaseBackendSelected({ PARTNER_HUB_NEXT_BACKEND: 'disabled' }),
    false,
  );
  assert.throws(() =>
    supabaseBackendSelected({
      ...configured,
      PARTNER_HUB_LOCAL_STORAGE: '1',
    }),
  );
});

void test('Supabase rate limits trust the Vercel edge address only on the configured deployment', () => {
  const request = new Request(
    configured.PARTNER_HUB_APP_ORIGIN + '/api/auth/login',
    {
      headers: { 'x-vercel-forwarded-for': '198.51.100.20' },
    },
  );
  assert.equal(vercelRateLimitClientKey(request, configured), null);
  const deployed = { ...configured, VERCEL: '1', VERCEL_ENV: 'production' };
  assert.equal(
    vercelRateLimitClientKey(request, deployed),
    'vercel-ip:198.51.100.20',
  );
  assert.equal(
    vercelRateLimitClientKey(request, {
      ...deployed,
      PARTNER_HUB_BACKEND_ENABLED: '0',
    }),
    null,
  );
  assert.equal(
    vercelRateLimitClientKey(
      new Request('https://evil.test', { headers: request.headers }),
      deployed,
    ),
    null,
  );
});

void test('Supabase server configuration binds API, pooler and project identity', () => {
  const result = readSupabaseBackendConfig(configured);
  assert.equal(result.projectRef, projectRef);
  assert.equal(result.supabaseUrl, configured.SUPABASE_URL);
  assert.equal(result.databaseUrl, configured.SUPABASE_DATABASE_URL);
  assert.equal(result.storageBucket, configured.SUPABASE_STORAGE_BUCKET);
  for (const key of [
    'PARTNER_HUB_APP_ORIGIN',
    'SUPABASE_URL',
    'SUPABASE_DATABASE_URL',
    'SUPABASE_SECRET_KEY',
    'SUPABASE_STORAGE_BUCKET',
  ])
    assert.throws(() =>
      readSupabaseBackendConfig({ ...configured, [key]: '' }),
    );
});

void test('Supabase configuration fails closed on mismatched or unsafe endpoints', () => {
  for (const databaseUrl of [
    `postgresql://postgres.${projectRef}:password@evil.test:6543/postgres`,
    `postgresql://postgres.abcdefghijklmnopqrst:password@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres`,
    `postgresql://postgres.${projectRef}:password@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`,
    `postgresql://postgres.${projectRef}:password@aws-0-ap-northeast-2.pooler.supabase.com:6543/other`,
    `postgresql://postgres.${projectRef}:password@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?secret=leak`,
  ])
    assert.throws(() =>
      readSupabaseBackendConfig({
        ...configured,
        SUPABASE_DATABASE_URL: databaseUrl,
      }),
    );
  assert.throws(() =>
    readSupabaseBackendConfig({
      ...configured,
      SUPABASE_URL: 'https://evil.test',
    }),
  );
  assert.throws(() =>
    readSupabaseBackendConfig({
      ...configured,
      SUPABASE_SECRET_KEY: 'public-or-legacy-key',
    }),
  );
  assert.throws(() =>
    readSupabaseBackendConfig({
      ...configured,
      PARTNER_HUB_BACKEND_ENABLED: '0',
    }),
  );
});
