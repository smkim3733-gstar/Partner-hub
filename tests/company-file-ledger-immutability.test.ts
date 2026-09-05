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
    /\b(?:UPDATE|DELETE\s+FROM)\s+company_file_(?:metadata|object_integrity|storage_keys|assignments|case_links)\b/i;
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

void test('application code cannot remove durable company-file upload receipts', () => {
  const root = process.cwd();
  const forbidden = /\bDELETE\s+FROM\s+company_file_upload_requests\b/i;
  const violations = [
    ...sourceFiles(join(root, 'app')),
    ...sourceFiles(join(root, 'lib')),
  ]
    .filter((file) => forbidden.test(readFileSync(file, 'utf8')))
    .map((file) => relative(root, file));

  assert.deepEqual(violations, [], 'upload tombstones must remain durable');
});

void test('application code cannot rewrite the immutable company-file parent row', () => {
  const root = process.cwd();
  const forbidden = /\bUPDATE\s+company_file_objects\b/i;
  const violations = [
    ...sourceFiles(join(root, 'app')),
    ...sourceFiles(join(root, 'lib')),
  ]
    .filter((file) => forbidden.test(readFileSync(file, 'utf8')))
    .map((file) => relative(root, file));

  assert.deepEqual(violations, [], 'company-file facts must be inserted once');
});
