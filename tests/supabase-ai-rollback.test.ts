import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { postgresFixture } from './supabase-postgres-fixture';

void test('target AI rollback probe checks real PostgreSQL guards without retaining metadata', async (t) => {
  const f = await postgresFixture();
  t.after(f.close);
  const results = await f.engine.exec(await readFile(new URL('./supabase-ai-rollback.sql', import.meta.url), 'utf8'));
  assert.ok(results.some((result) => result.rows.some((row) => String((row as { result?: unknown }).result).startsWith('PASS:'))));
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM ai_diagnosis_runs').first('n'), 0);
});
