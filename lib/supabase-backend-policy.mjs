// Explicit build selection only. Supabase credentials stay in server modules.
export function supabaseBackendSelected(environment) {
  const selected = environment.PARTNER_HUB_NEXT_BACKEND === 'supabase-v1';
  if (selected && environment.PARTNER_HUB_LOCAL_STORAGE === '1')
    throw new Error('Local and Supabase storage cannot be combined.');
  return selected;
}
