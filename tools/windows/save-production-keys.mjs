// 운영 연결 열쇠 두 개(Supabase 비밀 키, DB 비밀번호)를 저장소의 .env.local 에 저장하는 도우미.
// 새 PC에서 백업·관리자 복구 도구를 쓰기 전에 한 번 실행한다: save-production-keys.cmd 더블클릭.
// 입력값은 화면에 표시하지 않고, .env.local 외 어디에도 출력하지 않는다. .env.local 은 Git 에 올라가지 않는다.
// 비밀 키는 Supabase 대시보드 > Project Settings > API Keys 의 secret key(sb_secret_...)를 복사해 붙여넣는다.
// DB 비밀번호는 Supabase 대시보드 > Database 설정에서 정한 값이다(2026-10-24 재설정, 영어·숫자).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const envPath = path.join(repo, '.env.local');
const productionOrigin = 'https://partner-hub-gamma-five.vercel.app';
// 운영 프로젝트는 싱가포르(ap-southeast-1) 리전이다. 트랜잭션 풀러(6543)를 쓴다.
const poolerHost =
  process.env.PARTNER_HUB_POOLER_HOST || 'aws-0-ap-southeast-1.pooler.supabase.com';

function ask(prompt) {
  return new Promise((resolve, reject) => {
    const muted = new Writable({ write(_c, _e, done) { done(); } });
    const reader = createInterface({ input: process.stdin, output: muted, terminal: true, historySize: 0 });
    let answered = false;
    process.stdout.write(prompt);
    reader.once('close', () => { process.stdout.write('\n'); if (!answered) reject(new Error('취소했습니다.')); });
    reader.question('', (value) => { answered = true; reader.close(); resolve(value.trim()); });
  });
}

async function askValid(prompt, valid, hint) {
  for (let i = 0; i < 3; ) {
    const value = await ask(prompt);
    if (!value) continue; // 새 창이 열릴 때 들어오는 빈 Enter는 무시하고 다시 묻는다.
    if (valid(value)) return value;
    console.log(`  → ${hint} 다시 입력해 주세요.`);
    i++;
  }
  throw new Error('3번 모두 형식이 맞지 않아 저장하지 않았습니다.');
}

function setLine(text, name, value) {
  const line = `${name}=${value}`;
  return new RegExp(`^${name}=.*$`, 'm').test(text)
    ? text.replace(new RegExp(`^${name}=.*$`, 'm'), () => line)
    : `${text.replace(/\n?$/, '\n')}${line}\n`;
}

try {
  console.log('');
  console.log('=== 운영 연결 열쇠 저장 (입력한 글자는 화면에 보이지 않습니다) ===');
  console.log(`저장 위치: ${envPath}`);
  console.log('');
  let text = existsSync(envPath)
    ? readFileSync(envPath, 'utf8')
    : readFileSync(path.join(repo, '.env.example'), 'utf8');
  const supabaseUrl = /^SUPABASE_URL=(.*)$/m.exec(text)?.[1]?.trim() ?? '';
  const ref = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/.exec(supabaseUrl)?.[1];
  if (!ref) throw new Error('.env.local 의 SUPABASE_URL 이 올바르지 않습니다.');
  const key = await askValid(
    '[1/2] Supabase 비밀 키: 마우스 오른쪽 버튼을 한 번 누르거나 Ctrl+V 로 붙여넣고 Enter > ',
    (v) => /^sb_secret_[A-Za-z0-9_-]{16,512}$/.test(v),
    'sb_secret_ 로 시작하는 값이 아닙니다.',
  );
  console.log('  → 비밀 키 확인됨');
  const password = await askValid(
    '[2/2] DB 비밀번호(영어·숫자)를 입력하고 Enter > ',
    (v) => /^[A-Za-z0-9]{12,128}$/.test(v),
    '영어·숫자만 12자 이상이어야 합니다.',
  );
  text = setLine(text, 'PARTNER_HUB_APP_ORIGIN', productionOrigin);
  text = setLine(text, 'SUPABASE_SECRET_KEY', key);
  text = setLine(
    text,
    'SUPABASE_DATABASE_URL',
    `postgresql://postgres.${ref}:${password}@${poolerHost}:6543/postgres?sslmode=require`,
  );
  writeFileSync(envPath, text);
  console.log('');
  console.log('저장했습니다. 운영 DB 연결을 확인합니다(아무것도 변경하지 않음)...');
  const check = spawnSync(
    process.execPath,
    ['--env-file-if-exists=.env.local', 'scripts/recover-next-remote-admin.mjs', '--check'],
    { cwd: repo, encoding: 'utf8' },
  );
  const ok = check.status === 0 && /"activeAdministrator":true/.test(check.stdout);
  console.log('');
  console.log(ok
    ? '✅ 연결 성공! 이 창을 닫고 Claude에게 "연결 성공"이라고 알려 주세요.'
    : '❌ 연결 실패. DB 비밀번호가 다를 수 있습니다. 이 창을 닫고 Claude에게 "연결 실패"라고 알려 주세요.');
} catch (error) {
  console.log('');
  console.log(`중단: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
}
