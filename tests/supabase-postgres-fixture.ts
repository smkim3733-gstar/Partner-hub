import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import {
  createSupabasePostgresDatabase,
  type SupabasePostgresExecutor,
} from '../lib/supabase-postgres-database';

// Real, in-memory PostgreSQL engine. No credentials or external connections.
// PGlite serializes its single connection: this is NOT multi-session race QA.
export async function postgresFixture(options: { flowRoot?: boolean } = {}) {
  const engine = await PGlite.create({
    parsers: { 20: (value) => BigInt(value) },
  });
  let lastQueryError: unknown;
  try {
    await engine.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE ROLE service_role BYPASSRLS;`);
    for (const name of [
      '0001_partner_hub_private_schema.sql',
      '0002_storage_object_versions.sql',
      '0003_authentication.sql',
      '0004_portal_state.sql',
      '0005_password_link_metrics.sql',
      '0006_application_drafts.sql',
      '0007_company_file_ledgers.sql',
      '0008_ai_diagnosis_runs.sql',
      '0009_consulting_flow_core_guards.sql',
      '0010_consulting_flow_file_ledgers.sql',
      '0011_consulting_flow_command_boundaries.sql',
      '0012_consulting_flow_source_ai_effects.sql',
      '0013_consulting_flow_business_effects.sql',
      '0014_consulting_flow_transcript_purpose.sql',
      '0015_consulting_flow_domain.sql',
      ...(options.flowRoot ? ['0016_consulting_flow_root.sql'] : []),
      '0017_portal_operational_metrics.sql',
      '0018_file_inventory_read_helpers.sql',
    ]) {
      await engine.exec(
        await readFile(
          new URL(`../supabase/migrations/${name}`, import.meta.url),
          'utf8',
        ),
      );
    }
    function executor(
      connection: Pick<PGlite, 'query'>,
    ): SupabasePostgresExecutor {
      return {
        async unsafe(query, parameters = []) {
          const result = await connection
            .query<Record<string, unknown>>(query, [...parameters])
            .catch((error: unknown) => {
              // Synthetic, in-memory test diagnostics only. Production adapter
              // intentionally redacts PostgreSQL query/parameter error details.
              lastQueryError = error;
              throw error;
            });
          return Object.assign(result.rows, {
            command: /^\s*(\w+)/.exec(query)?.[1].toUpperCase(),
            count: result.affectedRows ?? result.rows.length,
          });
        },
      };
    }
    const db = createSupabasePostgresDatabase({
      ...executor(engine),
      async begin(callback) {
        return engine
          .transaction((transaction) => callback(executor(transaction)))
          .catch((error: unknown) => {
            // Deferred constraints can fail at COMMIT, outside executor.query.
            lastQueryError = error;
            throw error;
          });
      },
    });
    return {
      engine,
      db,
      lastQueryError: () => lastQueryError,
      close: () => engine.close(),
    };
  } catch (error) {
    await engine.close();
    throw error;
  }
}
