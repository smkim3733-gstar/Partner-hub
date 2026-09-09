import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// One bundler for the tested source and the deployable Worker artifacts.
// No provider SDK, source credential or deployment call belongs here.
export async function standaloneWorkerBundle(role) {
  if (!['d1', 'r2', 'files'].includes(role))
    throw new Error('Unknown Worker role.');
  const project = fileURLToPath(new URL('..', import.meta.url));
  const require = createRequire(import.meta.url);
  const wrangler = require.resolve('wrangler');
  const { build } = require(require.resolve('esbuild', { paths: [wrangler] }));
  const result = await build({
    entryPoints: [
      path.join(
        project,
        role === 'files'
          ? 'infra/file-transfer/worker.ts'
          : `infra/${role}-bridge/worker.ts`,
      ),
    ],
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    external: ['cloudflare:workers', 'node:*'],
    alias:
      role === 'files'
        ? {
            module: 'node:module',
            '@': project,
            '@/lib/platform-auth-capabilities': path.join(
              project,
              'infra/file-transfer/auth-capabilities.ts',
            ),
            '@/lib/platform-admin-auth': path.join(
              project,
              'infra/file-transfer/admin-auth.ts',
            ),
          }
        : {},
  });
  for (const output of Object.values(result.metafile.outputs))
    for (const dependency of output.imports)
      if (
        !dependency.external ||
        !/^(?:node:|cloudflare:workers$)/.test(dependency.path)
      )
        throw new Error(
          'Standalone Worker contains an unsupported external module.',
        );
  return result.outputFiles[0].text;
}
