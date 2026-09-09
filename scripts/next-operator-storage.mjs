export async function openNextOperatorStorage() {
  await import('./register-local.mjs');
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
