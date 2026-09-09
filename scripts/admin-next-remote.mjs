// Explicit operator workflow. No default account, schema writes or password argv.
import { readSecret } from './secret-prompt.mjs';
import { openNextOperatorStorage } from './next-operator-storage.mjs';

async function main() {
  const checkOnly = process.argv.length === 3 && process.argv[2] === '--check';
  if (
    !checkOnly &&
    (process.argv.length !== 2 || !process.stdin.isTTY || !process.stdout.isTTY)
  )
    throw new Error(
      '운영 관리자 최초 설정은 대화형 터미널에서 실행하세요. 비밀번호 인수·파이프는 받지 않습니다.',
    );
  await import('./register-local.mjs');
  const [
    { provisionStandaloneAdmin },
    { PORTAL_OWNER_EMAIL },
    { passwordProblem },
  ] = await Promise.all([
    import('../lib/standalone-admin-store.ts'),
    import('../lib/member-email.ts'),
    import('../lib/password-policy.ts'),
  ]);
  const { config, db } = await openNextOperatorStorage();
  console.log(`대상 서비스: ${config.appOrigin}`);
  // Read-only column availability check, not a full migration integrity audit.
  await db.batch([
    db.prepare(
      'SELECT id,email,display_name,password_hash,credential_version,active,created_at,updated_at FROM standalone_admin_accounts WHERE 0',
    ),
    db.prepare(
      'SELECT token_hash,admin_id,credential_version,issued_at,expires_at FROM standalone_admin_sessions WHERE 0',
    ),
    db.prepare(
      'SELECT id,admin_id,action,created_at FROM standalone_admin_audit WHERE 0',
    ),
    db.prepare(
      'SELECT token_hash,member_id,email,credential_version,expires_at FROM portal_password_sessions WHERE 0',
    ),
  ]);
  const existing = await db
    .prepare('SELECT COUNT(*) AS count FROM standalone_admin_accounts')
    .first('count');
  if (existing !== 0 && existing !== 1)
    throw new Error(
      '관리자 저장소 상태를 확인해야 합니다. 변경하지 않았습니다.',
    );
  if (checkOnly) {
    console.log(
      `관리자 테이블 연결 확인. 관리자 ${existing === 1 ? '설정됨' : '미설정'}. 데이터 이관·무결성·배포 완료 검증과는 별개입니다.`,
    );
    return;
  }
  if (existing !== 0)
    throw new Error('기존 관리자가 있습니다. 자격증명을 덮어쓰지 않습니다.');
  console.log(
    `새 대상 DB에 ${PORTAL_OWNER_EMAIL} 관리자를 최초 생성합니다. 기존 Sites 계정은 변경하지 않습니다.`,
  );
  const confirmation = await readSecret(
    '대상 서비스 주소를 정확히 입력하세요(표시되지 않음): ',
  );
  if (confirmation !== config.appOrigin)
    throw new Error('대상 확인이 일치하지 않습니다. 변경하지 않았습니다.');
  let password = await readSecret(
    '새 운영 전용 비밀번호(15~128자, 표시되지 않음): ',
  );
  let repeated = '';
  try {
    const problem = passwordProblem(password);
    if (problem) throw new Error(problem);
    repeated = await readSecret('비밀번호 확인: ');
    if (password !== repeated)
      throw new Error('비밀번호가 일치하지 않습니다. 변경하지 않았습니다.');
    await provisionStandaloneAdmin(db, {
      email: PORTAL_OWNER_EMAIL,
      password,
      deployment: 'remote',
    });
    console.log(
      '운영 관리자 최초 설정 완료. 기존 계정 덮어쓰기와 자동 로그인은 수행하지 않았습니다.',
    );
  } finally {
    password = '';
    repeated = '';
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error &&
      error.constructor === Error &&
      !error.cause &&
      !/SQL|D1_|SQLITE/i.test(error.message)
      ? error.message
      : '운영 관리자 설정을 확인하지 못했습니다. 비밀값·저장소 오류 상세는 출력하지 않습니다.',
  );
  process.exitCode = 1;
});
