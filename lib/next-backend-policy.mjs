// Build selector only: this file is safe for next.config and contains no secrets.
export const nextRemoteBackendMode = 'cloudflare-http-v1';
export function nextRemoteBackendSelected(environment) {
  const value = environment.PARTNER_HUB_NEXT_BACKEND;
  if (
    value === undefined ||
    value === '' ||
    value === 'disabled' ||
    value === 'vercel-storage-v1' ||
    value === 'supabase-v1'
  )
    return false;
  if (value !== nextRemoteBackendMode)
    throw new Error('Invalid Next backend mode.');
  if (environment.PARTNER_HUB_LOCAL_STORAGE === '1')
    throw new Error('Local and remote Next backends cannot be combined.');
  return true;
}
