// Sites remains the default runtime while the migration branch is prepared.
// Next.js resolves this module to platform-runtime.next.ts at build time.
export { env, waitUntil } from 'cloudflare:workers';
