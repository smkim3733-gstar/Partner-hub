// Vercel defaults to Supabase; explicit modes still take precedence.
// Build selection never supplies credentials or enables backend access.
export function supabaseBackendSelected(environment) {
  const mode = environment.PARTNER_HUB_NEXT_BACKEND;
  const selected =
    mode === 'supabase-v1' ||
    ((mode === undefined || mode === '') && environment.VERCEL === '1');
  if (selected && environment.PARTNER_HUB_LOCAL_STORAGE === '1')
    throw new Error('Local and Supabase storage cannot be combined.');
  return selected;
}
