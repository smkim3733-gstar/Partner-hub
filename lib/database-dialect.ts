// Database identity, not a request header or process-wide environment flag.
// One process may contain both a legacy fixture and a PostgreSQL connection.
const postgresDatabases = new WeakSet<D1Database>();
const schemaGuardViews = new WeakMap<
  D1Database,
  (guardSql: string) => D1Database
>();
export function registerPostgresDatabase<T extends D1Database>(
  db: T,
  withSchemaGuard?: (guardSql: string) => D1Database,
): T {
  postgresDatabases.add(db);
  if (withSchemaGuard) schemaGuardViews.set(db, withSchemaGuard);
  return db;
}
export function isPostgresDatabase(db: D1Database) {
  return postgresDatabases.has(db);
}

/**
 * Returns a view of a PostgreSQL database whose every later batch first runs
 * `guardSql` (a `partner_hub.assert_*_schema()` check) inside the same
 * transaction. The guard costs no extra network round trip, and a missing or
 * disabled schema guard aborts the work it protects atomically. Callers must
 * use the returned database for the protected work.
 */
export async function postgresSchemaGuarded(
  db: D1Database,
  guardSql: string,
): Promise<D1Database> {
  const view = schemaGuardViews.get(db);
  if (view) return view(guardSql);
  await db.prepare(guardSql).first();
  return db;
}
