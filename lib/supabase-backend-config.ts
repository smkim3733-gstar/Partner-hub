import { supabaseBackendSelected } from './supabase-backend-policy.mjs';

const projectRefPattern = /^[a-z0-9]{20}$/;
const bucketPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type SupabaseBackendConfig = {
  appOrigin: string;
  projectRef: string;
  supabaseUrl: string;
  databaseUrl: string;
  secretKey: string;
  storageBucket: string;
};

export function readSupabaseBackendConfig(
  environment: Record<string, string | undefined>,
): SupabaseBackendConfig {
  const invalid = (): never => {
    throw new Error('SUPABASE_BACKEND_NOT_CONFIGURED');
  };
  if (
    !supabaseBackendSelected(environment) ||
    environment.PARTNER_HUB_LOCAL_STORAGE === '1' ||
    environment.PARTNER_HUB_BACKEND_ENABLED !== '1'
  )
    invalid();

  const appOrigin = environment.PARTNER_HUB_APP_ORIGIN;
  const supabaseUrl = environment.SUPABASE_URL;
  const databaseUrl = environment.SUPABASE_DATABASE_URL;
  const secretKey = environment.SUPABASE_SECRET_KEY;
  const storageBucket = environment.SUPABASE_STORAGE_BUCKET;
  if (
    !appOrigin ||
    !supabaseUrl ||
    !databaseUrl ||
    !secretKey ||
    !storageBucket
  )
    return invalid();

  let app: URL, api: URL, database: URL, databaseProjectRef: string;
  try {
    app = new URL(appOrigin);
    api = new URL(supabaseUrl);
    database = new URL(databaseUrl);
    databaseProjectRef = decodeURIComponent(database.username).replace(
      /^postgres\./,
      '',
    );
  } catch {
    return invalid();
  }
  const projectRef = api.hostname.split('.')[0] ?? '';
  const allowedDatabaseQuery =
    database.search === '' || database.search === '?sslmode=require';
  if (
    app.protocol !== 'https:' ||
    app.origin !== appOrigin ||
    app.username ||
    app.password ||
    api.protocol !== 'https:' ||
    api.origin !== supabaseUrl ||
    api.hostname !== `${projectRef}.supabase.co` ||
    !projectRefPattern.test(projectRef) ||
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !database.hostname.endsWith('.pooler.supabase.com') ||
    database.port !== '6543' ||
    databaseProjectRef !== projectRef ||
    !database.password ||
    database.pathname !== '/postgres' ||
    !allowedDatabaseQuery ||
    database.hash ||
    !/^sb_secret_[A-Za-z0-9_-]{16,512}$/.test(secretKey) ||
    !bucketPattern.test(storageBucket)
  )
    return invalid();

  return {
    appOrigin,
    projectRef,
    supabaseUrl,
    databaseUrl,
    secretKey,
    storageBucket,
  };
}
