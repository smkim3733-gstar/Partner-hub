import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { NextLocalBindings } from '../../lib/next-local-bindings';
import {
  nextLocalStorageEnabled,
  nextLocalStorageName,
} from '../../lib/next-local-storage-policy.mjs';
import { emptyPortalStateBaseline } from '../../lib/pilot-readiness';
import { portalStateId } from '../../db/schema';
import { createLocalR2Bucket } from './r2-proxy';

// Only selected by the development build alias. Never connected to Sites data.
export async function createNextLocalPlatform() {
  if (!nextLocalStorageEnabled(process.env))
    throw new Error(
      'Local storage is permitted only in opted-in, non-Vercel next dev.',
    );
  const root = process.cwd();
  const name = nextLocalStorageName(process.env.PARTNER_HUB_LOCAL_STORAGE_NAME);
  process.env.WRANGLER_WRITE_LOGS = 'false';
  // getPlatformProxy uses Wrangler's override; Miniflare's override alone is
  // insufficient. Keep both registries inside this isolated workspace.
  process.env.WRANGLER_REGISTRY_PATH = join(
    root,
    '.wrangler',
    'next-local',
    name,
    'registry',
  );
  process.env.MINIFLARE_REGISTRY_PATH = process.env.WRANGLER_REGISTRY_PATH;
  const { getPlatformProxy, unstable_splitSqlQuery } = await import('wrangler');
  const platform = await getPlatformProxy<NextLocalBindings>({
    configPath: join(root, 'dev', 'next-local', 'wrangler.json'),
    envFiles: [],
    remoteBindings: false,
    persist: { path: join(root, '.wrangler', 'next-local', name, 'v3') },
  });
  const disposers: (() => Promise<void>)[] = [];
  try {
    const db = platform.env.DB;
    await db
      .prepare(
        'CREATE TABLE IF NOT EXISTS next_local_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL)',
      )
      .run();
    const applied = await db
      .prepare('SELECT name, sha256 FROM next_local_migrations')
      .all<{ name: string; sha256: string }>();
    const hashes = new Map(
      applied.results.map((row) => [row.name, row.sha256]),
    );
    const files = (await readdir(join(root, 'drizzle')))
      .filter((file) => /^\d+.*\.sql$/.test(file))
      .sort();
    if (files.length === 0)
      throw new Error(
        'No migration files found; local storage was not initialized.',
      );
    const migrationFiles = [
      ...files.map((file) => ({
        name: file,
        path: join(root, 'drizzle', file),
      })),
      ...(await readdir(join(root, 'dev', 'next-local', 'migrations')))
        .filter((file) => /^\d+.*\.sql$/.test(file))
        .sort()
        .map((file) => ({
          name: `next/${file}`,
          path: join(root, 'dev', 'next-local', 'migrations', file),
        })),
    ];
    for (const { name: file, path } of migrationFiles) {
      const source = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n');
      const hash = createHash('sha256').update(source).digest('hex');
      if (hashes.has(file)) {
        if (hashes.get(file) !== hash)
          throw new Error(`Applied local migration changed: ${file}`);
        continue;
      }
      await db.batch([
        ...unstable_splitSqlQuery(source).map((sql) => db.prepare(sql)),
        db
          .prepare(
            'INSERT INTO next_local_migrations (name, sha256) VALUES (?1, ?2)',
          )
          .bind(file, hash),
      ]);
    }
    // An empty, isolated local workspace; no demo members, admin or real data.
    await db
      .prepare(
        'INSERT INTO portal_state (id, payload, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING',
      )
      .bind(
        portalStateId,
        JSON.stringify(emptyPortalStateBaseline()),
        new Date().toISOString(),
      )
      .run();
    let localEnv: NextLocalBindings = {
      ...platform.env,
      AI_SOURCE_FILES: createLocalR2Bucket(platform.env.AI_SOURCE_FILES),
    };
    if (process.env.PARTNER_HUB_LOCAL_R2_HTTP === '1') {
      const { createLocalR2HttpBridge } = await import('./r2-http');
      const bridge = await createLocalR2HttpBridge(localEnv.AI_SOURCE_FILES);
      disposers.push(() => bridge.dispose());
      localEnv = { ...localEnv, AI_SOURCE_FILES: bridge.bucket };
    }
    if (process.env.PARTNER_HUB_LOCAL_D1_HTTP === '1') {
      const { createLocalD1HttpBridge } = await import('./d1-http');
      const bridge = await createLocalD1HttpBridge(db);
      disposers.push(() => bridge.dispose());
      localEnv = { ...localEnv, DB: bridge.db };
    }
    if (process.env.PARTNER_HUB_LOCAL_FILE_HTTP === '1') {
      const { createLocalFileHttpBridge } = await import('./file-http');
      const bridge = await createLocalFileHttpBridge();
      disposers.push(() => bridge.dispose());
      localEnv = { ...localEnv, FILE_TRANSFER: bridge.config };
    }
    return {
      ...platform,
      env: localEnv,
      async dispose() {
        try {
          await Promise.all(disposers.map((dispose) => dispose()));
        } finally {
          await platform.dispose();
        }
      },
    };
  } catch (error) {
    await Promise.allSettled(disposers.map((dispose) => dispose()));
    await platform.dispose();
    throw error;
  }
}

const localGlobal = globalThis as typeof globalThis & {
  __partnerHubNextLocalPlatform?: ReturnType<typeof createNextLocalPlatform>;
};

export async function loadNextLocalBindings(): Promise<NextLocalBindings> {
  localGlobal.__partnerHubNextLocalPlatform ??= createNextLocalPlatform().catch(
    (error: unknown) => {
      delete localGlobal.__partnerHubNextLocalPlatform;
      throw error;
    },
  );
  return (await localGlobal.__partnerHubNextLocalPlatform).env;
}
