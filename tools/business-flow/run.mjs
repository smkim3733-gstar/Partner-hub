// 가입부터 사후관리까지 전체 업무 흐름을 실제 브라우저로 끝까지 진행하는 시험 (시험 전용).
// - 운영과 분리된 시험 Supabase 프로젝트 + 로컬 HTTPS 개발 서버에서만 실행한다(운영 주소 거부).
// - 실행할 때마다 새 가상 파트너 2명·가상 기업 1곳을 만들므로 같은 시험 DB에서 반복 실행할 수 있다.
// - 결과·화면·세션은 work/business-flow/ (Git 제외)에 남는다.
// 사용법은 tools/business-flow/README.md 를 본다.
//   node tools/business-flow/run.mjs scenario     전체 시나리오
//   node tools/business-flow/run.mjs isolation    마지막 실행의 권한 분리만 다시 확인
import { chromium } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertTestEnvironment, repoDir } from '../test-env/common.mjs';

if (existsSync(path.join(repoDir, '.env.local'))) process.loadEnvFile(path.join(repoDir, '.env.local'));
assertTestEnvironment();
const base = process.env.PARTNER_HUB_FLOW_BASE ?? 'https://127.0.0.1:3443';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw new Error('업무 흐름 시험은 로컬 개발 서버에서만 실행합니다.');

const work = path.join(repoDir, 'work', 'business-flow');
const shots = path.join(work, 'shots');
const files = path.join(work, 'files');
mkdirSync(shots, { recursive: true });
mkdirSync(files, { recursive: true });
const readEnv = (f) =>
  Object.fromEntries(
    readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
  );
const admin = readEnv(path.join(repoDir, '.env.test-admin.local'));

