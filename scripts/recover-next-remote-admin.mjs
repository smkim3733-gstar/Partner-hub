// Break-glass operator command. Possession of privileged backend access is required.
// No email-only reset, public endpoint, password argv/env/pipe or automatic retry.
import { randomUUID } from 'node:crypto';
import { readSecret } from './secret-prompt.mjs';
import { openNextOperatorStorage } from './next-operator-storage.mjs';
let closeStorage = async () => {};

async function main() {
  const check = process.argv.length === 3 && process.argv[2] === '--check';
  if (
    !check &&
    (process.argv.length !== 2 || !process.stdin.isTTY || !process.stdout.isTTY)
  )
    throw new Error(
      '관리자 복구는 대화형 터미널에서 실행하세요. 비밀번호 인수·파이프는 받지 않습니다.',
    );
  await import('./register-local.mjs');
  const [
    { recoverStandaloneAdmin },
    { PORTAL_OWNER_EMAIL },
    { passwordProblem },
  ] = await Promise.all([
    import('../lib/standalone-admin-recovery.ts'),
    import('../lib/member-email.ts'),
    import('../lib/password-policy.ts'),
  ]);
  const storage = await openNextOperatorStorage();
  const { config, db } = storage;
  closeStorage = storage.close ?? closeStorage;
  console.log(`대상 서비스: ${config.appOrigin}`);
  const rows = await db
    .prepare(`SELECT id, email, active, credential_version
    FROM standalone_admin_accounts`)
    .all();
  if (
    rows.results.length !== 1 ||
    rows.results[0].id !== 'primary-admin' ||
    rows.results[0].email !== PORTAL_OWNER_EMAIL ||
    rows.results[0].active !== 1
  )
    throw new Error(
      '활성 대표 관리자 한 명이 설정된 대상만 복구할 수 있습니다. 변경하지 않았습니다.',
    );
  const account = rows.results[0];
  // Read-only schema availability; existing migration history is never rewritten.
  await db
    .prepare(`SELECT id,admin_id,reason,previous_version_hash,next_version_hash,created_at
    FROM standalone_admin_recovery_audit WHERE 1 = 0`)
    .all();
  const latest = await db
    .prepare(`SELECT id,created_at FROM standalone_admin_recovery_audit
    WHERE admin_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 1`)
    .bind(account.id)
    .first();
  if (check) {
    console.log(
      JSON.stringify({
        activeAdministrator: true,
        recoveryAuditAvailable: true,
        latestRecovery: latest
          ? { id: latest.id, createdAt: latest.created_at }
          : null,
        writes: 0,
      }),
    );
    return;
  }
  console.log(
    '관리자 비밀번호를 교체하고 모든 관리자 세션·기존 파일 전송 권한을 폐기합니다. 파트너 계정과 기존 Sites는 변경하지 않습니다.',
  );
  if (
    (await readSecret(
      '대상 서비스 주소를 정확히 입력하세요(표시되지 않음): ',
    )) !== config.appOrigin
  )
    throw new Error('대상 확인이 일치하지 않습니다. 변경하지 않았습니다.');
  const reason = await readSecret(
    '복구 사유 입력: lost-password / credential-compromise / rotation: ',
  );
  if (!['lost-password', 'credential-compromise', 'rotation'].includes(reason))
    throw new Error('지정된 복구 사유를 입력하세요. 변경하지 않았습니다.');
  let password = '';
  let repeated = '';
  try {
    password = await readSecret(
      '새 운영 전용 비밀번호(15~128자, 표시되지 않음): ',
    );
    const problem = passwordProblem(password);
    if (problem) throw new Error(problem);
    repeated = await readSecret('비밀번호 확인: ');
    if (password !== repeated)
      throw new Error('비밀번호가 일치하지 않습니다. 변경하지 않았습니다.');
    const recoveryId = randomUUID();
    console.log(`복구 기록 ID: ${recoveryId}`);
    const result = await recoverStandaloneAdmin(db, {
      email: PORTAL_OWNER_EMAIL,
      password,
      reason,
      recoveryId,
      expectedCredentialVersion: account.credential_version,
    });
    console.log(
      `관리자 복구 완료. 기존 관리자 세션 ${result.revokedSessions}개 폐기. 새 비밀번호로 다시 로그인하세요.`,
    );
  } finally {
    password = '';
    repeated = '';
  }
}
main().finally(() => closeStorage()).catch(() => {
  // Network errors can mean commit succeeded but its response was lost.
  // Do not report "nothing changed" or replay the mutation automatically.
  console.error(
    '관리자 복구가 완료되지 않았거나 결과를 확인하지 못했습니다. 대상 설정·대화형 입력·관리자 상태를 확인하세요. 비밀번호 인수·파이프는 받지 않습니다.',
  );
  console.error(
    '복구 기록 ID가 출력된 뒤 실패했다면 자동 재실행하지 마세요. --check의 최근 기록과 해당 ID를 대조하고 새 비밀번호로 로그인 여부를 확인하세요. 비밀값·저장소 오류 상세는 출력하지 않습니다.',
  );
  process.exitCode = 1;
});
