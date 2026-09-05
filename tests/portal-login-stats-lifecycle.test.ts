import test from 'node:test';
import assert from 'node:assert/strict';
import { env } from 'cloudflare:workers';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readPortalLoginStats, recordPortalLogin } from '../lib/portal-state';

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

void test('portal login statistics accept only one forward session transition', async () => {
  const memberId = 'login-stat-lifecycle-member';
  await recordPortalLogin(memberId);
  const db = (env as unknown as { DB: D1Database }).DB;
  const stored = await db
    .prepare(
      'SELECT member_id, last_login_at, login_count FROM portal_login_stats WHERE member_id = ?1',
    )
    .bind(memberId)
    .first<{
      member_id: string;
      last_login_at: string;
      login_count: number;
    }>();
  assert.ok(stored);

  await assert.rejects(
    db
      .prepare(
        'INSERT INTO portal_login_stats (member_id, last_login_at, login_count) VALUES (?1, ?2, ?3)',
      )
      .bind(' invalid-login-stat ', new Date().toISOString(), 1)
      .run(),
    /insert envelope is invalid/,
  );
  await assert.rejects(
    db
      .prepare(
        'UPDATE portal_login_stats SET member_id = ?1 WHERE member_id = ?2',
      )
      .bind('another-login-stat-member', memberId)
      .run(),
    /identity is immutable/,
  );
  await assert.rejects(
    db
      .prepare(
        'UPDATE portal_login_stats SET last_login_at = ?1 WHERE member_id = ?2',
      )
      .bind('not-a-timestamp', memberId)
      .run(),
    /update envelope is invalid/,
  );
  await assert.rejects(
    db
      .prepare(
        'UPDATE portal_login_stats SET last_login_at = ?1 WHERE member_id = ?2',
      )
      .bind('2000-01-01T00:00:00.000Z', memberId)
      .run(),
    /update envelope is invalid/,
  );
  for (const loginCount of [0, 3]) {
    await assert.rejects(
      db
        .prepare(
          'UPDATE portal_login_stats SET login_count = ?1 WHERE member_id = ?2',
        )
        .bind(loginCount, memberId)
        .run(),
      /update envelope is invalid/,
    );
  }
  await assert.rejects(
    db
      .prepare(
        'UPDATE portal_login_stats SET login_count = 2 WHERE member_id = ?1',
      )
      .bind(memberId)
      .run(),
    /update envelope is invalid/,
  );
  assert.deepEqual(
    await db
      .prepare(
        'SELECT member_id, last_login_at, login_count FROM portal_login_stats WHERE member_id = ?1',
      )
      .bind(memberId)
      .first(),
    stored,
  );

  await recordPortalLogin(memberId);
  const stats = await readPortalLoginStats();
  const current = stats.find((stat) => stat.memberId === memberId);
  assert.ok(current);
  assert.equal(current.loginCount, 1);
  assert.ok(current.lastLoginAt >= stored.last_login_at);
});

void test('application code has one login statistics writer', async () => {
  const files = (
    await Promise.all(
      ['app', 'lib'].map((root) => sourceFiles(path.resolve(root))),
    )
  ).flat();
  const writers: string[] = [];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+portal_login_stats\b/i.test(
        source,
      )
    )
      writers.push(path.relative(process.cwd(), file).replaceAll('\\', '/'));
  }

  assert.deepEqual(writers, ['lib/portal-state.ts']);
});
