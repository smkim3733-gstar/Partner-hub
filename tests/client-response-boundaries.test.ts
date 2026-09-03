import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : /\.(ts|tsx)$/.test(entry.name)
        ? [path]
        : [];
  });
}

void test('client UI never parses API JSON outside explicit response boundaries', () => {
  const root = process.cwd();
  const candidates = [
    join(root, 'app', 'page.tsx'),
    ...sourceFiles(join(root, 'components')),
  ];
  const violations = candidates
    .filter((path) => readFileSync(path, 'utf8').includes("'use client'"))
    .filter((path) => /\.json\s*\(\s*\)/.test(readFileSync(path, 'utf8')))
    .map((path) => relative(root, path));

  assert.deepEqual(
    violations,
    [],
    'API JSON must be read and validated in a dedicated response boundary before UI state changes.',
  );
});
