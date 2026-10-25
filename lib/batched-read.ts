import { isPostgresDatabase } from '@/lib/database-dialect';

/**
 * A read-only DB read split into the statements it sends and the step that
 * turns their results into a value. Splitting them lets independent reads
 * share one batch (one PostgreSQL transaction, one round trip) while each
 * keeps its own result handling and error handling.
 */
export type BatchedRead<T> = {
  db: D1Database;
  statements: D1PreparedStatement[];
  parse(results: D1Result[]): T | Promise<T>;
};

/**
 * Runs one read on its own: one batch on PostgreSQL, and on legacy SQLite
 * databases the same separate statement reads as before.
 */
export async function runBatchedRead<T>(read: BatchedRead<T>): Promise<T> {
  return read.parse(
    isPostgresDatabase(read.db)
      ? await read.db.batch(read.statements)
      : await Promise.all(read.statements.map((statement) => statement.all())),
  );
}

/**
 * Sends independent read-only PostgreSQL reads as one batch and returns each
 * read's own slice of the results, unparsed. Every schema guard carried by
 * the statements runs first in that same transaction, so a failing guard or
 * statement fails the whole batch; callers must then fall back to running
 * the reads on their own to keep each read's separate failure handling.
 */
export async function runBatchedReadsTogether(
  reads: readonly BatchedRead<unknown>[],
): Promise<D1Result[][]> {
  if (!reads.length || !reads.every((read) => isPostgresDatabase(read.db)))
    throw new Error('Reads cannot share one PostgreSQL batch.');
  const results = await reads[0].db.batch(
    reads.flatMap((read) => read.statements),
  );
  const expected = reads.reduce(
    (sum, read) => sum + read.statements.length,
    0,
  );
  if (results.length !== expected)
    throw new Error('Combined batch returned an unexpected result count.');
  let offset = 0;
  return reads.map((read) => {
    const slice = results.slice(offset, offset + read.statements.length);
    offset += read.statements.length;
    return slice;
  });
}
