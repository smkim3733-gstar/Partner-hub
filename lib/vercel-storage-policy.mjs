// Build selection only. Credentials are read exclusively by server modules.
export function vercelStorageSelected(environment) {
  const mode = environment.PARTNER_HUB_NEXT_BACKEND;
  if (mode === 'vercel-storage-v1') {
    if (environment.PARTNER_HUB_LOCAL_STORAGE === '1')
      throw new Error('Local and Vercel storage cannot be combined.');
    return true;
  }
  return (mode === undefined || mode === '') && environment.VERCEL === '1';
}
