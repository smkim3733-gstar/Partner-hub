import { failBackup } from './supabase-backup-runtime.mjs';

// Explicit fixed profiles: a label or a caller-supplied ref cannot expand scope.
/** @returns {Readonly<{projectRef: string, appOrigin: string, expectedTableCount: number, storageBucket?: string, purpose?: string}>} */
export function backupTarget(scope = 'production') {
  if (scope === 'production')
    return Object.freeze({
      projectRef: 'yievsveuxjnbygatvjtb',
      appOrigin: 'https://partner-hub-gamma-five.vercel.app',
      expectedTableCount: 38,
    });
  if (scope === 'verification')
    return Object.freeze({
      projectRef: 'oaqodendjnztzcqaahaq',
      appOrigin: 'https://127.0.0.1:3443',
      storageBucket: 'partner-hub-verification-private',
      expectedTableCount: 39,
      purpose: 'partner-hub-synthetic-verification',
    });
  throw failBackup('backup-scope-invalid');
}

export function assertBackupSource(config, target) {
  if (
    config?.projectRef !== target.projectRef ||
    config.appOrigin !== target.appOrigin ||
    (target.purpose &&
      (config.storageBucket !== target.storageBucket ||
        config.supabaseUrl !== `https://${target.projectRef}.supabase.co`))
  )
    throw failBackup('backup-source-target-mismatch');
  if (target.purpose) {
    let url;
    try {
      url = new URL(config.databaseUrl);
    } catch {
      throw failBackup('backup-source-target-mismatch');
    }
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      decodeURIComponent(url.username) !== `postgres.${target.projectRef}` ||
      !url.hostname.endsWith('.pooler.supabase.com') ||
      url.port !== '6543' ||
      url.pathname !== '/postgres'
    )
      throw failBackup('backup-source-target-mismatch');
  }
}

export async function assertBackupMarker(sql, target) {
  if (!target.purpose) return;
  const marker = await sql.unsafe(
    'SELECT project_ref,purpose FROM partner_hub.verification_environment',
  );
  if (
    marker.length !== 1 ||
    marker[0].project_ref !== target.projectRef ||
    marker[0].purpose !== target.purpose
  )
    throw failBackup('backup-verification-marker-mismatch');
}

export function assertBackupPayload(payload, target) {
  if (
    payload?.format !== 'partner-hub-backup-v1' ||
    payload.source?.projectRef !== target.projectRef ||
    payload.source?.appOrigin !== target.appOrigin ||
    payload.source?.schema !== 'partner_hub' ||
    !payload.database?.serverVersion?.startsWith('17.') ||
    (target.purpose &&
      (payload.source?.purpose !== target.purpose ||
        payload.storage?.bucket?.id !== target.storageBucket))
  )
    throw failBackup('backup-payload-invalid');
}
