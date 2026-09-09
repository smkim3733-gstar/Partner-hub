import { resolve as resolveTypescript } from './typescript-loader.mjs';
export { load } from './typescript-loader.mjs';

// Exercise the real Next auth module selection without a Cloudflare mock.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers')
    throw new Error(
      'The standalone Next auth boundary must not import Cloudflare.',
    );
  if (specifier === '@/lib/platform-auth-capabilities')
    return {
      url: new URL('../lib/platform-auth-capabilities.next.ts', import.meta.url)
        .href,
      shortCircuit: true,
    };
  return resolveTypescript(specifier, context, nextResolve);
}
