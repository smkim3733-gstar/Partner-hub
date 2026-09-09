// Isolated test worker only. Production auth logic + in-memory PostgreSQL DB.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only')
    return { url: 'data:text/javascript,export {}', shortCircuit: true };
  if (specifier === '@/lib/platform-admin-auth' || specifier === '@/lib/platform-auth-capabilities') {
    const moduleName = specifier.slice('@/lib/'.length);
    return { url: new URL(`../lib/${moduleName}.supabase.ts`, import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
