// Test process only: use real standalone authentication with injected test DB.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only')
    return { url: 'data:text/javascript,export {}', shortCircuit: true };
  if (specifier === '@/lib/platform-admin-auth')
    return {
      url: new URL('../lib/platform-admin-auth.remote.ts', import.meta.url)
        .href,
      shortCircuit: true,
    };
  return nextResolve(specifier, context);
}
