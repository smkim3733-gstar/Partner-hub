import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PasswordLinkResponseError,
  readPasswordLinkResponse,
} from '../lib/password-link-response';

const now = Date.parse('2026-09-04T00:00:00.000Z');
const value = {
  path: `/account/setup#token=${'a'.repeat(64)}`,
  expiresAt: now + 30 * 60_000,
};

void test('password link response returns only a validated same-site fragment path', async () => {
  const result = await readPasswordLinkResponse(
    Response.json(
      { ...value, email: 'must-not-escape@example.invalid' },
      { status: 201 },
    ),
    now,
  );
  assert.deepEqual(result, value);
  assert.equal(Object.hasOwn(result, 'email'), false);
});

void test('password link response rejects unsafe paths and invalid expiry', async () => {
  for (const changed of [
    { ...value, path: `https://example.invalid/#token=${'a'.repeat(64)}` },
    { ...value, path: `/account/setup?token=${'a'.repeat(64)}` },
    { ...value, path: `/account/setup#token=${'A'.repeat(64)}` },
    { ...value, expiresAt: now },
    { ...value, expiresAt: now + 32 * 60_000 },
    { ...value, expiresAt: now + 1.5 },
  ])
    await assert.rejects(
      readPasswordLinkResponse(Response.json(changed, { status: 201 }), now),
      /응답 형식이 올바르지 않습니다/,
    );
});

void test('password link failure preserves bounded guidance and status', async () => {
  await assert.rejects(
    readPasswordLinkResponse(
      Response.json(
        { error: '기존 연락처로 본인을 확인해 주세요.' },
        { status: 400 },
      ),
      now,
    ),
    (error: unknown) =>
      error instanceof PasswordLinkResponseError &&
      error.status === 400 &&
      error.message === '기존 연락처로 본인을 확인해 주세요.',
  );
});

void test('unreadable password link response never exposes its body', async () => {
  await assert.rejects(
    readPasswordLinkResponse(
      new Response('<html>private gateway failure</html>', { status: 502 }),
      now,
    ),
    (error: unknown) =>
      error instanceof PasswordLinkResponseError &&
      error.status === 502 &&
      /응답을 읽지 못했습니다/.test(error.message) &&
      !error.message.includes('private'),
  );
});
