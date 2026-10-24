// Local operator CLI for expired Supabase direct-upload staging objects.
// `check` is read-only. `cleanup` needs an interactive terminal and the exact
// service origin, deletes at most one bounded batch, and never retries.
// Never print a driver error, provider reply, path or secret.
await import('./register-local.mjs');
const { runSupabaseStagingCleanup, createStagingStorage, StagingCleanupError } =
  await import('./supabase-staging-cleanup.mjs');
const { readSecret } = await import('./secret-prompt.mjs');
const [command, ...extra] = process.argv.slice(2);
let close = async () => {};
try {
  if (!['check', 'cleanup'].includes(command) || extra.length)
    throw new StagingCleanupError('staging-usage-invalid');
  if (command === 'cleanup' && (!process.stdin.isTTY || !process.stdout.isTTY))
    throw new StagingCleanupError('interactive-terminal-required');
  const { readSupabaseBackendConfig } =
    await import('../lib/supabase-backend-config.ts');
  // The operator may run this while the service is live or disabled. Only the
  // connection values are read here; the runtime switch is not changed.
  const config = readSupabaseBackendConfig({
    ...process.env,
    PARTNER_HUB_BACKEND_ENABLED: '1',
  });
  console.log(`대상 서비스: ${config.appOrigin}`);
  if (command === 'cleanup') {
    const answer = await readSecret(
      '정리할 서비스 주소를 정확히 입력하세요(표시되지 않음): ',
    );
    if (answer !== config.appOrigin)
      throw new StagingCleanupError('target-confirmation-mismatch');
  }
  const { default: postgres } = await import('postgres');
  const { supabasePostgresClientOptions } =
    await import('../lib/supabase-postgres-client.ts');
  const client = postgres(config.databaseUrl, supabasePostgresClientOptions);
  close = () => client.end({ timeout: 5 });
  const report = await runSupabaseStagingCleanup({
    client,
    storage: createStagingStorage(config),
    apply: command === 'cleanup',
  });
  console.log(JSON.stringify(report, null, 2));
  console.log(
    command === 'cleanup'
      ? '보존 기한이 지난 임시 업로드만 삭제했습니다. 확정 원본과 전송 기록은 변경하지 않았습니다. 삭제한 임시파일은 복구할 수 없습니다.'
      : '읽기 전용 확인입니다. 삭제하지 않았습니다.',
  );
  if (report.remaining > 0)
    console.log(
      `남은 만료 임시파일 ${report.remaining}건은 다음 실행에서 정리합니다.`,
    );
} catch (error) {
  console.error(
    JSON.stringify({
      error:
        error instanceof StagingCleanupError
          ? error.code
          : error instanceof Error &&
              error.message === 'SUPABASE_BACKEND_NOT_CONFIGURED'
            ? 'supabase-connection-not-configured'
            : 'staging-cleanup-failed-redacted',
    }),
  );
  process.exitCode = 1;
} finally {
  try {
    await close();
  } catch {
    console.error(JSON.stringify({ error: 'staging-connection-close-failed' }));
    process.exitCode = 1;
  }
}
