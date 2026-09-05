import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(target);
      return /\.(?:ts|tsx)$/.test(entry.name) ? [target] : [];
    }),
  );
  return nested.flat();
}

void test('application code has one draft writer and cannot delete or reassign draft roots', async () => {
  const roots = ['app', 'lib'].map((root) => path.resolve(root));
  const files = (await Promise.all(roots.map(sourceFiles))).flat();
  const violations: string[] = [];
  const writers: string[] = [];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const relative = path.relative(process.cwd(), file).replaceAll('\\', '/');
    const deletesRoot = /\bDELETE\s+FROM\s+application_drafts\b/i.test(source);
    const updates = Array.from(
      source.matchAll(
        /\bUPDATE\s+application_drafts\s+SET([\s\S]{0,1000}?)\bWHERE\b/gi,
      ),
    );
    const reassignsRoot = updates.some((match) =>
      /\bowner_key\s*=/.test(match[1]),
    );
    if (deletesRoot || reassignsRoot) violations.push(relative);
    if (
      updates.length > 0 ||
      /\bINSERT\s+INTO\s+application_drafts\b/i.test(source)
    )
      writers.push(relative);
  }

  assert.deepEqual(violations, []);
  assert.deepEqual(writers, ['app/api/application-draft/route.ts']);
});
