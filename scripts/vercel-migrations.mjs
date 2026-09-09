import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
export async function vercelMigrations() {
  const result = [];
  for (const directory of [
    'drizzle',
    'infra/standalone/migrations',
    'infra/vercel/migrations',
  ]) {
    for (const name of (await readdir(new URL(directory + '/', root)))
      .filter((name) => /^\d.*\.sql$/.test(name))
      .sort()) {
      const path = `${directory}/${name}`;
      const sql = (await readFile(new URL(path, root), 'utf8')).replaceAll(
        '\r\n',
        '\n',
      );
      result.push({
        path,
        sql,
        sha256: createHash('sha256').update(sql).digest('hex'),
      });
    }
  }
  return result;
}
const journal = '_partner_hub_migrations';
export async function checkVercelMigrations(client, migrations) {
  migrations ??= await vercelMigrations();
  const present = await client.execute({
    sql: 'SELECT name FROM sqlite_master WHERE type = ? AND name = ?',
    args: ['table', journal],
  });
  const rows = present.rows.length
    ? (
        await client.execute(
          `SELECT path, sha256 FROM ${journal} ORDER BY sequence`,
        )
      ).rows
    : [];
  for (let i = 0; i < rows.length; i++) {
    if (
      rows[i].path !== migrations[i]?.path ||
      rows[i].sha256 !== migrations[i]?.sha256
    )
      throw new Error(
        'Migration history differs. No automatic repair is allowed.',
      );
  }
  return {
    applied: rows.length,
    total: migrations.length,
    remaining: migrations.length - rows.length,
  };
}
export async function applyVercelMigrations(client, migrations) {
  migrations ??= await vercelMigrations();
  const state = await checkVercelMigrations(client, migrations);
  if (state.applied === 0) {
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_libsql_%' AND name <> '_partner_hub_migrations'",
    );
    if (tables.rows.length)
      throw new Error(
        'An unmanaged populated schema is not a new migration target.',
      );
  }
  if ((await client.execute('PRAGMA foreign_keys')).rows[0]?.foreign_keys !== 1)
    throw new Error('Foreign key enforcement must be enabled by the database.');
  for (let index = state.applied; index < migrations.length; index++) {
    const entry = migrations[index];
    const tx = await client.transaction('write');
    try {
      await tx.execute(
        `CREATE TABLE IF NOT EXISTS ${journal} (sequence INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)`,
      );
      const rows = (
        await tx.execute(
          `SELECT sequence,path,sha256 FROM ${journal} ORDER BY sequence`,
        )
      ).rows;
      // Detect concurrent operators under the same write transaction.
      if (rows.length !== index)
        throw new Error(
          'Migration progress changed. Re-run the read-only check.',
        );
      for (let i = 0; i < rows.length; i++)
        if (
          rows[i].sequence !== i ||
          rows[i].path !== migrations[i].path ||
          rows[i].sha256 !== migrations[i].sha256
        )
          throw new Error('Migration history differs.');
      // Let SQLite parse complete triggers; never split SQL on semicolons.
      await tx.executeMultiple(entry.sql);
      await tx.execute({
        sql: `INSERT INTO ${journal} VALUES(?,?,?,?)`,
        args: [index, entry.path, entry.sha256, new Date().toISOString()],
      });
      await tx.commit();
    } catch {
      await tx.rollback().catch(() => {});
      throw new Error(
        `Migration not confirmed: ${entry.path}. Check history before retrying.`,
      );
    } finally {
      tx.close();
    }
  }
  return checkVercelMigrations(client, migrations);
}
