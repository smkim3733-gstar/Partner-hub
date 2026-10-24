import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import {
  createStagingStorage,
  runSupabaseStagingCleanup,
  supabaseStagingCleanupLimits,
} from '../scripts/supabase-staging-cleanup.mjs';
import { postgresFixture } from './supabase-postgres-fixture';

// Real in-memory PostgreSQL with the production migrations, plus a synthetic
// Storage API. No credentials, remote calls or filesystem data.
const config = {
  supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
  secretKey: 'sb_secret_synthetic_cleanup_never_a_real_key',
  storageBucket: 'synthetic-private',
};
const now = Date.parse('2026-10-24T00:00:00.000Z');
const minute = 60_000;
const staging = (id = randomUUID()) => `partner-hub/staging/v1/${id}`;
const iso = (ms: number) => new Date(ms).toISOString();

type StoredObject = { id: string; created: number; updated: number };
function storageFixture() {
  const objects = new Map<string, StoredObject>();
  const bucket: Record<string, unknown> = {
    id: config.storageBucket,
    public: false,
  };
  const calls: { method: string; path: string }[] = [];
  const stuck = new Set<string>();
  let listPrefix: string | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.origin, config.supabaseUrl);
    assert.equal(new Headers(init?.headers).get('apikey'), config.secretKey);
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.credentials, 'omit');
    const path = url.pathname.slice('/storage/v1'.length);
    const method = init?.method ?? 'GET';
    calls.push({ method, path });
    if (path === `/bucket/${config.storageBucket}`)
      return Response.json(bucket);
    if (path === `/object/list/${config.storageBucket}`) {
      assert.equal(method, 'POST');
      const body = JSON.parse(init?.body as string);
      listPrefix = body.prefix;
      const names = [...objects.keys()]
        .filter((key) => key.startsWith(`${body.prefix}/`))
        .map((key) => key.slice(body.prefix.length + 1))
        .sort();
      return Response.json(
        names.slice(body.offset, body.offset + body.limit).map((name) => {
          const value = objects.get(`${body.prefix}/${name}`)!;
          return name.includes('/')
            ? {
                name: name.split('/')[0],
                id: null,
                created_at: null,
                updated_at: null,
                last_accessed_at: null,
                metadata: null,
              }
            : {
                name,
                id: value.id,
                created_at: iso(value.created),
                updated_at: iso(value.updated),
                last_accessed_at: iso(value.updated),
                metadata: {
                  size: 4,
                  eTag: '"synthetic"',
                  mimetype: 'application/octet-stream',
                },
              };
        }),
      );
    }
    const info = `/object/info/authenticated/${config.storageBucket}/`;
    if (path.startsWith(info)) {
      const key = path.slice(info.length);
      const value = objects.get(key);
      if (!value)
        return Response.json(
          { code: 'NoSuchKey', message: 'Object not found' },
          { status: 404 },
        );
      return Response.json({
        id: value.id,
        name: key,
        bucket_id: config.storageBucket,
        size: 4,
        etag: '"synthetic"',
        content_type: 'application/octet-stream',
        last_modified: iso(value.updated),
      });
    }
    const remove = `/object/${config.storageBucket}/`;
    if (method === 'DELETE' && path.startsWith(remove)) {
      const key = path.slice(remove.length);
      assert.ok(key.startsWith('partner-hub/staging/v1/'));
      if (!stuck.has(key)) objects.delete(key);
      return Response.json({ message: 'Successfully deleted' });
    }
    throw new Error(`unexpected synthetic Storage call ${method} ${path}`);
  };
  const put = (path: string, written: number, updated = written) =>
    objects.set(path, { id: randomUUID(), created: written, updated });
  return {
    objects,
    bucket,
    calls,
    stuck,
    put,
    fetcher,
    listPrefix: () => listPrefix,
    storage: createStagingStorage(config, fetcher),
  };
}

