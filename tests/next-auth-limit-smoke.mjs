import assert from 'node:assert/strict';
import { tokenHash } from '../lib/password-crypto.ts';

// Uses only the caller's isolated synthetic DB and loopback Next process.
// Vercel markers/header are simulated, not proof of Vercel edge replacement.
export async function runNextAuthLimitChecks({ db, request, baseUrl }) {
  const clear = () => db.prepare('DELETE FROM portal_auth_limits').run();
  async function attempt(email, ip, extra = {}, path = '/api/auth/login') {
    const response = await request(path, {
      method: 'POST',
      headers: {
        origin: baseUrl,
        'content-type': 'application/json',
        ...(ip ? { 'x-vercel-forwarded-for': ip } : {}),
        ...extra,
      },
      // Invalid email stops before password hashing; it still consumes both limits.
      body: JSON.stringify({ email, password: 'unused-synthetic' }),
    });
    assert.match(response.headers.get('cache-control'), /private, no-store/);
    assert.equal(response.headers.get('set-cookie'), null);
    await response.arrayBuffer();
    if (response.status === 429)
      assert.equal(response.headers.get('retry-after'), '900');
    return response.status;
  }
  try {
    await clear();
    const outcomes = await Promise.all(
      Array.from({ length: 36 }, (_, index) =>
        attempt(`invalid-concurrent-${index}`, '198.51.100.10'),
      ),
    );
    assert.equal(outcomes.filter((status) => status === 401).length, 30);
    assert.equal(outcomes.filter((status) => status === 429).length, 6);
    assert.equal(await attempt('invalid-other-ip', '198.51.100.11'), 401);
    assert.equal(
      await attempt('invalid-forged', '198.51.100.10', {
        'x-forwarded-for': '198.51.100.12',
        'cf-connecting-ip': '198.51.100.13',
      }),
      429,
    );
    const stored = await db
      .prepare('SELECT key_hash FROM portal_auth_limits')
      .all();
    assert.ok(
      stored.results.every((row) => /^[a-f0-9]{64}$/.test(row.key_hash)),
    );
    assert.ok(
      stored.results.some(
        (row) => row.key_hash === tokenHash('login:ip:vercel-ip:198.51.100.10'),
      ),
    );

    await clear();
    for (let index = 0; index < 9; index++)
      assert.equal(
        await attempt('invalid-shared-email', `198.51.100.${index + 20}`),
        index < 8 ? 401 : 429,
      );

    await clear();
    for (let index = 0; index < 9; index++)
      assert.equal(
        await attempt(
          '',
          index % 2 ? '::ffff:198.51.100.30' : '198.51.100.30',
          {},
          '/api/auth/register',
        ),
        index < 8 ? 400 : 429,
      );

    await clear();
    for (let index = 0; index < 9; index++)
      assert.equal(
        await attempt(
          '',
          index % 2 ? '2001:0DB8:0:0:0:0:0:1' : '2001:db8::1',
          {},
          '/api/auth/register',
        ),
        index < 8 ? 400 : 429,
      );

    await clear();
    for (let index = 0; index < 9; index++)
      assert.equal(
        await attempt(
          '',
          index % 2 ? '198.51.100.40, 198.51.100.41' : undefined,
          {
            'x-forwarded-for': `198.51.100.${index + 50}`,
            'cf-connecting-ip': `198.51.100.${index + 60}`,
          },
          '/api/auth/register',
        ),
        index < 8 ? 400 : 429,
      );
    await db
      .prepare('UPDATE portal_auth_limits SET expires_at = ?1')
      .bind(Date.now() - 1)
      .run();
    assert.equal(await attempt('', undefined, {}, '/api/auth/register'), 400);
  } finally {
    await clear();
  }
}
