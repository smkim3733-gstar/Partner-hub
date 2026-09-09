import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import {
  nextLocalStorageEnabled,
  nextLocalStorageName,
} from '../lib/next-local-storage-policy.mjs';

function readSecret(prompt) {
  return new Promise((resolve, reject) => {
    // Hide characters, terminal editing output and history. No argv/env password.
    const muted = new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    });
    const reader = createInterface({
      input: process.stdin,
      output: muted,
      terminal: true,
      historySize: 0,
    });
    let answered = false;
    process.stdout.write(prompt);
    reader.once('SIGINT', () => reader.close());
    reader.once('close', () => {
      process.stdout.write('\n');
      if (!answered) reject(new Error('관리자 설정을 취소했습니다.'));
    });
    reader.question('', (value) => {
      answered = true;
      reader.close();
      resolve(value);
    });
  });
}

async function main() {
  if (
    process.argv.length !== 2 ||
    !process.stdin.isTTY ||
    !process.stdout.isTTY
  )
    throw new Error(
      '대화형 로컬 터미널에서 pnpm run admin:next:local 을 실행하세요. 비밀번호 인수·파이프 입력은 받지 않습니다.',
    );
  process.env.NODE_ENV ??= 'development';
  process.env.PARTNER_HUB_LOCAL_STORAGE = '1';
  if (!nextLocalStorageEnabled(process.env))
    throw new Error(
      '프로덕션 또는 Vercel에서는 로컬 관리자를 설정할 수 없습니다.',
    );
  const name = nextLocalStorageName(process.env.PARTNER_HUB_LOCAL_STORAGE_NAME);
  await import('./register-local.mjs');
  const { PORTAL_OWNER_EMAIL } = await import('../lib/member-email.ts');
  const { passwordProblem } = await import('../lib/password-policy.ts');
  console.log(
    `로컬 저장소: ${name}. 운영 계정과 무관한 관리자 최초 설정입니다.`,
  );
  console.log(
    `이메일: ${PORTAL_OWNER_EMAIL}. Next 로컬 서버를 중지한 상태에서 진행하세요.`,
  );
  let password = await readSecret(
    '새 로컬 전용 비밀번호(15~128자, 표시되지 않음): ',
  );
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  let confirmation = await readSecret('비밀번호 확인: ');
  if (password !== confirmation)
    throw new Error('비밀번호가 일치하지 않습니다. 설정하지 않았습니다.');
  const { createNextLocalPlatform } =
    await import('../dev/next-local/bindings.ts');
  const { provisionStandaloneAdmin } =
    await import('../lib/standalone-admin-store.ts');
  const platform = await createNextLocalPlatform();
  try {
    await provisionStandaloneAdmin(platform.env.DB, {
      email: PORTAL_OWNER_EMAIL,
      password,
    });
    console.log(
      '로컬 관리자 설정 완료. pnpm run dev:next:local 실행 후 /account 에서 로그인하세요.',
    );
  } finally {
    // JS strings cannot be securely zeroed; never persist, print or forward them.
    password = '';
    confirmation = '';
    await platform.dispose();
  }
}
main().catch((error) => {
  // Database/native errors may contain SQL; do not echo those details.
  console.error(
    error instanceof Error &&
      error.constructor === Error &&
      !error.cause &&
      !/SQL|D1_|SQLITE/i.test(error.message)
      ? error.message
      : '로컬 관리자 설정에 실패했습니다. 기존 계정은 덮어쓰지 않습니다.',
  );
  process.exitCode = 1;
});
