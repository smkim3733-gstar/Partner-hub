import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function componentSources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) sources.push(...(await componentSources(path)));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) sources.push(await readFile(path, 'utf8'));
  }
  return sources;
}

export async function readPortalUiSource() {
  const root = process.cwd();
  return [
    await readFile(join(root, 'app/page.tsx'), 'utf8'),
    ...(await componentSources(join(root, 'components'))),
  ].join('\n/* portal-ui-source-boundary */\n');
}
