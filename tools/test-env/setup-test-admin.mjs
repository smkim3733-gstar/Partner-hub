// 시험용 프로젝트에만 시험용 관리자 계정을 만든다. 비밀번호는 무작위로 만들어
// Git 제외 파일 .env.test-admin.local 에만 기록하고 화면에 출력하지 않는다.
// 실행 (작업 폴더에서): node --env-file=.env.local tools/test-env/setup-test-admin.mjs
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertTestEnvironment, repoDir } from './common.mjs';

const { ref } = assertTestEnvironment();
const credFile = path.join(repoDir, '.env.test-admin.local');
if (existsSync(credFile)) {
  console.log('시험용 관리자 정보 파일이 이미 있습니다. 새로 만들지 않습니다.');
  process.exit(0);
}

const repo = pathToFileURL(repoDir + path.sep).href;
await import(`${repo}scripts/register-local.mjs`);
const { openNextOperatorStorage } = await import(`${repo}scripts/next-operator-storage.mjs`);
const { provisionStandaloneAdmin } = await import(`${repo}lib/standalone-admin-store.ts`);
const { PORTAL_OWNER_EMAIL } = await import(`${repo}lib/member-email.ts`);

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const password = 'Test' + [...randomBytes(24)].map((b) => alphabet[b % alphabet.length]).join('');
const storage = await openNextOperatorStorage();
try {
  await provisionStandaloneAdmin(storage.db, { email: PORTAL_OWNER_EMAIL, password, deployment: 'remote' });
  writeFileSync(credFile, `# 시험용 프로젝트(${ref}) 관리자. 운영 아님.\nTEST_ADMIN_EMAIL=${PORTAL_OWNER_EMAIL}\nTEST_ADMIN_PASSWORD=${password}\n`);
  console.log(`시험용 관리자 생성 완료 (${PORTAL_OWNER_EMAIL}). 비밀번호는 ${credFile} 에만 저장했습니다.`);
} finally {
  await storage.close?.();
}
