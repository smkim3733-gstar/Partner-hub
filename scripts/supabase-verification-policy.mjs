// This allowlist is intentionally separate from the production application.
// A verification label alone must never authorize a production connection.
export const productionProjectRef = 'yievsveuxjnbygatvjtb';
export const productionAppOrigin = 'https://partner-hub-gamma-five.vercel.app';

export function verificationError(code) {
  const error = new Error(`VERIFICATION_${code}`);
  error.verificationCode = code;
  return error;
}

export function verificationTarget(input) {
  if (
    !input ||
    input.purpose !== 'partner-hub-synthetic-verification' ||
    !/^[a-z0-9]{20}$/.test(input.projectRef) ||
    input.projectRef === productionProjectRef ||
    input.storageBucket !== 'partner-hub-verification-private'
  )
    throw verificationError('TARGET_REJECTED');
  let origin;
  try {
    origin = new URL(input.appOrigin);
  } catch {
    throw verificationError('ORIGIN_REJECTED');
  }
  // Initial live verification is served only on loopback with verified TLS.
  // A preview deployment requires a separate, reviewed target policy.
  if (
    origin.origin !== input.appOrigin ||
    origin.protocol !== 'https:' ||
    origin.hostname !== '127.0.0.1' ||
    origin.username ||
    origin.password ||
    !origin.port ||
    Number(origin.port) < 1024
  )
    throw verificationError('ORIGIN_REJECTED');
  return Object.freeze({
    purpose: input.purpose,
    projectRef: input.projectRef,
    appOrigin: origin.origin,
    storageBucket: input.storageBucket,
  });
}

export async function verificationSettings(input, env) {
  const target = verificationTarget(input);
  const { readSupabaseBackendConfig } =
    await import('../lib/supabase-backend-config.ts');
  // Construct a narrow environment; never fall back to parent/.env settings.
  const environment = {
    PARTNER_HUB_NEXT_BACKEND: 'supabase-v1',
    PARTNER_HUB_BACKEND_ENABLED: '1',
    PARTNER_HUB_APP_ORIGIN: target.appOrigin,
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_DATABASE_URL: env.SUPABASE_DATABASE_URL,
    SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY,
    SUPABASE_STORAGE_BUCKET: target.storageBucket,
  };
  let config;
  try {
    config = readSupabaseBackendConfig(environment);
  } catch {
    throw verificationError('CONNECTION_REJECTED');
  }
  if (config.projectRef !== target.projectRef)
    throw verificationError('PROJECT_MISMATCH');
  return { target, config, environment };
}

export function migrationBody(source) {
  if (!/^\s*begin;/i.test(source) || !/commit;\s*$/i.test(source))
    throw verificationError('MIGRATION_BOUNDARY');
  return source.replace(/^\s*begin;/i, '').replace(/commit;\s*$/i, '');
}

export function assertVerificationBucket(value, bucket) {
  if (
    value?.id !== bucket ||
    value.public !== false ||
    value.file_size_limit !== 26214400 ||
    !Array.isArray(value.allowed_mime_types) ||
    value.allowed_mime_types.length !== 1 ||
    value.allowed_mime_types[0] !== 'application/octet-stream'
  )
    throw verificationError('BUCKET_POLICY');
}
