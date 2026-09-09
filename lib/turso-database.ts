import type { Client, InStatement } from '@libsql/client';
import {
  validateD1HttpStatements,
  type D1HttpStatement,
} from './d1-http-protocol';

/** Compatibility interface only; no D1 service, Worker or Cloudflare account.
 * All batches go to the primary in one write transaction, including reads.
 * Do not retry unknown write outcomes or use a replica for authorization. */
export function createTursoDatabase(client: Pick<Client, 'batch'>): D1Database {
  const invalid = (): never => {
    throw new Error('TURSO_INVALID_OPERATION');
  };
  async function execute<T>(
    statements: D1HttpStatement[],
  ): Promise<D1Result<T>[]> {
    validateD1HttpStatements(statements);
    try {
      const results = await client.batch(
        statements.map(
          ({ sql, params }) => ({ sql, args: params }) as InStatement,
        ),
        'write',
      );
      if (results.length !== statements.length) throw new Error();
      return results.map((result) => {
        if (
          !Number.isSafeInteger(result.rowsAffected) ||
          result.rowsAffected < 0
        )
          throw new Error();
        const rows = result.rows.map(
          (row) =>
            Object.fromEntries(
              result.columns.map((column) => {
                const value = row[column];
                if (
                  typeof value === 'bigint' ||
                  (typeof value === 'number' &&
                    (!Number.isFinite(value) ||
                      (Number.isInteger(value) &&
                        !Number.isSafeInteger(value))))
                )
                  throw new Error();
                return [column, value];
              }),
            ) as T,
        );
        return {
          success: true,
          results: rows,
          meta: { changes: result.rowsAffected },
        } as D1Result<T>;
      });
    } catch {
      throw new Error('TURSO_OPERATION_FAILED_OR_OUTCOME_UNKNOWN');
    }
  }
  class Statement implements D1PreparedStatement {
    #sql: string;
    #params: unknown[];
    constructor(sql: string, params: unknown[] = []) {
      validateD1HttpStatements([{ sql, params }]);
      this.#sql = sql;
      this.#params = [...params];
    }
    bind(...values: unknown[]) {
      return new Statement(this.#sql, values);
    }
    wire() {
      return { sql: this.#sql, params: this.#params } as D1HttpStatement;
    }
    async all<T = Record<string, unknown>>() {
      return (await execute<T>([this.wire()]))[0];
    }
    run<T = Record<string, unknown>>() {
      return this.all<T>();
    }
    async first<T = Record<string, unknown>>(
      column?: string,
    ): Promise<T | null> {
      const row = (await this.all<Record<string, unknown>>()).results[0];
      if (!row) return null;
      if (column === undefined) return row as T;
      if (!Object.hasOwn(row, column)) invalid();
      return row[column] as T;
    }
    raw<T = unknown[]>(options: {
      columnNames: true;
    }): Promise<[string[], ...T[]]>;
    raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
    raw(): never {
      return invalid();
    }
  }
  const database = {
    prepare: (sql: string) => new Statement(sql),
    batch<T = unknown>(statements: D1PreparedStatement[]) {
      return execute<T>(
        statements.map((statement) =>
          statement instanceof Statement ? statement.wire() : invalid(),
        ),
      );
    },
    exec: invalid,
    dump: invalid,
    withSession: invalid,
  };
  return database;
}
