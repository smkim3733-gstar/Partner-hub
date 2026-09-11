// Local operator CLI. No credential argv, schema changes, Sites writes, runtime
// activation, or automatic retry. Never print a driver error or source value.
await import('./register-local.mjs');
const {
  createSitesSupabaseImportPlan,
  applySitesSupabaseImport,
  sitesImportAppOrigin,
  SitesImportError,
} = await import('./sites-supabase-import-plan.mjs');
const { readSecret } = await import('./secret-prompt.mjs');
const [command, path, expectedHash, ...extra] = process.argv.slice(2);
let close = async () => {};
try {
  if (command === '--help' && !path) {
    console.log(
      'Scoped Sites SQLite -> Supabase importer.\nplan <frozen.sqlite>\napply <frozen.sqlite> <exact-source-file-sha256>\nApply requires an interactive terminal, the exact production URL, preserved/frozen source and independently checked empty source Storage inventory. Imports portal/draft/revision-one FLOW; archives ChatGPT bindings in the original snapshot only. No activation, schema alteration, or automatic retry.',
    );
  } else {
    if (
      !['plan', 'apply'].includes(command) ||
      !path ||
      extra.length ||
      (command === 'plan' && expectedHash) ||
      (command === 'apply' && !/^[a-f0-9]{64}$/.test(expectedHash ?? ''))
    )
      throw new SitesImportError('import-usage-invalid');
    if (command === 'apply' && (!process.stdin.isTTY || !process.stdout.isTTY))
      throw new SitesImportError('interactive-terminal-required');
    const plan = await createSitesSupabaseImportPlan(path);
    console.log(JSON.stringify(plan, null, 2));
    if (command === 'apply') {
      if (plan.sourceFileSha256 !== expectedHash)
        throw new SitesImportError('source-hash-confirmation-mismatch');
      const { readSupabaseBackendConfig } =
        await import('../lib/supabase-backend-config.ts');
      if (process.env.PARTNER_HUB_BACKEND_ENABLED !== '0')
        throw new SitesImportError('disabled-backend-required');
      const config = readSupabaseBackendConfig({
        ...process.env,
        PARTNER_HUB_BACKEND_ENABLED: '1',
      });
      console.log(`대상 서비스: ${sitesImportAppOrigin}`);
      const confirmedOrigin = await readSecret(
        '대상 서비스 주소를 정확히 입력하세요: ',
      );
      const preservation = await readSecret(
        '원본 사본 보존·Sites 쓰기 동결·전체 원본 Storage 목록 0건을 확인했다면 PRESERVED-FROZEN-NO-FILES 입력: ',
      );
      const { default: postgres } = await import('postgres');
      const { supabasePostgresClientOptions } =
        await import('../lib/supabase-postgres-client.ts');
      const client = postgres(
        config.databaseUrl,
        supabasePostgresClientOptions,
      );
      close = () => client.end({ timeout: 5 });
      const result = await applySitesSupabaseImport(plan, client, {
        appOrigin: config.appOrigin,
        projectRef: config.projectRef,
        confirmedOrigin,
        sourceFileSha256: expectedHash,
        backendEnabled: process.env.PARTNER_HUB_BACKEND_ENABLED,
        sourcePreservedAndFrozen: preservation === 'PRESERVED-FROZEN-NO-FILES',
        sourceStorageInventoryEmpty:
          preservation === 'PRESERVED-FROZEN-NO-FILES',
      });
      console.log(JSON.stringify(result, null, 2));
    }
  }
} catch (error) {
  console.error(
    JSON.stringify({
      error:
        error instanceof SitesImportError
          ? error.code
          : 'import-failed-redacted',
      migrationReady: false,
    }),
  );
  process.exitCode = 1;
} finally {
  try {
    await close();
  } catch {
    console.error(
      JSON.stringify({
        error: 'import-connection-close-failed',
        migrationReady: false,
      }),
    );
    process.exitCode = 1;
  }
}
