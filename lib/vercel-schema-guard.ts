import { createHash } from 'node:crypto';
import type { Client } from '@libsql/client';

// Hash of ordered {sequence,path,sha256} rows from scripts/vercel-migrations.
// Tests require this to match every shipped SQL file. No schema is applied by
// the web process, even if someone enables the backend before initialization.
export const vercelSchemaCount = 102;
export const vercelSchemaDigest =
  '69d46601c458c58915899c9f59b9eb49c163ef247ae7a1897420cc356e09edaf';
export function guardTursoSchema(
  client: Pick<Client, 'batch'>,
): Pick<Client, 'batch'> {
  let ready: Promise<void> | undefined;
  async function verify() {
    try {
      const results = await client.batch(
        [
          'SELECT sequence,path,sha256 FROM _partner_hub_migrations ORDER BY sequence',
          'PRAGMA foreign_keys',
        ],
        'write',
      );
      const rows = results[0].rows.map((row) => ({
        sequence: row.sequence,
        path: row.path,
        sha256: row.sha256,
      }));
      if (
        rows.length !== vercelSchemaCount ||
        results[1].rows[0]?.foreign_keys !== 1 ||
        createHash('sha256').update(JSON.stringify(rows)).digest('hex') !==
          vercelSchemaDigest
      )
        throw new Error();
    } catch {
      throw new Error('VERCEL_SCHEMA_NOT_READY');
    }
  }
  return {
    async batch(statements, mode) {
      try {
        await (ready ??= verify());
      } catch (error) {
        ready = undefined;
        throw error;
      }
      return client.batch(statements, mode);
    },
  };
}
