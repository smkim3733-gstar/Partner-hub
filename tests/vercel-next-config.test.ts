import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const deployment = JSON.parse(
  readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
);

await test('default development, build and start use official Next.js', () => {
  assert.equal(manifest.scripts.dev, manifest.scripts['dev:next']);
  assert.equal(manifest.scripts.build, 'next build');
  assert.equal(manifest.scripts.build, manifest.scripts['build:next']);
  assert.equal(manifest.scripts.start, manifest.scripts['start:next']);
  assert.match(manifest.scripts.dev, /^next dev /);
  assert.match(manifest.scripts.start, /^next start /);
});

await test('Vercel builds the default Next.js entry with locked dependencies', () => {
  assert.equal(deployment.framework, 'nextjs');
  assert.equal(deployment.buildCommand, 'pnpm run build');
  assert.equal(deployment.devCommand, 'pnpm run dev');
  assert.equal(deployment.installCommand, 'pnpm install --frozen-lockfile');
  assert.equal(deployment.outputDirectory, undefined);
  assert.equal(deployment.env, undefined);
  assert.equal(deployment.build?.env, undefined);
  assert.notEqual(deployment.git?.deploymentEnabled, false);
});

await test('legacy Sites commands and bundle verification remain explicit', () => {
  assert.equal(manifest.scripts['dev:sites'], 'vinext dev');
  assert.equal(manifest.scripts['build:sites'], 'vinext build');
  assert.equal(
    manifest.scripts['start:sites'],
    'wrangler dev --config dist/server/wrangler.json',
  );
  assert.match(
    manifest.scripts.verify,
    /pnpm run build:sites && pnpm run bundle:verify/,
  );
});

await test('Windows launcher uses the Next.js default without Vinext flags', () => {
  const launcher = readFileSync(
    new URL('../partner-hub.cmd', import.meta.url),
    'utf8',
  );
  assert.match(launcher, /call pnpm\.cmd dev\r?\n/);
  assert.doesNotMatch(launcher, /call pnpm\.cmd dev --host\b/);
});
