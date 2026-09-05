import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys = ON');
export const objects = new Map();
const objectMetadata = new Map();
const objectEtags = new Map();
const waitUntilTasks = [];
let waitUntilFailure = false;
let batchFailure = false;
let batchFailurePattern = '';
let statementFailure = false;
let statementFailurePattern = '';
export function waitUntil(task) {
  if (waitUntilFailure) {
    waitUntilFailure = false;
    throw new Error('synthetic waitUntil failure');
  }
  waitUntilTasks.push(Promise.resolve(task));
}
export async function flushWaitUntil() {
  const tasks = waitUntilTasks.splice(0);
  await Promise.allSettled(tasks);
}
export function failNextWaitUntil() {
  waitUntilFailure = true;
}
export function failNextDatabaseBatch(sqlPattern = '') {
  batchFailure = true;
  batchFailurePattern = sqlPattern;
}
export function failNextDatabaseStatement(sqlPattern = '') {
  statementFailure = true;
  statementFailurePattern = sqlPattern;
}
function failStatementIfRequested(sql) {
  if (
    statementFailure &&
    (!statementFailurePattern || sql.includes(statementFailurePattern))
  ) {
    statementFailure = false;
    statementFailurePattern = '';
    throw new Error('synthetic database statement failure');
  }
}
class Statement {
  constructor(sql, values = []) {
    this.sql = sql;
    this.values = values;
  }
  bind(...values) {
    return new Statement(this.sql, values);
  }
  args() {
    return this.values.length
      ? [Object.fromEntries(this.values.map((v, i) => [`?${i + 1}`, v]))]
      : [];
  }
  runSync() {
    failStatementIfRequested(this.sql);
    const result = sqlite.prepare(this.sql).run(...this.args());
    return { success: true, meta: { changes: Number(result.changes) } };
  }
  batchSync() {
    failStatementIfRequested(this.sql);
    const statement = sqlite.prepare(this.sql);
    if (statement.columns().length > 0)
      return {
        success: true,
        results: statement.all(...this.args()),
        meta: { changes: 0 },
      };
    const result = statement.run(...this.args());
    return { success: true, meta: { changes: Number(result.changes) } };
  }
  async run() {
    return this.runSync();
  }
  async first() {
    failStatementIfRequested(this.sql);
    return sqlite.prepare(this.sql).get(...this.args()) ?? null;
  }
  async all() {
    failStatementIfRequested(this.sql);
    return {
      success: true,
      results: sqlite.prepare(this.sql).all(...this.args()),
    };
  }
}
export const env = {
  DB: {
    prepare(sql) {
      return new Statement(sql);
    },
    async batch(items) {
      if (
        batchFailure &&
        (!batchFailurePattern ||
          items.some((item) => item.sql.includes(batchFailurePattern)))
      ) {
        batchFailure = false;
        batchFailurePattern = '';
        throw new Error('synthetic database batch failure');
      }
      sqlite.exec('BEGIN');
      try {
        const results = items.map((item) => item.batchSync());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  },
  AI_SOURCE_FILES: {
    async head(key) {
      const bytes = objects.get(key);
      return bytes
        ? {
            key,
            size: bytes.byteLength,
            etag: objectEtags.get(key),
            httpMetadata: objectMetadata.get(key),
          }
        : null;
    },
    async put(key, body, options = {}) {
      const bytes = await new Response(body).arrayBuffer();
      objects.set(key, bytes);
      const headers = options.httpMetadata;
      const httpMetadata =
        headers instanceof Headers
          ? { contentType: headers.get('content-type') ?? undefined }
          : headers;
      const etag = createHash('md5')
        .update(new Uint8Array(bytes))
        .digest('hex');
      objectMetadata.set(key, httpMetadata);
      objectEtags.set(key, etag);
      return { key, size: bytes.byteLength, etag, httpMetadata };
    },
    async get(key) {
      const bytes = objects.get(key);
      if (!bytes) return null;
      return {
        key,
        size: bytes.byteLength,
        etag: objectEtags.get(key),
        httpMetadata: objectMetadata.get(key),
        body: new Response(bytes).body,
        async text() {
          return new TextDecoder().decode(bytes);
        },
        async arrayBuffer() {
          return bytes;
        },
      };
    },
    async delete(key) {
      objects.delete(key);
      objectMetadata.delete(key);
      objectEtags.delete(key);
    },
  },
};
