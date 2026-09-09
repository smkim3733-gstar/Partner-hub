import test from 'node:test';
import assert from 'node:assert/strict';
import { vercelRateLimitClientKey } from '../lib/vercel-client-address';
import { platformRateLimitClientKey } from '../lib/platform-client-address';

const environment = {
  VERCEL: '1',
  VERCEL_ENV: 'preview',
  PARTNER_HUB_NEXT_BACKEND: 'cloudflare-http-v1',
  PARTNER_HUB_BACKEND_ENABLED: '1',
  PARTNER_HUB_APP_ORIGIN: 'https://app.example.test',
  PARTNER_HUB_D1_ORIGIN: 'https://db.example.test',
  PARTNER_HUB_R2_ORIGIN: 'https://objects.example.test',
  PARTNER_HUB_FILE_ORIGIN: 'https://files.example.test',
  PARTNER_HUB_D1_SECRET: '1'.repeat(64),
  PARTNER_HUB_R2_SECRET: '2'.repeat(64),
  PARTNER_HUB_FILE_SECRET: '3'.repeat(64),
};
function request(ip?: string, headers: Record<string, string> = {}) {
  return new Request(`${environment.PARTNER_HUB_APP_ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: {
      origin: environment.PARTNER_HUB_APP_ORIGIN,
      ...(ip === undefined ? {} : { 'x-vercel-forwarded-for': ip }),
      ...headers,
    },
  });
}
void test('Vercel address requires explicit remote runtime and deployed Vercel markers', () => {
  const req = request('198.51.100.9');
  for (const override of [
    { VERCEL: '' },
    { VERCEL: 'true' },
    { VERCEL: '0' },
    { VERCEL_ENV: '' },
    { VERCEL_ENV: 'development' },
    { PARTNER_HUB_NEXT_BACKEND: '' },
    { PARTNER_HUB_BACKEND_ENABLED: '0' },
    { PARTNER_HUB_LOCAL_STORAGE: '1' },
    { PARTNER_HUB_D1_SECRET: '' },
    { PARTNER_HUB_R2_SECRET: environment.PARTNER_HUB_D1_SECRET },
  ])
    assert.equal(
      vercelRateLimitClientKey(req, { ...environment, ...override }),
      null,
    );
  for (const VERCEL_ENV of ['preview', 'production'])
    assert.equal(
      vercelRateLimitClientKey(req, { ...environment, VERCEL_ENV }),
      'vercel-ip:198.51.100.9',
    );
});
void test('Vercel address never trusts alternative headers or client markers', () => {
  assert.equal(
    vercelRateLimitClientKey(
      request(undefined, {
        'x-forwarded-for': '198.51.100.1',
        'x-real-ip': '198.51.100.2',
        'cf-connecting-ip': '198.51.100.3',
        'x-vercel-id': 'fake',
      }),
      environment,
    ),
    null,
  );
  assert.equal(
    vercelRateLimitClientKey(
      request('198.51.100.9', {
        'x-forwarded-for': '198.51.100.1',
        'cf-connecting-ip': '198.51.100.3',
      }),
      environment,
    ),
    'vercel-ip:198.51.100.9',
  );
  assert.equal(
    vercelRateLimitClientKey(
      request('198.51.100.9', {
        vercel: '1',
        vercel_env: 'production',
      }),
      {},
    ),
    null,
  );
});
void test('Vercel address normalizes IPv6 and IPv4-mapped equivalent spellings', () => {
  for (const value of [
    '198.51.100.9',
    '::ffff:198.51.100.9',
    '0:0:0:0:0:FFFF:C633:6409',
  ])
    assert.equal(
      vercelRateLimitClientKey(request(value), environment),
      'vercel-ip:198.51.100.9',
    );
  for (const value of ['2001:db8::1', '2001:0DB8:0000:0:0:0:0:0001'])
    assert.equal(
      vercelRateLimitClientKey(request(value), environment),
      'vercel-ip:2001:db8::1',
    );
});
void test('Vercel address rejects ambiguous, invalid, chained or oversized input', () => {
  for (const value of [
    '',
    'unknown',
    '198.51.100.256',
    '198.051.100.9',
    '198.51.100.9:443',
    '[2001:db8::1]',
    '[2001:db8::1]:443',
    'fe80::1%eth0',
    '2001::db8::1',
    '::ffff:999.1.1.1',
    '198.51.100.9, 198.51.100.10',
    '198.51.100.9, 198.51.100.9',
    'f'.repeat(65),
    '0xc6336409',
    '3325256713',
    '198.51.100.9 evil',
  ])
    assert.equal(
      vercelRateLimitClientKey(request(value), environment),
      null,
      value,
    );
});
void test('Vercel address requires pinned origin and retains shared fallback elsewhere', () => {
  assert.equal(
    vercelRateLimitClientKey(
      request('198.51.100.9', { origin: 'https://other.example.test' }),
      environment,
    ),
    null,
  );
  assert.equal(
    vercelRateLimitClientKey(
      request('198.51.100.9', { 'sec-fetch-site': 'cross-site' }),
      environment,
    ),
    null,
  );
  assert.equal(
    vercelRateLimitClientKey(
      new Request('https://other.example.test', {
        headers: { 'x-vercel-forwarded-for': '198.51.100.9' },
      }),
      environment,
    ),
    null,
  );
  assert.equal(platformRateLimitClientKey(request('198.51.100.9')), null);
});
