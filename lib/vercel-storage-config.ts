import { vercelStorageSelected } from './vercel-storage-policy.mjs';

export function readVercelStorageConfig(
  environment: Record<string, string | undefined>,
) {
  const invalid = (): never => {
    throw new Error('VERCEL_STORAGE_NOT_CONFIGURED');
  };
  if (
    !vercelStorageSelected(environment) ||
    environment.PARTNER_HUB_LOCAL_STORAGE === '1' ||
    environment.PARTNER_HUB_BACKEND_ENABLED !== '1'
  )
    invalid();
  const appOrigin = environment.PARTNER_HUB_APP_ORIGIN;
  const databaseUrl = environment.TURSO_DATABASE_URL;
  const authToken = environment.TURSO_AUTH_TOKEN;
  const blobToken = environment.BLOB_READ_WRITE_TOKEN;
  if (!appOrigin || !databaseUrl || !authToken || !blobToken) return invalid();
  let app: URL, db: URL;
  try {
    app = new URL(appOrigin);
    db = new URL(databaseUrl);
  } catch {
    return invalid();
  }
  if (
    app.protocol !== 'https:' ||
    app.origin !== appOrigin ||
    app.username ||
    app.password ||
    !['libsql:', 'https:'].includes(db.protocol) ||
    !db.hostname.endsWith('.turso.io') ||
    db.username ||
    db.password ||
    db.port ||
    (db.pathname !== '' && db.pathname !== '/') ||
    db.search ||
    db.hash ||
    !/^[\x21-\x7e]{16,8192}$/.test(authToken) ||
    !/^vercel_blob_rw_[A-Za-z0-9]+_[A-Za-z0-9]+$/.test(blobToken)
  )
    return invalid();
  return { appOrigin, databaseUrl, authToken, blobToken };
}
