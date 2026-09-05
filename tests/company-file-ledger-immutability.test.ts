import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

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

void test('application code cannot rewrite or directly remove immutable company-file ledgers', () => {
  const root = process.cwd();
  const forbidden =
    /\b(?:UPDATE|DELETE\s+FROM)\s+company_file_(?:metadata|object_integrity|storage_keys)\b/i;
  const violations = [
    ...sourceFiles(join(root, 'app')),
    ...sourceFiles(join(root, 'lib')),
  ]
    .filter((file) => forbidden.test(readFileSync(file, 'utf8')))
    .map((file) => relative(root, file));

  assert.deepEqual(
    violations,
    [],
    'immutable file evidence must be inserted once and removed only by parent cascade',
  );
});
