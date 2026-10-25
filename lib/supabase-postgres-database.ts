import { registerPostgresDatabase } from './database-dialect';

type PostgresRow = Record<string, unknown>;
type PostgresResult = PostgresRow[] & {
  count?: number;
  command?: string;
};

export type SupabasePostgresExecutor = {
  unsafe(
    query: string,
    parameters?: readonly unknown[],
  ): Promise<PostgresResult>;
};

export type SupabasePostgresClient = SupabasePostgresExecutor & {
  begin<T>(
    mode: typeof serializableTransactionMode,
    callback: (transaction: SupabasePostgresExecutor) => Promise<T>,
  ): Promise<T>;
};

/** Sent as `BEGIN ISOLATION LEVEL SERIALIZABLE`, so no extra round trip. */
export const serializableTransactionMode = 'isolation level serializable';
/** One statement for the three transaction-local settings (`SET LOCAL`). */
export const transactionSettingsSql =
  "SELECT set_config('search_path', 'partner_hub, pg_catalog', true), set_config('statement_timeout', '25000ms', true), set_config('lock_timeout', '5000ms', true)";

// Only the read-only schema assertions may ride along as batch guards.
const schemaGuardSql = /^SELECT partner_hub\.assert_[a-z_]+\(\) AS ready$/;

const unsupportedSql =
  /\b(?:(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|TRIGGER)|PRAGMA|VACUUM|ATTACH|DETACH|sqlite_master|json_(?:each|extract|set|valid|type|group_array|object|array)|julianday|unixepoch|strftime|RAISE|GLOB|HEX|IIF|GROUP_CONCAT|WITHOUT\s+ROWID|INSERT\s+OR)\b/i;

function invalid(): never {
  throw new Error('SUPABASE_POSTGRES_INVALID_OPERATION');
}

function translateNumberedParameters(sql: string, parameters: unknown[]) {
  if (!sql.trim() || sql.includes('\0') || unsupportedSql.test(sql)) invalid();
  let output = '';
  let state: 'code' | 'single' | 'double' | 'line' | 'block' = 'code';
  const used = new Set<number>();
  for (let index = 0; index < sql.length; index++) {
    const current = sql[index],
      next = sql[index + 1];
    if (state === 'single') {
      output += current;
      if (current === "'" && next === "'") output += sql[++index];
      else if (current === "'") state = 'code';
      continue;
    }
    if (state === 'double') {
      output += current;
      if (current === '"' && next === '"') output += sql[++index];
      else if (current === '"') state = 'code';
      continue;
    }
    if (state === 'line') {
      output += current;
      if (current === '\n') state = 'code';
      continue;
    }
    if (state === 'block') {
      output += current;
      if (current === '*' && next === '/') {
        output += sql[++index];
        state = 'code';
      }
      continue;
    }
    if (current === "'") state = 'single';
    else if (current === '"') state = 'double';
    else if (current === '-' && next === '-') {
      output += current + sql[++index];
      state = 'line';
      continue;
    } else if (current === '/' && next === '*') {
      output += current + sql[++index];
      state = 'block';
      continue;
    } else if (current === '?') {
      const match = /^(\d+)/.exec(sql.slice(index + 1));
      if (!match || match[1][0] === '0') invalid();
      const parameterIndex = Number(match[1]);
      if (
        !Number.isSafeInteger(parameterIndex) ||
        parameterIndex > parameters.length
      )
        invalid();
      used.add(parameterIndex);
      output += `$${parameterIndex}`;
      index += match[1].length;
      continue;
    }
    output += current;
  }
  if (state === 'single' || state === 'double' || state === 'block') invalid();
  if (
    parameters.some((_, index) => !used.has(index + 1)) ||
    /\bIS\s+\$\d+\b/i.test(output)
  )
    invalid();
  return output;
}

function postgresValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  )
    return value;
  if (typeof value === 'bigint') {
    const number = Number(value);
    if (Number.isSafeInteger(number)) return number;
  }
  return invalid();
}

