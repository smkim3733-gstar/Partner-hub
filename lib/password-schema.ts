import { portalPasswordSchemaSql } from '../db/schema';
import { isPostgresDatabase } from './database-dialect';

export function passwordSchemaStatements(db: D1Database) {
  // PostgreSQL schema changes are operator migrations, never request-time DDL.
  // Keep the guard inside callers' batches so a missing schema aborts all work.
  return isPostgresDatabase(db)
    ? [db.prepare('SELECT partner_hub.assert_auth_schema() AS ready')]
    : portalPasswordSchemaSql.map(sql => db.prepare(sql));
}
