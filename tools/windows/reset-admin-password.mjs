// 쉬운 관리자 비밀번호 재설정. 저장소의 복구 기능(recoverStandaloneAdmin)을 그대로 쓰고
// 안전 확인(활성 관리자 1명, 현재 자격 버전 대조, 복구 감사 기록)은 scripts/recover-next-remote-admin.mjs 와 같다.
// 질문만 쉽게: 대상 확인은 y, 빈 입력은 다시 묻기. 비밀번호는 화면에 표시하지 않는다.
// 실행: reset-admin-password.cmd 더블클릭 (먼저 save-production-keys.cmd 로 .env.local 을 준비한다)
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
process.chdir(repoDir);
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const repo = pathToFileURL(repoDir + path.sep).href;

function readOnce(prompt, hidden) {
  return new Promise((resolve, reject) => {
    const output = hidden
      ? new Writable({ write(_c, _e, done) { done(); } })
      : process.stdout;
    const reader = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
    let answered = false;
    if (hidden) process.stdout.write(prompt);
    reader.once('close', () => { if (hidden) process.stdout.write('\n'); if (!answered) reject(new Error('입력이 취소됐습니다.')); });
    reader.question(hidden ? '' : prompt, (value) => { answered = true; reader.close(); resolve(value.trim()); });
  });
}
async function ask(prompt, hidden = false) {
  for (;;) {
    const value = await readOnce(prompt, hidden);
    if (value) return value; // 창이 열릴 때 들어오는 빈 Enter는 무시하고 다시 묻는다.
  }
}

let close = async () => {};
try {
  await import(`${repo}scripts/register-local.mjs`); // .ts 모듈 로더를 먼저 등록
  const { openNextOperatorStorage } = await import(`${repo}scripts/next-operator-storage.mjs`);
  const { recoverStandaloneAdmin } = await import(`${repo}lib/standalone-admin-recovery.ts`);
  const { PORTAL_OWNER_EMAIL } = await import(`${repo}lib/member-email.ts`);
  const { passwordProblem } = await import(`${repo}lib/password-policy.ts`);
  const storage = await openNextOperatorStorage();
  close = storage.close ?? close;
  const rows = await storage.db
    .prepare('SELECT id, email, active, credential_version FROM standalone_admin_accounts')
    .all();
  if (rows.results.length !== 1 || rows.results[0].id !== 'primary-admin' ||
      rows.results[0].email !== PORTAL_OWNER_EMAIL || rows.results[0].active !== 1)
    throw new Error('활성 대표 관리자 한 명이 아닙니다. 변경하지 않았습니다.');
  const account = rows.results[0];

  console.log('');
  console.log('=== 관리자 비밀번호 새로 정하기 ===');
  console.log(`사이트: ${storage.config.appOrigin}`);
  console.log(`관리자 이메일: ${PORTAL_OWNER_EMAIL}`);
  console.log('');
  const yes = await ask('이 사이트의 관리자 비밀번호를 새로 정할까요? (y 입력 후 Enter) > ');
  if (yes.toLowerCase() !== 'y') throw new Error('y가 아니라서 변경하지 않았습니다.');

  let password = '';
  for (let i = 0; i < 5 && !password; i++) {
    const first = await ask('새 비밀번호(15자 이상, 화면에 안 보임) 입력 후 Enter > ', true);
    const problem = passwordProblem(first);
    if (problem) { console.log(`  → 지금 ${[...first].length}자를 입력하셨어요. 15자 이상이 필요합니다.`); continue; }
    const second = await ask('같은 비밀번호를 한 번 더 입력 후 Enter > ', true);
    if (first !== second) { console.log('  → 두 번 입력한 비밀번호가 다릅니다. 처음부터 다시 입력해 주세요.'); continue; }
    password = first;
  }
  if (!password) throw new Error('비밀번호를 정하지 못해 변경하지 않았습니다.');

  const recoveryId = randomUUID();
  const result = await recoverStandaloneAdmin(storage.db, {
    email: PORTAL_OWNER_EMAIL,
    password,
    reason: 'lost-password',
    recoveryId,
    expectedCredentialVersion: account.credential_version,
  });
  password = '';
  console.log('');
  console.log('✅ 관리자 비밀번호를 새로 정했습니다.');
  console.log(`   (기존 로그인 ${result.revokedSessions}개는 로그아웃됨, 기록 ID ${recoveryId})`);
  console.log(`   이제 사이트에서 ${PORTAL_OWNER_EMAIL} 과 새 비밀번호로 로그인하세요.`);
} catch (error) {
  console.log('');
  console.log(`❌ 중단: ${error instanceof Error && /[가-힣]/.test(error.message) ? error.message : '연결 또는 저장 중 문제가 생겼습니다. Claude에게 알려 주세요.'}`);
} finally {
  await close();
}