async function ledgerFixture(t: TestContext) {
  const fixture = await postgresFixture();
  t.after(() => fixture.close());
  const client = {
    async unsafe(query: string, values: unknown[] = []) {
      return (
        await fixture.engine.query<Record<string, unknown>>(query, values)
      ).rows;
    },
  };
  // Inserts one reservation exactly as the transfer handler would. Returns
  // its retain_until so tests can place object writes inside the window.
  async function reserve(
    createdAt: number,
    paths: { file?: string; audio?: string },
  ) {
    const flow = paths.audio !== undefined;
    const intent = flow
      ? {
          kind: 'flow-upload',
          files: {
            ...(paths.file ? { file: {} } : {}),
            audio: {},
          },
        }
      : { kind: 'company-upload', file: {} };
    await fixture.engine.query(
      `INSERT INTO partner_hub.supabase_file_transfers
      (id,user_id,session_hash,intent,payload,file_path,audio_path,created_at,expires_at,retain_until)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        randomUUID(),
        'synthetic-partner',
        'a'.repeat(64),
        JSON.stringify(intent),
        flow ? '{}' : null,
        paths.file ?? null,
        paths.audio ?? null,
        createdAt,
        createdAt + 600_000,
        createdAt + 7_980_000,
      ],
    );
    return createdAt + 7_980_000;
  }
  const rowCount = async () =>
    Number(
      (
        await fixture.engine.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM partner_hub.supabase_file_transfers',
        )
      ).rows[0].count,
    );
  return { client, reserve, rowCount };
}

const run = (
  client: Awaited<ReturnType<typeof ledgerFixture>>['client'],
  storage: ReturnType<typeof storageFixture>['storage'],
  apply: boolean,
  limits = {},
) =>
  runSupabaseStagingCleanup({
    client,
    storage,
    apply,
    now: () => now,
    limits,
  });

void test('staging check classifies objects without deleting anything', async (t) => {
  const { client, reserve, rowCount } = await ledgerFixture(t);
  const store = storageFixture();
  const expiredFile = staging(),
    expiredAudio = staging(),
    retainedFile = staging(),
    graceFile = staging(),
    anomalousFile = staging(),
    unrecordedFile = staging();
  // Retention ended 47 minutes ago (beyond the 15-minute grace).
  const old = await reserve(now - 180 * minute, {
    file: expiredFile,
    audio: expiredAudio,
  });
  store.put(expiredFile, old - 120 * minute);
  store.put(expiredAudio, old - 119 * minute);
  // Still inside its upload signature window.
  store.put(retainedFile, now - 59 * minute);
  await reserve(now - 60 * minute, { file: retainedFile });
  // Retention ended 10 minutes ago: still inside the cleanup grace.
  const recent = await reserve(now - 10 * minute - 7_980_000, {
    file: graceFile,
  });
  store.put(graceFile, recent - 120 * minute);
  // Written after every signature expired: not this app's upload.
  const late = await reserve(now - 240 * minute, { file: anomalousFile });
  store.put(anomalousFile, late - 120 * minute, late + minute);
  store.put(unrecordedFile, now - 600 * minute);
  store.put('partner-hub/staging/v1/not-a-uuid', now - 600 * minute);
  // Final originals live under another prefix and are never listed.
  store.put(`partner-hub/objects/v1/${randomUUID()}`, now - 600 * minute);

  const report = await run(client, store.storage, false);
  assert.deepEqual(report, {
    scanned: 7,
    expired: 2,
    retained: 2,
    unrecorded: 1,
    anomalous: 1,
    unrecognized: 1,
    truncated: false,
    deleted: 0,
    alreadyAbsent: 0,
    remaining: 2,
  });
  assert.equal(store.listPrefix(), 'partner-hub/staging/v1');
  assert.equal(store.objects.size, 8);
  assert.ok(store.calls.every((call) => call.method !== 'DELETE'));
  assert.equal(await rowCount(), 4);
});

void test('staging cleanup removes only expired recorded objects, once', async (t) => {
  const { client, reserve, rowCount } = await ledgerFixture(t);
  const store = storageFixture();
  const expired = staging(),
    retained = staging(),
    unrecorded = staging();
  const final = `partner-hub/objects/v1/${randomUUID()}`;
  const old = await reserve(now - 180 * minute, { file: expired });
  store.put(expired, old - 120 * minute);
  await reserve(now - 30 * minute, { file: retained });
  store.put(retained, now - 29 * minute);
  store.put(unrecorded, now - 600 * minute);
  store.put(final, now - 600 * minute);

  const first = await run(client, store.storage, true);
  assert.equal(first.deleted, 1);
  assert.equal(first.remaining, 0);
  assert.deepEqual(
    [...store.objects.keys()].sort(),
    [final, retained, unrecorded].sort(),
  );
  const deletes = store.calls.filter((call) => call.method === 'DELETE');
  assert.deepEqual(
    deletes.map((call) => call.path),
    [`/object/${config.storageBucket}/${expired}`],
  );
  // The immutable reservation ledger is kept.
  assert.equal(await rowCount(), 2);

  const second = await run(client, store.storage, true);
  assert.equal(second.expired, 0);
  assert.equal(second.deleted, 0);
  assert.equal(
    store.calls.filter((call) => call.method === 'DELETE').length,
    1,
  );
});

void test('staging cleanup deletes one bounded batch and reports the rest', async (t) => {
  const { client, reserve } = await ledgerFixture(t);
  const store = storageFixture();
  const old = now - 300 * minute;
  for (let index = 0; index < 5; index++) {
    const path = staging();
    await reserve(old + index, { file: path });
    store.put(path, old + index + minute);
  }
  const report = await run(client, store.storage, true, {
    maxDeletes: 2,
    pageSize: 2,
  });
  assert.equal(report.scanned, 5);
  assert.equal(report.expired, 5);
  assert.equal(report.deleted, 2);
  assert.equal(report.remaining, 3);
  assert.equal(store.objects.size, 3);
});

void test('staging cleanup stops when deletion cannot be confirmed', async (t) => {
  const { client, reserve } = await ledgerFixture(t);
  const store = storageFixture();
  const first = staging(),
    second = staging();
  const old = now - 300 * minute;
  await reserve(old, { file: first });
  await reserve(old + 1, { file: second });
  store.put(first, old + minute);
  store.put(second, old + minute);
  const [stuck] = [first, second].sort();
  store.stuck.add(stuck);
  await assert.rejects(run(client, store.storage, true), {
    code: 'staging-delete-unconfirmed',
  });
  // No retry, and nothing after the uncertain object is attempted.
  assert.equal(
    store.calls.filter((call) => call.method === 'DELETE').length,
    1,
  );
  assert.equal(store.objects.size, 2);
});

void test('staging cleanup counts objects removed between scan and delete', async (t) => {
  const { client, reserve } = await ledgerFixture(t);
  const store = storageFixture();
  const path = staging();
  const old = now - 300 * minute;
  await reserve(old, { file: path });
  store.put(path, old + minute);
  const storage = {
    ...store.storage,
    async listPage(offset: number) {
      const page = await store.storage.listPage(offset);
      if (page.length) store.objects.delete(path);
      return page;
    },
  };
  const report = await run(client, storage, true);
  assert.equal(report.alreadyAbsent, 1);
  assert.equal(report.deleted, 0);
  assert.ok(store.calls.every((call) => call.method !== 'DELETE'));
});

void test('staging cleanup fails closed on unsafe buckets and inventories', async (t) => {
  const { client, reserve } = await ledgerFixture(t);
  const store = storageFixture();
  const path = staging();
  const old = await reserve(now - 300 * minute, { file: path });
  store.put(path, old - 120 * minute);

  store.bucket.public = true;
  await assert.rejects(run(client, store.storage, true), {
    code: 'staging-bucket-unsafe',
  });
  assert.ok(
    store.calls.every((call) => !call.path.startsWith('/object/')),
    'no listing or deletion after an unsafe bucket',
  );
  store.bucket.public = false;

  // A nested folder means something else writes under this prefix.
  store.put(`partner-hub/staging/v1/folder/${randomUUID()}`, old);
  await assert.rejects(run(client, store.storage, true), {
    code: 'staging-inventory-unexpected',
  });
  assert.ok(store.objects.has(path));
  assert.ok(store.calls.every((call) => call.method !== 'DELETE'));
});

void test('staging cleanup redacts ledger failures and rejects unsafe limits', async (t) => {
  const store = storageFixture();
  store.put(staging(), now - 600 * minute);
  const broken = {
    async unsafe() {
      throw new Error('relation does not exist: secret detail');
    },
  };
  await assert.rejects(
    runSupabaseStagingCleanup({
      client: broken,
      storage: store.storage,
      now: () => now,
    }),
    (error: Error & { code?: string }) =>
      error.code === 'staging-storage-failed' &&
      !error.message.includes('secret'),
  );
  const { client } = await ledgerFixture(t);
  for (const limits of [
    { graceMs: supabaseStagingCleanupLimits.graceMs - 1 },
    { maxDeletes: supabaseStagingCleanupLimits.maxDeletes + 1 },
    { unknown: 1 },
  ])
    await assert.rejects(run(client, store.storage, true, limits), {
      code: 'staging-config-invalid',
    });
  assert.throws(() => createStagingStorage({ ...config, secretKey: 'plain' }), {
    code: 'staging-config-invalid',
  });
});
