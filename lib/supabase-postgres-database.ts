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
    callback: (transaction: SupabasePostgresExecutor) => Promise<T>,
  ): Promise<T>;
};

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
 * schema search path.
 */
export function createSupabasePostgresDatabase(
  client: SupabasePostgresClient,
): D1Database {
  class Statement implements D1PreparedStatement {
    #sql: string;
    #parameters: unknown[];
    constructor(sql: string, parameters: unknown[] = []) {
      this.#sql = sql;
      this.#parameters = [...parameters];
    }
    bind(...values: unknown[]) {
      return new Statement(this.#sql, values);
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
    const wires = statements.map((statement) =>
      statement instanceof Statement ? statement.wire() : invalid(),
    );
    try {
      return await client.begin(async (transaction) => {
        await transaction.unsafe(
          'SET LOCAL search_path TO partner_hub, pg_catalog',
        );
        await transaction.unsafe("SET LOCAL statement_timeout TO '25000ms'");
        await transaction.unsafe("SET LOCAL lock_timeout TO '5000ms'");
        const results: D1Result<T>[] = [];
        for (const wire of wires)
          results.push(
            result<T>(await transaction.unsafe(wire.sql, wire.parameters)),
          );
        return results;
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'SUPABASE_POSTGRES_INVALID_OPERATION'
      )
        throw error;
      throw new Error('SUPABASE_POSTGRES_OPERATION_FAILED_OR_OUTCOME_UNKNOWN');
    }
  }

  return {
    prepare: (sql: string) => new Statement(sql),
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
  } as D1Database;
}
