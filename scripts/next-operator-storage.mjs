export async function openNextOperatorStorage() {
  await import('./register-local.mjs');
  const { supabaseBackendSelected } =
    await import('../lib/supabase-backend-policy.mjs');
  if (supabaseBackendSelected(process.env)) {
    const { readSupabaseBackendConfig } =
      await import('../lib/supabase-backend-config.ts');
    const { default: postgres } = await import('postgres');
    const { createSupabaseDatabaseClient, supabasePostgresClientOptions } =
      await import('../lib/supabase-postgres-client.ts');
    // Process-local setup access; never activates deployed runtime or stores keys.
    const config = readSupabaseBackendConfig({
      ...process.env, PARTNER_HUB_BACKEND_ENABLED: '1',
    });
    const client = postgres(config.databaseUrl, supabasePostgresClientOptions);
    const db = createSupabaseDatabaseClient(config.databaseUrl, () => client);
    try {
      await db.prepare('SELECT partner_hub.assert_auth_schema() AS ready').first();
      return { config, db, close: () => client.end({ timeout: 5 }) };
    } catch (error) {
      await client.end({ timeout: 5 });
      throw error;
    }
  }
  const { vercelStorageSelected } =
    await import('../lib/vercel-storage-policy.mjs');
  if (vercelStorageSelected(process.env)) {
    const { readVercelStorageConfig } =
      await import('../lib/vercel-storage-config.ts');
    const { createClient } = await import('@libsql/client/web');
    const { createTursoDatabase } = await import('../lib/turso-database.ts');
    // Initial schema/admin setup precedes runtime activation. This override is
    // process-local and never enables the deployed application.
    const config = readVercelStorageConfig({
      ...process.env,
      PARTNER_HUB_BACKEND_ENABLED: '1',
    });
    const client = createClient({
      url: config.databaseUrl,
      authToken: config.authToken,
      intMode: 'number',
    });
    return { config, db: createTursoDatabase(client), client };
  }
  const { readNextBackendConfig } =
    await import('../lib/next-backend-config.ts');
  const { createD1HttpDatabase } = await import('../lib/d1-http-client.ts');
  const config = readNextBackendConfig(process.env);
  return { config, db: createD1HttpDatabase(config.d1) };
}