function result<T>(
  rows: PostgresResult,
): D1Result<T> {
  const converted = rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, postgresValue(value)]),
    ),
  ) as T[];
  const command = rows.command?.toUpperCase();
  const changes =
    command && ['INSERT', 'UPDATE', 'DELETE'].includes(command)
      ? (rows.count ?? converted.length)
      : 0;
  if (!Number.isSafeInteger(changes) || changes < 0) invalid();
  return {
    success: true,
    results: converted,
    meta: { changes },
  } as D1Result<T>;
}

/**
 * D1 result-shape compatibility for the Supabase PostgreSQL migration.
 *
 * It intentionally accepts only already-ported PostgreSQL SQL. SQLite JSON,
 * PRAGMA, GLOB, RAISE and null-safe `IS ?n` statements fail before a network
 * call. Every D1 batch runs in one PostgreSQL transaction with a local private
 * schema search path. Schema-guarded views prepend their assertions to each
 * batch in that same transaction instead of spending a separate one.
 */
export function createSupabasePostgresDatabase(
  client: SupabasePostgresClient,
): D1Database {
  class Statement implements D1PreparedStatement {
    #sql: string;
    #parameters: unknown[];
    readonly guards: readonly string[];
    constructor(
      sql: string,
      parameters: unknown[] = [],
      guards: readonly string[] = [],
    ) {
      this.#sql = sql;
      this.#parameters = [...parameters];
      this.guards = guards;
    }
    bind(...values: unknown[]) {
      return new Statement(this.#sql, values, this.guards);
    }
    wire() {
      return {
        sql: translateNumberedParameters(this.#sql, this.#parameters),
        parameters: this.#parameters.map(postgresValue),
      };
    }
    async all<T = Record<string, unknown>>() {
      return (await execute<T>([this]))[0];
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

  async function execute<T>(statements: Statement[]) {
    if (!statements.length) invalid();
    const guards = [
      ...new Set(
        statements.flatMap((statement) =>
          statement instanceof Statement ? statement.guards : invalid(),
        ),
      ),
    ];
    const wires = [
      ...guards.map((sql) => ({ sql, parameters: [] as unknown[] })),
      ...statements.map((statement) => statement.wire()),
    ];
    try {
      // SQLite serializes writers. Read committed can instead commit a
      // credential insert after its paired portal CAS loses a race. Require
      // a serializable snapshot; conflicting transactions abort in full.
      return await client.begin(
        serializableTransactionMode,
        async (transaction) => {
          // Issue the settings and every statement before awaiting any of them
          // so the driver pipelines them: PostgreSQL still runs them in order,
          // and a failure aborts the rest, but the batch costs one network
          // round trip instead of one per statement.
          const [, ...replies] = await Promise.all([
            transaction.unsafe(transactionSettingsSql),
            ...wires.map((wire) =>
              transaction.unsafe(wire.sql, wire.parameters),
            ),
          ]);
          return replies.slice(guards.length).map((rows) => result<T>(rows));
        },
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'SUPABASE_POSTGRES_INVALID_OPERATION'
      )
        throw error;
      throw new Error('SUPABASE_POSTGRES_OPERATION_FAILED_OR_OUTCOME_UNKNOWN');
    }
  }

  function view(guards: readonly string[]): D1Database {
    const database = {
      prepare: (sql: string) => new Statement(sql, [], guards),
      batch<T = unknown>(statements: D1PreparedStatement[]) {
        return execute<T>(
          statements.map((statement) =>
            statement instanceof Statement ? statement : invalid(),
          ),
        );
      },
      exec: invalid,
      dump: invalid,
      withSession: invalid,
    } as unknown as D1Database;
    return registerPostgresDatabase(database, (guardSql) => {
      if (!schemaGuardSql.test(guardSql)) invalid();
      return guards.includes(guardSql)
        ? database
        : view([...guards, guardSql]);
    });
  }
  return view([]);
}
