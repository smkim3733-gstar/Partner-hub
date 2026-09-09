// Database identity, not a request header or process-wide environment flag.
// One process may contain both a legacy fixture and a PostgreSQL connection.
const postgresDatabases = new WeakSet<D1Database>();
export function registerPostgresDatabase<T extends D1Database>(db: T): T {
  postgresDatabases.add(db);
  return db;
}
export function isPostgresDatabase(db: D1Database) {
  return postgresDatabases.has(db);
}
