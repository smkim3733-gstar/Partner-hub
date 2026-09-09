import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { postgresFixture } from './supabase-postgres-fixture';

void test('target draft/file rollback probe runs on real PostgreSQL and leaves zero rows', async (t) => {
  const f = await postgresFixture();
  t.after(f.close);
  const results = await f.engine.exec(await readFile(new URL('./supabase-draft-file-rollback.sql', import.meta.url), 'utf8'));
  assert.ok(results.some((result) => result.rows.some((row) => String((row as { result?: unknown }).result).startsWith('PASS:'))));
  for (const table of ['application_drafts', 'company_file_objects', 'company_file_upload_requests'])
    assert.equal(await f.db.prepare(`SELECT count(*) AS n FROM ${table}`).first('n'), 0);
});
