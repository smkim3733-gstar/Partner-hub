import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

void test('shadcn CLI stays build-only while its runtime component package remains explicit', async () => {
  const packageJson = JSON.parse(
    await readFile(join(process.cwd(), 'package.json'), 'utf8'),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  assert.equal(packageJson.dependencies?.shadcn, undefined);
  assert.equal(packageJson.devDependencies?.shadcn, '4.18.0');
  assert.equal(packageJson.dependencies?.['@shadcn/react'], '0.3.0');

  const globals = await readFile(
    join(process.cwd(), 'app/globals.css'),
    'utf8',
  );
  assert.match(globals, /^@import 'shadcn\/tailwind\.css';/m);
});

void test('build stack excludes known vulnerable image-size and esbuild releases', async () => {
  const packageJson = JSON.parse(
    await readFile(join(process.cwd(), 'package.json'), 'utf8'),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const lockfile = await readFile(
    join(process.cwd(), 'pnpm-lock.yaml'),
    'utf8',
  );

  assert.equal(packageJson.dependencies?.vinext, '1.0.0-beta.9');
  assert.equal(packageJson.devDependencies?.vite, '8.2.2');
  assert.doesNotMatch(lockfile, /(?:^|\n)\s*image-size@/);
  assert.doesNotMatch(lockfile, /(?:^|\n)\s*esbuild@0\.27\.3:/);
  assert.match(lockfile, /(?:^|\n)\s*esbuild@0\.28\.1:/);
});
