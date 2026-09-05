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

void test('application code cannot delete or reassign a FLOW root', async () => {
  const roots = ['app', 'lib'].map((root) => path.resolve(root));
  const files = (await Promise.all(roots.map(sourceFiles))).flat();
  const violations: string[] = [];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const deletesRoot = /\bDELETE\s+FROM\s+consulting_flows\b/i.test(source);
    const reassignsRoot = Array.from(
      source.matchAll(
        /\bUPDATE\s+consulting_flows\s+SET([\s\S]{0,1000}?)\bWHERE\b/gi,
      ),
      (match) => match[1],
    ).some((setClause) => /\b(?:case_id|partner_id)\s*=/.test(setClause));
    if (deletesRoot || reassignsRoot) {
      violations.push(path.relative(process.cwd(), file));
    }
  }

  assert.deepEqual(violations, []);
});
