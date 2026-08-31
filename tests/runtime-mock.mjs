import { DatabaseSync } from 'node:sqlite';
const sqlite = new DatabaseSync(':memory:');
export const objects = new Map();
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
    const result = sqlite.prepare(this.sql).run(...this.args());
    return { success: true, meta: { changes: Number(result.changes) } };
  }
  async run() { return this.runSync(); }
  async first() {
    return sqlite.prepare(this.sql).get(...this.args()) ?? null;
  }
  async all() {
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
      sqlite.exec('BEGIN');
      try {
        const results = items.map(item => item.runSync());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  },
  AI_SOURCE_FILES: {
    async put(key, body) {
      const bytes = await new Response(body).arrayBuffer();
      objects.set(key, bytes);
      return {};
    },
    async get(key) {
      const bytes = objects.get(key);
      if (!bytes) return null;
      return {
        size: bytes.byteLength,
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
    },
  },
};
