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