// 실행별 가상 데이터 (실제 사람·기업 아님)
const runFile = path.join(work, 'run.json');
function newRun() {
  const id = randomBytes(3).toString('hex');
  const pw = () => `Flow${randomBytes(9).toString('base64url')}`;
  return {
    id,
    company: `시험기업${id} 주식회사`,
    partners: {
      A: { name: `시험파트너A${id}`, email: `flow-a-${id}@example.test`, password: pw(), phone: '010-0000-0001', type: '한기평 컨설턴트' },
      B: { name: `시험파트너B${id}`, email: `flow-b-${id}@example.test`, password: pw(), phone: '010-0000-0002', type: '타사 컨설턴트' },
    },
  };
}
const kstDate = (offsetDays) =>
  new Date(Date.now() + 9 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
const yesterday = kstDate(-1);

const fileText = {
  'company-doc.txt': '시험용 가상 사업자등록증 사본 (실제 자료 아님)\n',
  'call-note.txt': '시험용 가상 통화 정리 (실제 녹취 아님)\n',
  'report.txt': '시험용 가상 보고서 (실제 자료 아님)\n',
  'fin.txt': '시험용 가상 재무제표 (실제 자료 아님)\n',
  'fin2.txt': '시험용 가상 재무제표 보완본 (실제 자료 아님)\n',
};
for (const [name, text] of Object.entries(fileText)) writeFileSync(path.join(files, name), text);
writeFileSync(path.join(files, 'slides.pdf'), syntheticPdf());
function syntheticPdf() {
  const stream = 'BT /F1 14 Tf 20 100 Td (TEST ONLY - synthetic) Tj ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}
const file = (name) => path.join(files, name);

const browser = await chromium.launch();
const results = [];
function record(step, ok, detail = '') {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? `  — ${detail}` : ''}`);
}

let run;
async function session(name) {
  const stateFile = path.join(work, `session-${run.id}-${name}.json`);
  const context = await browser.newContext({
    ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 }, locale: 'ko-KR',
    ...(existsSync(stateFile) ? { storageState: stateFile } : {}),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(90_000);
  page.on('dialog', (d) => void d.accept());
  // 저장 요청이 끝나기 전에 창을 닫지 않도록 진행 중인 요청 수를 센다.
  // 개발 서버의 화면 갱신 연결처럼 계속 열려 있는 요청은 빼고, 앱 API 요청만 센다.
  const api = (r) => new URL(r.url()).pathname.startsWith('/api/');
  let pending = 0;
  page.on('request', (r) => { if (api(r)) pending++; });
  page.on('requestfinished', (r) => { if (api(r)) pending--; });
  page.on('requestfailed', (r) => { if (api(r)) pending--; });
  page.idle = async () => {
    // 최대 5분. 그 안에 끝나지 않으면 다음 확인 단계가 실패로 알려 준다.
    for (let quiet = 0, waited = 0; quiet < 4 && waited < 600; waited++) {
      await page.waitForTimeout(500);
      quiet = pending <= 0 ? quiet + 1 : 0;
    }
  };
  return { context, page, persist: () => context.storageState({ path: stateFile }) };
}
const loading = '로그인 정보와 담당 권한을 확인하고';
async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForFunction((t) => !document.body.innerText.includes(t), loading, { timeout: 240_000 }).catch(() => {});
}
/** 화면 자동저장(디바운스 후 PUT /api/state)이 끝날 때까지 기다린다. 끝나기 전에 창을 닫으면 변경이 사라진다. */
async function autosaved(page) {
  await page.waitForTimeout(2500);
  await page.waitForFunction(() => document.body.innerText.includes('DB 저장됨'), null, { timeout: 120_000 });
  await page.idle();
}
const mainText = async (page) => (await page.locator('main').innerText()).replace(/\n{2,}/g, '\n');
function credentials(who) {
  return who === 'admin'
    ? { email: admin.TEST_ADMIN_EMAIL, password: admin.TEST_ADMIN_PASSWORD }
    : run.partners[who];
}
async function login(page, who) {
  const { email, password } = credentials(who);
  await page.goto(`${base}/account`);
  await page.getByLabel('이메일 아이디').fill(email);
  await page.getByLabel('사이트 전용 비밀번호').fill(password);
  await page.getByRole('button', { name: '이메일로 로그인' }).click();
  await page.waitForURL(`${base}/`, { timeout: 120_000 });
  await settle(page);
}
/** 로그인된 홈 화면을 연다. 세션이 만료됐으면(관리자는 1시간) 다시 로그인한다. */
async function home(who) {
  const s = await session(who);
  await s.page.goto(`${base}/`);
  await settle(s.page);
  if (await s.page.getByLabel('이메일 아이디').isVisible().catch(() => false)) await login(s.page, who);
  await s.persist();
  return s;
}
async function nav(page, label) {
  await page.locator('nav, aside').getByText(label, { exact: true }).first().click();
  await page.waitForTimeout(2500);
  await settle(page);
}
async function waitFlow(page) {
  for (let i = 0; i < 48; i++) {
    await page.waitForTimeout(5000);
    if (!(await page.locator('main').innerText()).includes('컨설팅 진행 불러오는 중')) return;
  }
}
async function openFlow(who) {
  const s = await home(who);
  await nav(s.page, '컨설팅 진행 현황');
  await s.page.getByRole('button', { name: '상담 FLOW 열기' }).click();
  await waitFlow(s.page);
  const select = s.page.locator('main select').first();
  const option = await select.locator('option').filter({ hasText: run.company }).first().getAttribute('value');
  if (option && (await select.inputValue()) !== option) {
    await select.selectOption(option);
    await waitFlow(s.page);
  }
  return s;
}
async function stage(page) {
  return Number(/현재 단계 · (\d+) \/ 15/.exec(await mainText(page))?.[1] ?? 0);
}
/** 동작 목록을 순서대로 실행한다. 보이는 요소만 대상으로 하며, 저장 중 표시가 사라질 때까지 기다린다. */
async function act(page, actions) {
  for (const a of actions) {
    const scope = page.locator('main');
    if (a.click) await scope.getByRole('button', { name: a.click, exact: !!a.exact }).filter({ visible: true }).nth(a.nth ?? 0).click();
    else if (a.open) await scope.getByText(a.open, { exact: true }).filter({ visible: true }).nth(a.nth ?? 0).click();
    else if (a.fill) await scope.getByLabel(a.fill[0]).filter({ visible: true }).nth(a.nth ?? 0).fill(a.fill[1]);
    else if (a.select) await scope.getByLabel(a.select[0]).filter({ visible: true }).nth(a.nth ?? 0).selectOption(a.select[1]);
    else if (a.check) await scope.getByLabel(a.check).filter({ visible: true }).nth(a.nth ?? 0).check();
    else if (a.file) {
      // 접힌 양식(<details>)의 파일 칸도 DOM에 있으므로 열린 양식의 칸을 먼저 고른다.
      const inOpen = scope.locator('details[open] input[type=file]');
      await ((await inOpen.count()) ? inOpen : scope.locator('input[type=file]')).nth(a.nth ?? 0).setInputFiles(a.file);
    }
    else if (a.save) {
      await page.waitForTimeout(1500);
      await page.waitForFunction(
        () => !/저장·처리 중|저장·생성 중입니다/.test(document.querySelector('main')?.innerText || ''),
        null, { timeout: 300_000, polling: 1000 },
      );
      await page.idle();
    }
    await page.waitForTimeout(a.pause ?? 600);
  }
}
async function download(page, label, expected) {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 120_000 }),
    page.locator('main').getByText(label, { exact: true }).filter({ visible: true }).first().click(),
  ]);
  const target = path.join(work, `dl-${run.id}-${dl.suggestedFilename()}`);
  await dl.saveAs(target);
  return readFileSync(target, 'utf8') === expected;
}
/** FLOW 한 단계: who 로 FLOW를 열고 actions 실행 후 다시 열어 현재 단계를 확인한다. */
async function flowStep(step, who, actions, expectStage, expectText) {
  const s = await openFlow(who);
  try {
    await act(s.page, actions);
  } catch (error) {
    await s.page.screenshot({ path: path.join(shots, `${run.id}-${step}.png`), fullPage: true });
    record(step, false, error instanceof Error ? error.message.split('\n')[0] : 'error');
    await s.context.close();
    return false;
  }
  await s.context.close();
  const check = await openFlow(who);
  const now = await stage(check.page);
  let textOk = true;
  if (expectText) {
    await act(check.page, [{ click: expectText.section, exact: true }]);
    textOk = expectText.pattern.test(await mainText(check.page));
  }
  await check.page.screenshot({ path: path.join(shots, `${run.id}-${step}.png`), fullPage: true });
  await check.context.close();
  const ok = now === expectStage && textOk;
  record(step, ok, `현재 단계 ${now} (기대 ${expectStage})${expectText && !textOk ? ` · 화면 문구 불일치 ${expectText.pattern}` : ''}`);
  return ok;
}
const report = (name, body = true) => [
  { click: '보고서 1–6차', exact: true },
  { open: '보고서 등록' },
  ...(body ? [{ fill: ['보고서 본문', `시험용 ${name} 본문입니다.`] }] : []),
  { file: file(body ? 'report.txt' : 'slides.pdf') },
  { check: '자료 저장과 담당 파트너 공유 권한을 확인했습니다' },
  { click: '저장 · 담당 파트너 공유' },
  { save: true },
];

const steps = {
  async baseline() {
    const s = await session('admin');
    await login(s.page, 'admin');
    if (await s.page.getByRole('button', { name: '빈 운영 데이터 선택' }).isVisible().catch(() => false)) {
      await s.page.getByRole('button', { name: '빈 운영 데이터 선택' }).click();
      // 자동저장이 끝나기 전에 창을 닫으면 기준선이 저장되지 않는다.
      await autosaved(s.page);
    }
    await s.persist();
    record('관리자 로그인·운영 데이터 기준선', (await s.page.locator('body').innerText()).includes('DB 저장됨'));
    await s.context.close();
  },
  async signup() {
    for (const who of ['A', 'B']) {
      const p = run.partners[who];
      const s = await session(`anon-${who}`);
      await s.page.goto(`${base}/account`);
      await s.page.getByRole('button', { name: '가입 신청' }).first().click();
      await s.page.locator('#auth-name').fill(p.name);
      await s.page.locator('#auth-phone').fill(p.phone);
      await s.page.locator('#auth-affiliation').fill('시험용 가상 소속');
      await s.page.getByLabel('이메일 아이디').fill(p.email);
      await s.page.getByLabel('사이트 전용 비밀번호').fill(p.password);
      await s.page.locator('input[name=consent]').check();
      await s.page.getByRole('button', { name: '가입 신청 · 대표 승인 요청' }).click();
      const done = await s.page.getByText('가입 신청이 접수되었습니다').waitFor({ timeout: 60_000 }).then(() => true, () => false);
      record(`가입 신청 ${who}`, done);
      await s.page.goto(`${base}/account`);
      await s.page.getByLabel('이메일 아이디').fill(p.email);
      await s.page.getByLabel('사이트 전용 비밀번호').fill(p.password);
      await s.page.getByRole('button', { name: '이메일로 로그인' }).click();
      const blocked = await s.page.getByText('대표 승인 전이거나').waitFor({ timeout: 60_000 }).then(() => true, () => false);
      record(`승인 전 로그인 차단 ${who}`, blocked);
      await s.context.close();
    }
  },
  async approve() {
    const s = await home('admin');
    await nav(s.page, '파트너 계정관리');
    for (const who of ['A', 'B']) {
      const p = run.partners[who];
      const card = s.page.locator('main article, main li, main section, main div')
        .filter({ hasText: p.name }).filter({ has: s.page.getByRole('button', { name: '신청 검토·승인' }) }).last();
      await card.getByRole('button', { name: '신청 검토·승인' }).click();
      const dialog = s.page.getByRole('dialog');
      await dialog.locator('select').selectOption(p.type);
      await dialog.getByRole('button', { name: /승인·등록/ }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 120_000 }).catch(() => {});
      await autosaved(s.page);
    }
    await s.context.close();
    for (const who of ['A', 'B']) {
      const p = await home(who);
      record(`승인 후 로그인 ${who}`, (await p.page.locator('body').innerText()).includes('파트너 협업공간'));
      await p.context.close();
    }
  },
  async apply() {
    const s = await home('A');
    const page = s.page;
    await page.getByRole('button', { name: '새 협업신청' }).first().click();
    await page.waitForFunction(() => !document.body.innerText.includes('임시저장을 확인하고 있습니다'), null, { timeout: 60_000 });
    await page.waitForTimeout(1500);
    if (!(await page.locator('main').innerText()).includes('4단계 중 1단계'))
      throw new Error('이전 임시저장 신청서가 남아 있습니다. 새 실행(--new)으로 다시 시작해 주세요.');
    await page.locator('#application-message').fill('시험용 가상 협업신청입니다.');
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await page.getByLabel('기업명*').fill(run.company);
    await page.locator('#application-registrationNumber').fill('123-45-67890');
    await page.locator('#application-representative').fill('가상대표');
    await page.locator('#application-companyType').selectOption('법인사업자');
    await page.locator('#application-business').fill('시험용 제조업');
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await page.locator('main').getByRole('button', { name: '정책자금', exact: true })
      .or(page.locator('main label').filter({ hasText: /^정책자금$/ })).first().click();
    await page.locator('#application-urgency').selectOption('일반');
    await page.locator('#application-requestBackground').fill('시험용: 운전자금 정책자금 신청 가능성 검토 요청');
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await page.locator('input[type=file][id$="-company"]').setInputFiles(file('company-doc.txt'));
    await page.locator('input[type=file][id$="-recording"]').setInputFiles(file('call-note.txt'));
    for (const box of await page.getByRole('checkbox', { name: '현재 파일의 자료종류 확인' }).all()) await box.check();
    // 첨부 확인을 바꾸면 제출 동의가 초기화되므로 동의는 마지막에 체크한다.
    await page.getByRole('checkbox', { name: /녹취자료의 저장/ }).check();
    await page.getByRole('checkbox', { name: /첨부 사본의 불필요한 개인정보/ }).check();
    await page.getByRole('button', { name: '협업신청 제출' }).click();
    const ok = await page.waitForFunction(() => !document.body.innerText.includes('4단계 중 4단계'), null, { timeout: 300_000 })
      .then(async () => { await page.waitForTimeout(3000); return (await page.locator('main').innerText()).includes(run.company); }, () => false);
    await page.idle();
    record('협업신청 (첨부 2건)', ok);
    await s.context.close();
  },
  async flow() {
    const ok = [
      await flowStep('1차 보고서 등록', 'admin', report('1차 보고서'), 2),
      await flowStep('공동분석 · 대표', 'admin', [{ click: '공동분석', exact: true }, { click: '대표 분석 완료' }, { save: true }], 2, { section: '공동분석', pattern: /김성민 대표\n분석 완료/ }),
      await flowStep('공동분석 · 파트너', 'A', [{ click: '파트너 분석 완료' }, { save: true }], 3),
    ];
    {
      const s = await openFlow('A');
      await act(s.page, [{ click: '보고서 1–6차', exact: true }]);
      record('파트너 1차 보고서 내려받기', await download(s.page, '첨부 내려받기', fileText['report.txt']));
      await s.context.close();
    }
    const meeting = (kind, attendance, start, end) => [
      { click: '상담 일정', exact: true },
      ...(kind ? [{ select: ['상담 종류', kind] }, { select: ['참석 방식', attendance] }] : []),
      { fill: ['시작일시', `${yesterday}T${start}`] },
      { fill: ['종료일시', `${yesterday}T${end}`] },
      { fill: ['장소 / 상담 방식', '시험용 가상 회의실'] },
      { click: '상담 예약 저장' }, { save: true },
    ];
    ok.push(
      await flowStep('초회상담 예약', 'A', meeting(null, null, '10:00', '11:00'), 4),
      await flowStep('2차 보고서', 'admin', report('2차 보고서'), 4, { section: '보고서 1–6차', pattern: /V1 저장됨\n2차 대표 상담보고서/ }),
      await flowStep('3차 PPT(PDF)', 'admin', report('3차 PPT', false), 5),
      await flowStep('초회상담 완료', 'A', [{ click: '상담 일정', exact: true }, { click: '실제 상담 완료' }, { save: true }], 6),
      await flowStep('녹취 전사문 등록', 'A', [
        { click: '녹취자료·심화분석', exact: true },
        { select: ['완료한 상담', { index: 1 }] },
        { fill: ['전사문 본문', '시험용 가상 전사문입니다. 대표: 운전자금이 필요합니다. 파트너: 정책자금 요건을 확인하겠습니다.'] },
        { check: '선택한 기업·상담일과 주요 금액을 확인했습니다' },
        { check: '자료 저장·분석·담당 파트너 공유에 필요한 활용 권한' },
        { check: '분석 본문과 첨부 사본의 불필요한 개인정보' },
        { click: '녹취자료 저장 · 4차 생성 요청' }, { save: true },
      ], 7),
      await flowStep('4차 보고서(수동)', 'admin', report('4차 보고서'), 8),
      await flowStep('진행솔루션 확정', 'admin', [
        { click: '진행솔루션', exact: true },
        { fill: ['진행솔루션', '정책자금 신청 컨설팅'] },
        { select: ['추가 필수 서류', 'yes'] },
        { fill: ['판단 근거', '시험용: 최근 재무제표 확인이 필요함'] },
        { check: '최신 4차 보고서를 검토했고' },
        // 단계 버튼 "08 진행솔루션 확정"과 이름이 겹치므로 정확히 일치하는 버튼만 누른다.
        { click: '진행솔루션 확정', exact: true }, { save: true },
      ], 9),
      await flowStep('추가서류 요청', 'admin', [
        { click: '추가서류', exact: true },
        { fill: ['요청 서류', '최근 3년 재무제표'] },
        { fill: ['수신 담당자', '가상대표(대표이사)'] },
        { select: ['전달 경로', '카카오톡'] },
        { select: ['5차·6차 준비 전 필수 여부', 'yes'] },
        { click: '서류요청 등록 (아직 발송하지 않음)' }, { save: true },
      ], 9, { section: '추가서류', pattern: /최근 3년 재무제표 \(필수\)\n요청중/ }),
      await flowStep('발송 기록·서류 수령', 'A', [
        { click: '추가서류', exact: true },
        { click: '실제 발송 완료' }, { save: true },
        { open: '수령서류 등록' },
        { file: file('fin.txt') },
        { check: '자료 저장과 담당 파트너 공유 권한을 확인했습니다' },
        { click: '수령서류 저장' }, { save: true },
      ], 9, { section: '추가서류', pattern: /\(필수\)\n검토 대기/ }),
      await flowStep('보완 요청', 'admin', [
        { click: '추가서류', exact: true },
        { open: '보완서류 등록 / 검토' },
        { select: ['검토 결과', { label: '보완 필요 (사유 필수)' }] },
        { fill: ['검토 의견', '시험용: 2025년 재무제표가 빠졌습니다'] },
        { click: '대표 검토 결과 저장' }, { save: true },
      ], 9, { section: '추가서류', pattern: /\(필수\)\n보완 필요/ }),
      await flowStep('보완 서류 제출', 'A', [
        { click: '추가서류', exact: true },
        { open: '보완서류 등록 / 검토' },
        { file: file('fin2.txt') },
        { check: '자료 저장과 담당 파트너 공유 권한을 확인했습니다' },
        { click: '수령서류 저장' }, { save: true },
      ], 9, { section: '추가서류', pattern: /\(필수\)\n검토 대기/ }),
    );
    {
      const s = await openFlow('admin');
      await act(s.page, [{ click: '추가서류', exact: true }]);
      record('대표 보완본 내려받기', await download(s.page, '수령 서류 내려받기', fileText['fin2.txt']));
      await s.context.close();
    }
    ok.push(
      await flowStep('서류 검토 완료', 'admin', [
        { click: '추가서류', exact: true },
        { open: '보완서류 등록 / 검토' },
        { select: ['검토 결과', { label: '검토 완료' }] },
        { fill: ['검토 의견', '시험용 검토 완료'] },
        { click: '대표 검토 결과 저장' }, { save: true },
      ], 10),
      await flowStep('5차 견적서', 'admin', report('5차 견적서'), 10, { section: '보고서 1–6차', pattern: /V1 저장됨\n5차 견적서/ }),
      await flowStep('6차 계약서', 'admin', report('6차 계약서'), 11),
      await flowStep('계약상담 예약·완료', 'A', [
        ...meeting('contract', 'partner', '14:00', '15:00'),
        { click: '실제 상담 완료' }, { save: true },
      ], 12),
      await flowStep('계약 체결 등록', 'A', [
        { click: '계약·입금', exact: true },
        { select: ['계약상담', { index: 1 }] },
        { fill: ['실제 체결일', yesterday] },
        { fill: ['약정 계약금', '3000000'] },
        { file: file('slides.pdf') },
        { check: '자료 저장과 담당 파트너 공유 권한을 확인했습니다' },
        { check: '양 당사자의 실제 서명과' },
        { click: '실제 계약 체결 등록' }, { save: true },
      ], 13),
    );
    const deposit = (amount, memo) => [
      { click: '계약·입금', exact: true },
      { fill: ['입금일', yesterday] },
      { fill: ['이번 입금액', String(amount)] },
      { fill: ['증빙 확인 메모', memo] },
      { check: '실제 거래내역에서 이번 입금을 확인했으며' },
      { click: '실제 입금 확인 저장' }, { save: true },
    ];
    ok.push(
      // 약정보다 적게 들어오면 수행 단계로 넘어가지 않아야 한다.
      await flowStep('계약금 일부 입금(대기 유지)', 'admin', deposit(1_000_000, '시험용 1차 입금'), 13, { section: '계약·입금', pattern: /잔여 계약금\n2,000,000원/ }),
      await flowStep('계약금 잔액 입금', 'admin', deposit(2_000_000, '시험용 잔금 입금'), 14),
      await flowStep('수행 결과·사후관리 시작', 'admin', [
        { click: '수행·사후관리', exact: true },
        { fill: ['수행 결과', '시험용: 정책자금 신청서 제출 완료, 결과 대기'] },
        { fill: ['다음 점검일', kstDate(30)] },
        { fill: ['관리 담당자', run.partners.A.name] },
        { check: '컨설팅 수행 결과를 확인했습니다' },
        { click: '수행 결과 확인 · 사후관리 시작' }, { save: true },
      ], 15),
    );
    return ok.every(Boolean);
  },
  async isolation() {
    const clients = {};
    for (const who of ['A', 'B', 'admin']) {
      const s = await home(who);
      clients[who] = s.context.request;
    }
    clients.anon = (await browser.newContext({ ignoreHTTPSErrors: true })).request;
    const state = await (await clients.A.get(`${base}/api/state`)).json();
    const portal = state.state ?? state;
    const caseA = (portal.cases ?? []).find((c) => JSON.stringify(c).includes(run.company));
    if (!caseA) return record('권한 분리', false, '파트너 A의 기업을 찾지 못함');
    const enc = encodeURIComponent(caseA.id);
    const flow = (await (await clients.A.get(`${base}/api/consulting-flow/${enc}`)).json()).flow;
    const companyFile = (portal.companyDocuments ?? []).find((d) => d.caseId === caseA.id && d.storageFileId);
    const targets = [
      ['FLOW', `/api/consulting-flow/${enc}`],
      ['보고서', `/api/consulting-flow/${enc}/reports/${flow.reports[0].id}?download=1`],
      ['FLOW 파일', `/api/consulting-flow/${enc}/files/${flow.files[0].id}`],
      ...(companyFile ? [['기업자료 파일', `/api/files/${encodeURIComponent(companyFile.storageFileId)}`]] : []),
    ];
    for (const [label, url] of targets) {
      const status = {};
      for (const who of ['A', 'B', 'anon', 'admin']) status[who] = (await clients[who].get(base + url, { maxRedirects: 0 })).status();
      record(`권한 분리: ${label}`, status.A === 200 && status.admin === 200 && status.B === 403 && status.anon === 401,
        `A=${status.A} B=${status.B} 비로그인=${status.anon} 대표=${status.admin}`);
    }
    const stateB = JSON.stringify(await (await clients.B.get(`${base}/api/state`)).json());
    record('권한 분리: B의 화면 데이터에 A 기업 없음', !stateB.includes(run.company));
    const write = await clients.B.post(`${base}/api/consulting-flow/${enc}`, { data: { type: 'confirm_analysis' }, headers: { origin: base } });
    record('권한 분리: B의 수정 시도 거부', write.status() === 403, `HTTP ${write.status()}`);
  },
};

try {
  const command = process.argv[2] ?? 'scenario';
  const fresh = command === 'scenario' || process.argv.includes('--new') || !existsSync(runFile);
  run = fresh ? newRun() : JSON.parse(readFileSync(runFile, 'utf8'));
  if (fresh) writeFileSync(runFile, JSON.stringify(run, null, 2));
  console.log(`실행 ID ${run.id} · 가상 기업 "${run.company}" · 서버 ${base}`);
  if (command === 'scenario') {
    for (const name of ['baseline', 'signup', 'approve', 'apply', 'flow', 'isolation']) {
      console.log(`\n▶ ${name}`);
      await steps[name]();
      if (results.some((r) => !r.ok)) break; // 앞 단계가 실패하면 뒤 단계 결과는 의미가 없다.
    }
  } else if (steps[command]) await steps[command]();
  else throw new Error(`알 수 없는 명령: ${command}. 사용 가능: scenario, ${Object.keys(steps).join(', ')}`);
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n결과: 통과 ${results.length - failed} / 실패 ${failed}`);
  writeFileSync(path.join(work, `result-${run?.id ?? 'none'}.json`), JSON.stringify(results, null, 2));
  process.exitCode = failed ? 1 : 0;
}
