// 시험용 Supabase 연결 열쇠를 "이 작업 폴더"의 .env.local 에만 저장한다(운영 폴더와 분리된 worktree에서 실행).
// 비밀 키는 클립보드에서 읽고(Supabase 대시보드의 Copy 버튼으로 복사) 화면에 표시하지 않는다.
// 시험용 DB 비밀번호는 오타 확인을 위해 보이게 입력받는다(운영 비밀번호가 아니다).
// 실행 예 (PowerShell, 작업 폴더에서):
//   $env:PARTNER_HUB_TEST_PROJECT_REF='<시험 프로젝트 ID>'; $env:PARTNER_HUB_TEST_POOLER_HOST='aws-0-<리전>.pooler.supabase.com'
//   node tools/test-env/save-test-keys.mjs
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { repoDir, testProjectRef } from './common.mjs';

const ref = testProjectRef();
const host = process.env.PARTNER_HUB_TEST_POOLER_HOST ?? '';
const target = path.join(repoDir, '.env.local');
const origin = process.env.PARTNER_HUB_TEST_ORIGIN ?? 'https://127.0.0.1:3443';

function readVisible(prompt) {
  return new Promise((resolve, reject) => {
    const reader = createInterface({ input: process.stdin, output: process.stdout, terminal: true, historySize: 0 });
    let answered = false;
    reader.once('close', () => { if (!answered) reject(new Error('취소했습니다.')); });
    reader.question(prompt, (value) => { answered = true; reader.close(); resolve(value.trim()); });
  });
}
// 대시보드 Copy 버튼을 여러 번 누르면 같은 키가 이어 붙는 경우가 있어 한 개로 줄인다.
const singleKey = (v) => {
  const n = v.indexOf('sb_secret_', 1);
  return n > 0 && v === v.slice(0, n).repeat(v.length / n) ? v.slice(0, n) : v;
};
function clipboardKey() {
  try { return singleKey(execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], { encoding: 'utf8' }).trim()); }
  catch { return ''; }
}
async function passwordWorks(password) {
  const { default: postgres } = await import('postgres');
  const sql = postgres({ host, port: 6543, database: 'postgres', username: `postgres.${ref}`, password, ssl: 'require', prepare: false, max: 1, connect_timeout: 15 });
  try { await sql`select 1`; return 'ok'; }
  catch (e) { return e.code === '28P01' ? 'wrong' : 'other'; }
  finally { await sql.end({ timeout: 5 }); }
}

try {
  if (!/^aws-\d-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host))
    throw new Error('PARTNER_HUB_TEST_POOLER_HOST 에 시험 프로젝트의 풀러 주소(aws-0-<리전>.pooler.supabase.com)를 넣어 주세요.');
  console.log('');
  console.log('=== 시험용 연결 열쇠 저장 (운영과 별도) ===');
  console.log(`저장 위치: ${target}`);
  console.log('');
  const key = clipboardKey();
  if (!/^sb_secret_[A-Za-z0-9_-]{16,512}$/.test(key))
    throw new Error('클립보드에 시험용 비밀 키(sb_secret_...)가 없습니다. 대시보드에서 Copy 를 누른 뒤 다시 실행해 주세요.');
  console.log('[1/2] 시험용 비밀 키: 클립보드에서 읽었습니다. ✔');
  let password = '';
  for (let i = 1; i <= 5 && !password; i++) {
    const value = await readVisible('[2/2] 시험용 DB 비밀번호 입력 후 Enter (글자가 보입니다) > ');
    if (!value) { i--; continue; }
    if (!/^[A-Za-z0-9]+$/.test(value)) { console.log('  → 영어·숫자만 입력해 주세요. (한/영 키 확인)'); continue; }
    console.log('  → 확인 중...');
    const result = await passwordWorks(value);
    if (result === 'ok') password = value;
    else if (result === 'wrong') console.log(`  → 비밀번호가 맞지 않습니다. (${i}/5)`);
    else console.log('  → 연결 문제가 있습니다. 풀러 주소(리전)를 확인하거나 잠시 뒤 다시 입력해 주세요.');
  }
  if (!password) throw new Error('5번 모두 맞지 않았습니다. 대시보드에서 시험 DB 비밀번호를 재설정해 주세요.');
  writeFileSync(target, [
    '# 시험용(test) Supabase 프로젝트 전용. 운영 아님. Git에 올라가지 않음.',
    'ANTHROPIC_EXTERNAL_PROCESSING_ENABLED=false',
    'ANTHROPIC_API_KEY=',
    'ANTHROPIC_MODEL=',
    'PARTNER_HUB_NEXT_BACKEND=supabase-v1',
    'PARTNER_HUB_BACKEND_ENABLED=1',
    `PARTNER_HUB_APP_ORIGIN=${origin}`,
    `PARTNER_HUB_TEST_PROJECT_REF=${ref}`,
    `SUPABASE_URL=https://${ref}.supabase.co`,
    `SUPABASE_SECRET_KEY=${key}`,
    `SUPABASE_DATABASE_URL=postgresql://postgres.${ref}:${password}@${host}:6543/postgres?sslmode=require`,
    'SUPABASE_STORAGE_BUCKET=partner-hub-private',
    '',
  ].join('\n'));
  const r = await fetch(`https://${ref}.supabase.co/rest/v1/`, { headers: { apikey: key } });
  console.log('');
  console.log(r.status === 200
    ? '✅ 저장 완료! 이 창을 닫고 Claude에게 "시험 열쇠 저장 완료"라고 알려 주세요.'
    : `⚠ DB는 연결됐지만 비밀 키가 거절됐습니다(${r.status}).`);
} catch (error) {
  console.log('');
  console.log(`❌ 중단: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
}
