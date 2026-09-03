import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PasswordAuthResponseError,
  readPasswordAuthResponse,
  type PasswordAuthAction,
} from '../lib/password-auth-response';

void test('password auth responses return only action-specific fields', async () => {
  assert.deepEqual(
    await readPasswordAuthResponse(
      Response.json({ ok: true, secret: 'must-not-escape' }),
      'login',
    ),
    { ok: true },
  );
  assert.deepEqual(
    await readPasswordAuthResponse(
      Response.json(
        { message: '가입 신청이 접수되었습니다.', secret: 'must-not-escape' },
        { status: 201 },
      ),
      'register',
    ),
    { message: '가입 신청이 접수되었습니다.' },
  );
});

void test('password auth success requires the matching action contract', async () => {
  const cases: Array<[PasswordAuthAction, Response]> = [
    ['login', Response.json({ ok: false })],
    ['logout', Response.json({ message: 'done' })],
    ['register', Response.json({ message: 'done' })],
    ['setup', Response.json({ ok: true })],
    ['setup', Response.json({ message: '' })],
  ];
  for (const [action, response] of cases)
    await assert.rejects(
      readPasswordAuthResponse(response, action),
      /응답 형식이 올바르지 않습니다/,
    );
});

void test('password auth errors preserve bounded server guidance and status', async () => {
  await assert.rejects(
    readPasswordAuthResponse(
      Response.json(
        { error: '이메일 또는 비밀번호를 확인해 주세요.' },
        { status: 401 },
      ),
      'login',
    ),
    (error: unknown) =>
      error instanceof PasswordAuthResponseError &&
      error.status === 401 &&
      error.message === '이메일 또는 비밀번호를 확인해 주세요.',
  );
  await assert.rejects(
    readPasswordAuthResponse(
      Response.json({ error: 'x'.repeat(1_001) }, { status: 503 }),
      'register',
    ),
    (error: unknown) =>
      error instanceof PasswordAuthResponseError &&
      error.status === 503 &&
      error.message === '요청을 처리하지 못했습니다.',
  );
});

void test('unreadable password auth response hides gateway contents', async () => {
  await assert.rejects(
    readPasswordAuthResponse(
      new Response('<html>private gateway failure</html>', { status: 502 }),
      'logout',
    ),
    (error: unknown) =>
      error instanceof PasswordAuthResponseError &&
      error.status === 502 &&
      /응답을 읽지 못했습니다/.test(error.message) &&
      !error.message.includes('private'),
  );
});
