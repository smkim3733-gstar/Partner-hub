import {
  D1HttpError,
  d1HttpPath,
  d1HttpLimits,
  isD1HttpSecret,
  isRecord,
  readD1HttpJson,
  validateD1HttpStatements,
  type D1HttpStatement,
} from './d1-http-protocol';

type Options = {
  origin: string;
  secret: string;
  // Dependency injection is limited to isolated tests and Worker service bindings.
  fetcher?: typeof fetch;
  allowLoopback?: boolean;
  timeoutMs?: number;
};

export function createD1HttpDatabase(options: Options): D1Database {
  let origin: URL;
  try {
    origin = new URL(options.origin);
  } catch {
    throw new D1HttpError('D1_HTTP_INVALID_INPUT');
  }
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/' ||
    (origin.protocol !== 'https:' &&
      !(
        options.allowLoopback &&
        origin.protocol === 'http:' &&
        ['127.0.0.1', '[::1]', 'localhost'].includes(origin.hostname)
      )) ||
    !isD1HttpSecret(options.secret)
  )
    throw new D1HttpError('D1_HTTP_INVALID_INPUT');
  const endpoint = new URL(d1HttpPath, origin).href;
  const secret = options.secret;
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
    throw new D1HttpError('D1_HTTP_INVALID_INPUT');
  const owner = {};

  async function execute<T>(
    statements: D1HttpStatement[],
  ): Promise<D1Result<T>[]> {
    validateD1HttpStatements(statements);
    const body = JSON.stringify({ version: 1, statements });
    if (new TextEncoder().encode(body).length > d1HttpLimits.requestBytes)
      throw new D1HttpError('D1_HTTP_INVALID_INPUT');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new D1HttpError('D1_HTTP_OUTCOME_UNKNOWN'));
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        deadline,
        (async () => {
          // A failed/late response may follow a committed write. NEVER auto-retry.
          const response = await fetcher(endpoint, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${secret}`,
              'content-type': 'application/json',
            },
            body,
            signal: controller.signal,
            redirect: 'manual',
            cache: 'no-store',
            credentials: 'omit',
          });
          if (response.status === 401)
            throw new D1HttpError('D1_HTTP_AUTH_FAILED');
          if (
            response.status !== 200 ||
            !/^application\/json(?:\s*;|$)/i.test(
              response.headers.get('content-type') ?? '',
            )
          )
            throw new D1HttpError('D1_HTTP_OUTCOME_UNKNOWN');
          const envelope = await readD1HttpJson(
            response.body,
            d1HttpLimits.responseBytes,
          );
          if (!isRecord(envelope) || envelope.version !== 1)
            throw new D1HttpError('D1_HTTP_OUTCOME_UNKNOWN');
          if (
            envelope.ok !== true ||
            !Array.isArray(envelope.results) ||
            envelope.results.length !== statements.length
          )
            throw new D1HttpError('D1_HTTP_OUTCOME_UNKNOWN');
          for (const result of envelope.results) {
            if (
              !isRecord(result) ||
              result.success !== true ||
              !Array.isArray(result.results) ||
              !isRecord(result.meta) ||
              !Number.isSafeInteger(result.meta.changes) ||
              (result.meta.changes as number) < 0 ||
              'error' in result
            )
              throw new D1HttpError('D1_HTTP_OUTCOME_UNKNOWN');
          }
          return envelope.results as D1Result<T>[];
        })(),
      ]);
    } catch (error) {
      if (error instanceof D1HttpError && error.code === 'D1_HTTP_AUTH_FAILED')
        throw error;
      throw new D1HttpError('D1_HTTP_OUTCOME_UNKNOWN');
    } finally {
      clearTimeout(timer!);
      controller.abort();
    }
  }

  class Statement implements D1PreparedStatement {
    // Private fields prevent accidental query/credential exposure in JSON logs.
    #sql: string;
    #params: unknown[];
    #owner = owner;
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
    ownedBy(identity: object) {
      return this.#owner === identity;
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
      if (!Object.prototype.hasOwnProperty.call(row, column))
        throw new D1HttpError('D1_HTTP_INVALID_INPUT');
      return row[column] as T;
    }
    raw<T = unknown[]>(options: {
      columnNames: true;
    }): Promise<[string[], ...T[]]>;
    raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
    raw(): never {
      throw new D1HttpError('D1_HTTP_UNSUPPORTED');
    }
  }
  const database = {
    prepare: (sql: string) => new Statement(sql),
    batch<T = unknown>(statements: D1PreparedStatement[]) {
      const wire = statements.map((statement) => {
        if (!(statement instanceof Statement) || !statement.ownedBy(owner))
          throw new D1HttpError('D1_HTTP_INVALID_INPUT');
        return statement.wire();
      });
      return execute<T>(wire);
    },
    // Only the subset exercised by the portal is supported. No fake bookmarks,
    // silent multi-statement exec, local fallback or administrative export API.
    exec(): never {
      throw new D1HttpError('D1_HTTP_UNSUPPORTED');
    },
    dump(): never {
      throw new D1HttpError('D1_HTTP_UNSUPPORTED');
    },
    withSession(): never {
      throw new D1HttpError('D1_HTTP_UNSUPPORTED');
    },
  };
  return database;
}
