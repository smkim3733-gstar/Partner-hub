import test from 'node:test';
import assert from 'node:assert/strict';
import { env } from 'cloudflare:workers';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { portalStateId } from '../db/schema';
import {
  mutatePortalState,
  readPortalState,
  writePortalState,
} from '../lib/portal-state';

const seed = () => ({
  version: 1,
  consultationNumber: 0,
  membersRevision: 0,
  timeline: [],
  schedule: [],
  tasks: [],
  companyDocuments: [],
  cases: [],
  members: [],
});

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

void test('portal state keeps one fixed durable D1 root', async () => {
  const initial = seed();
  await writePortalState(initial);
  const db = (env as unknown as { DB: D1Database }).DB;
  const stored = await db
    .prepare('SELECT id, payload, updated_at FROM portal_state WHERE id = ?1')
    .bind(portalStateId)
    .first();
  assert.ok(stored);

  await assert.rejects(
    db
      .prepare(
        'INSERT INTO portal_state (id, payload, updated_at) VALUES (?1, ?2, ?3)',
      )
      .bind(
        'another-portal-root',
        JSON.stringify(initial),
        new Date().toISOString(),
      )
      .run(),
    /identity is fixed/,
  );
  await assert.rejects(
    db
      .prepare('UPDATE portal_state SET id = ?1 WHERE id = ?2')
      .bind('another-portal-root', portalStateId)
      .run(),
    /identity is immutable/,
  );
  await assert.rejects(
    db
      .prepare('DELETE FROM portal_state WHERE id = ?1')
      .bind(portalStateId)
      .run(),
    /root is durable/,
  );
  await assert.rejects(
    db
      .prepare('UPDATE portal_state SET payload = ?1 WHERE id = ?2')
      .bind('{malformed', portalStateId)
      .run(),
    /update envelope is invalid/,
  );
  await assert.rejects(
    db
      .prepare('UPDATE portal_state SET updated_at = ?1 WHERE id = ?2')
      .bind('not-a-timestamp', portalStateId)
      .run(),
    /update envelope is invalid/,
  );
  assert.deepEqual(
    await db
      .prepare('SELECT id, payload, updated_at FROM portal_state WHERE id = ?1')
      .bind(portalStateId)
      .first(),
    stored,
  );

  await mutatePortalState((current) => ({
    ...(current as typeof initial),
    consultationNumber: 1,
  }));
  assert.equal(
    ((await readPortalState()) as typeof initial).consultationNumber,
    1,
  );
});

void test('application code cannot delete or reassign the portal state root', async () => {
  const roots = ['app', 'lib'].map((root) => path.resolve(root));
  const files = (await Promise.all(roots.map(sourceFiles))).flat();
  const violations: string[] = [];
  const writers: string[] = [];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const relative = path.relative(process.cwd(), file).replaceAll('\\', '/');
    const deletesRoot = /\bDELETE\s+FROM\s+portal_state\b/i.test(source);
    const updates = Array.from(
      source.matchAll(
        /\bUPDATE\s+portal_state\s+SET([\s\S]{0,1500}?)\bWHERE\b/gi,
      ),
    );
    const reassignsRoot = updates.some((match) => /\bid\s*=/.test(match[1]));
    if (deletesRoot || reassignsRoot) violations.push(relative);
    if (updates.length > 0 || /\bINSERT\s+INTO\s+portal_state\b/i.test(source))
      writers.push(relative);
  }

  assert.deepEqual(violations, []);
  assert.deepEqual(writers.sort(), [
    'lib/file-recovery-store.ts',
    'lib/password-handlers.ts',
    'lib/portal-state.ts',
  ]);
});
