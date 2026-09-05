import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) return sourceFiles(target);
      return /\.(?:ts|tsx)$/.test(entry.name) ? [target] : [];
    }),
  );
  return files.flat();
}

void test('application code cannot rewrite or delete FLOW file ledger rows', async () => {
  const roots = ['app', 'lib'].map((root) => path.resolve(root));
  const files = (await Promise.all(roots.map(sourceFiles))).flat();
  const forbidden =
    /\b(?:UPDATE|DELETE\s+FROM)\s+consulting_flow_file_(?:owners|metadata|object_integrity)\b/i;
  const violations: string[] = [];

  for (const file of files) {
    if (forbidden.test(await readFile(file, 'utf8'))) {
      violations.push(path.relative(process.cwd(), file));
    }
  }

  assert.deepEqual(violations, []);
});
