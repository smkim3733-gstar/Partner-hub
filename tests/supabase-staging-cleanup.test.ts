import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  cleanupLimits,
  cleanupSnapshot,
  cleanupConfirmation,
  planStagingCleanup,
  validateCleanupPlan,
  applyStagingCleanup,
} from '../scripts/supabase-staging-cleanup-policy.mjs';
import {
  cleanupSettings,
  createCleanupStorage,
  cleanupDatabase,
  readCleanupSnapshot,
} from '../scripts/supabase-staging-cleanup-runtime.mjs';
import {
  cleanupArguments,
  cleanupJournal,
  reconcileStagingCleanup,
} from '../scripts/supabase-staging-cleanup.mjs';

const target = {
  projectRef: 'abcdefghijklmnopqrst',
  bucket: 'partner-hub-private',
};
const created = 1_760_000_000_000;
const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const stage = (n: number) => `partner-hub/staging/v1/${id(n)}`;
function row(n = 1) {
  return {
    id: id(n + 100),
    file_path: stage(n) as string | null,
    audio_path: null as string | null,
    created_at: created,
    expires_at: created + 600_000,
    retain_until: created + 7_980_000,
  };
}
type Metadata = {
  path: string;
  versionId: string | null;
  etag: string;
  size: number;
  modifiedAt: number;
};
function metadata(n = 1): Metadata {
  return {
    path: stage(n),
    versionId: id(n + 200),
    etag: '"synthetic"',
    size: 40,
    modifiedAt: created + 1000,
  };
}
function fixture(rows = [row()]) {
  const snapshot = { target, now: created + 8_000_000, rows };
  const objects = new Map(
    rows
      .flatMap((r) =>
        [r.file_path, r.audio_path].filter((p): p is string => p !== null),
      )
      .map((p) => [p, { ...metadata(), path: p }]),
  );
  const calls: { kind: string; path?: string; version?: string | null }[] = [];
  const events: Record<string, unknown>[] = [];
  let used = false;
  const storage = {
    async assertPrivate() {
      calls.push({ kind: 'private' });
    },
    async info(p: string, version: string | null = null) {
      calls.push({ kind: 'info', path: p, version });
      const item = objects.get(p);
      return item && (version === null || item.versionId === version)
        ? { ...item }
        : null;
    },
    async removeVersion(p: string, version: string) {
      calls.push({ kind: 'remove', path: p, version });
      if (objects.get(p)?.versionId === version) objects.delete(p);
    },
  };
  const journal = {
    async start(hash: string) {
      if (used) throw new Error('CLEANUP_PLAN_ALREADY_USED');
      used = true;
      events.push({ state: 'started', hash });
    },
    async record(event: Record<string, unknown>) {
      events.push(event);
    },
  };
  const dependencies = {
    storage,
    journal,
    withLock: async (
      run: (readSnapshot: () => Promise<typeof snapshot>) => Promise<unknown>,
    ) => run(async () => structuredClone(snapshot)),
  };
  return {
    snapshot,
    objects,
    calls,
    events,
    storage,
    journal,
    dependencies,
    removed: () => calls.filter((c) => c.kind === 'remove'),
  };
}
async function ready(rows = [row()]) {
  const f = fixture(rows),
    plan = await planStagingCleanup(f.snapshot, f.storage);
  return {
    ...f,
    plan,
    apply: (signal?: AbortSignal) =>
      applyStagingCleanup(plan, f.dependencies, {
        confirmation: cleanupConfirmation(plan),
        signal,
      }),
  };
}

void test('cleanup plan reads only expired staging metadata and preserves final objects', async () => {
  const f = fixture();
  const original = 'partner-hub/objects/v1/untouchable';
  f.objects.set(original, { ...metadata(), path: original });
  const plan = await planStagingCleanup(f.snapshot, f.storage);
  assert.equal(plan.candidates.length, 1);
  assert.equal(f.removed().length, 0);
  assert.equal(
    f.calls.some((c) => c.path === original),
    false,
  );
  assert.deepEqual(validateCleanupPlan(plan), plan);
  assert.doesNotMatch(
    JSON.stringify(plan),
    /user_id|session_hash|payload|intent|secret/,
  );
});

void test('cleanup preserves exact retention boundary and active audio reservations', async () => {
  const f = fixture([
    row(1),
    { ...row(2), file_path: null, audio_path: stage(2) },
  ]);
  f.snapshot.now = row().retain_until;
  const plan = await planStagingCleanup(f.snapshot, f.storage);
  assert.equal(plan.candidates.length, 0);
  assert.equal(plan.counts.unexpired, 2);
  assert.equal(f.calls.filter((c) => c.kind === 'info').length, 0);
});

void test('cleanup detects cross-column duplicates including a still-live reservation', async () => {
  const second = {
    ...row(2),
    file_path: null,
    audio_path: stage(1),
    created_at: created + 7_999_000,
    expires_at: created + 8_599_000,
    retain_until: created + 15_979_000,
  };
  const f = fixture([row(), second]);
  const plan = await planStagingCleanup(f.snapshot, f.storage);
  assert.equal(plan.counts.ambiguous, 1);
  assert.equal(plan.candidates.length, 0);
  assert.equal(f.calls.filter((c) => c.kind === 'info').length, 0);
});

void test('cleanup fails closed for changed retention rules, final paths, duplicate IDs and excess inventory', () => {
  for (const rows of [
    [{ ...row(), retain_until: row().retain_until - 1 }],
    [{ ...row(), file_path: `partner-hub/objects/v1/${id(1)}` }],
    [{ ...row(), file_path: `${stage(1)}/../x` }],
    [row(), row()],
    Array.from({ length: cleanupLimits.rows + 1 }, (_, n) => row(n + 1)),
  ])
    assert.throws(
      () => cleanupSnapshot({ target, now: created + 8_000_000, rows }),
      /CLEANUP_/,
    );
});

void test('cleanup preserves absent, unversioned and late-arriving objects', async () => {
  const f = fixture([row(1), row(2), row(3), row(4)]);
  f.objects.delete(stage(1));
  f.objects.get(stage(2))!.versionId = null;
  f.objects.get(stage(3))!.modifiedAt = row().retain_until + 1;
  f.objects.get(stage(4))!.modifiedAt = created - 1;
  const plan = await planStagingCleanup(f.snapshot, f.storage);
  assert.equal(plan.candidates.length, 0);
  assert.equal(plan.counts.missing, 1);
  assert.equal(plan.counts.unversioned, 1);
  assert.equal(plan.counts.lateObject, 2);
});

void test('cleanup caps one reviewed plan at 20 objects', async () => {
  const f = fixture(Array.from({ length: 25 }, (_, n) => row(n + 1)));
  const plan = await planStagingCleanup(f.snapshot, f.storage);
  assert.equal(plan.candidates.length, 20);
  assert.equal(plan.counts.deferred, 5);
  assert.equal(f.calls.filter((c) => c.kind === 'info').length, 20);
});

void test('cleanup refuses modified plans and requires the exact target/hash confirmation', async () => {
  const f = await ready();
  const modified = structuredClone(f.plan);
  modified.candidates[0].etag = '"different"';
  assert.throws(() => validateCleanupPlan(modified), /PLAN_CHANGED/);
  await assert.rejects(
    applyStagingCleanup(f.plan, f.dependencies, { confirmation: 'yes' }),
    /CONFIRMATION_REQUIRED/,
  );
  assert.equal(f.removed().length, 0);
});

void test('cleanup revalidates every reservation and plan age under the lock', async () => {
  for (const change of [
    'target',
    'new-reservation',
    'clock-forward',
    'clock-backward',
  ]) {
    const f = await ready();
    if (change === 'target') f.snapshot.target = { ...target, bucket: 'other' };
    if (change === 'new-reservation') f.snapshot.rows.push(row(2));
    if (change === 'clock-forward')
      f.snapshot.now += cleanupLimits.planAgeMs + 1;
    if (change === 'clock-backward') f.snapshot.now--;
    await assert.rejects(f.apply(), /RESERVATIONS_CHANGED|PLAN_EXPIRED/);
    assert.equal(f.removed().length, 0, change);
  }
});

void test('cleanup writes intent before exact-version deletion and confirms the outcome', async () => {
  const f = await ready();
  const remove = f.storage.removeVersion.bind(f.storage);
  f.storage.removeVersion = async (p, version) => {
    assert.equal(f.events.at(-1)?.state, 'attempted');
    await remove(p, version);
  };
  const result = await f.apply();
  assert.deepEqual(result, { reviewed: 1, removed: 1, absent: 0, changed: 0 });
  assert.deepEqual(
    f.events.map((e) => e.state),
    ['started', 'attempted', 'removed', 'completed'],
  );
  assert.deepEqual(f.removed(), [
    { kind: 'remove', path: stage(1), version: metadata().versionId },
  ]);
});

void test('cleanup skips changed or already absent objects without deleting replacements', async () => {
  const f = await ready([row(), row(2)]);
  f.objects.get(stage(1))!.versionId = id(999);
  f.objects.delete(stage(2));
  assert.deepEqual(await f.apply(), {
    reviewed: 2,
    removed: 0,
    absent: 1,
    changed: 1,
  });
  assert.equal(f.removed().length, 0);
  assert.equal(f.objects.get(stage(1))!.versionId, id(999));
});

void test('cleanup rejects providers ignoring version queries before issuing a delete', async () => {
  const f = await ready();
  f.storage.info = async () => metadata();
  await assert.rejects(f.apply(), /VERSION_API_UNCONFIRMED/);
  assert.equal(f.removed().length, 0);
});

void test('replacement between metadata verification and deletion survives the version-addressed request', async () => {
  const f = await ready();
  const record = f.journal.record.bind(f.journal);
  f.journal.record = async (event) => {
    await record(event);
    if (event.state === 'attempted')
      f.objects.set(stage(1), {
        ...metadata(),
        versionId: id(999),
        etag: '"new"',
      });
  };
  await f.apply();
  assert.equal(f.removed().length, 1);
  assert.equal(f.objects.get(stage(1))!.versionId, id(999));
});

void test('lost deletion response stops all further objects, never retries and leaves a recoverable journal', async () => {
  const f = await ready([row(), row(2)]);
  const remove = f.storage.removeVersion.bind(f.storage);
  f.storage.removeVersion = async (p, v) => {
    await remove(p, v);
    throw new Error('secret-provider-response');
  };
  await assert.rejects(f.apply(), /^Error: CLEANUP_OUTCOME_UNKNOWN$/);
  assert.equal(f.removed().length, 1);
  assert.equal(f.objects.has(stage(2)), true);
  assert.equal(f.events.at(-1)?.state, 'attempted');
  await assert.rejects(f.apply(), /PLAN_ALREADY_USED/);
  assert.equal(f.removed().length, 1);
  assert.deepEqual(await reconcileStagingCleanup(f.plan, f.storage), {
    reviewed: 2,
    present: 1,
    absent: 1,
  });
  assert.equal(f.removed().length, 1);
});

void test('abort before deletion sends no request; abort during response stops without retry', async () => {
  const before = await ready(),
    controller = new AbortController();
  controller.abort();
  await assert.rejects(before.apply(controller.signal), /INTERRUPTED/);
  assert.equal(before.removed().length, 0);
  const during = await ready([row(), row(2)]),
    mid = new AbortController();
  const remove = during.storage.removeVersion.bind(during.storage);
  during.storage.removeVersion = async (p, v) => {
    await remove(p, v);
    mid.abort();
  };
  await assert.rejects(during.apply(mid.signal), /OUTCOME_UNKNOWN/);
  assert.equal(during.removed().length, 1);
  assert.equal(during.events.at(-1)?.state, 'attempted');
});

void test('journal failure prevents deletion, including restart with the same plan', async () => {
  const f = await ready();
  f.journal.record = async () => {
    throw new Error('disk-full');
  };
  await assert.rejects(f.apply(), /disk-full/);
  assert.equal(f.removed().length, 0);
  await assert.rejects(f.apply(), /PLAN_ALREADY_USED/);
});

void test('a success response without confirmed absence is outcome-unknown', async () => {
  const f = await ready();
  f.storage.removeVersion = async () => {};
  await assert.rejects(f.apply(), /OUTCOME_UNKNOWN/);
  assert.equal(f.events.at(-1)?.state, 'attempted');
});

void test('reviewed plan is insulated from asynchronous caller mutation', async () => {
  const f = await ready();
  const assertPrivate = f.storage.assertPrivate.bind(f.storage);
  f.storage.assertPrivate = async () => {
    f.plan.candidates.length = 0;
    await assertPrivate();
  };
  assert.deepEqual(await f.apply(), {
    reviewed: 1,
    removed: 1,
    absent: 0,
    changed: 0,
  });
});

void test('durable journal never reuses a consumed plan even after a fresh process handle', async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'partner-hub-cleanup-test-'),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journal = cleanupJournal(directory);
  await journal.start('a'.repeat(64));
  await journal.record({
    path: stage(1),
    versionId: id(201),
    state: 'attempted',
  });
  await journal.close();
  const restored = cleanupJournal(directory);
  await assert.rejects(restored.start('a'.repeat(64)), /PLAN_ALREADY_USED/);
  assert.deepEqual(
    (await readFile(path.join(directory, 'execution.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)),
    [
      { state: 'started', hash: 'a'.repeat(64) },
      { path: stage(1), versionId: id(201), state: 'attempted' },
    ],
  );
});

const env = {
  PARTNER_HUB_NEXT_BACKEND: 'supabase-v1',
  SUPABASE_URL: `https://${target.projectRef}.supabase.co`,
  SUPABASE_STORAGE_BUCKET: target.bucket,
  SUPABASE_SECRET_KEY: `sb_secret_${'s'.repeat(32)}`,
  SUPABASE_DATABASE_URL: `postgresql://postgres.${target.projectRef}:synthetic@aws-0-test.pooler.supabase.com:6543/postgres?sslmode=require`,
};
const info = (m = metadata()) => ({
  name: m.path,
  version: m.versionId,
  bucket_id: target.bucket,
  size: m.size,
  etag: m.etag,
  last_modified: new Date(m.modifiedAt).toISOString(),
  content_type: 'application/octet-stream',
});

void test('cleanup configuration requires an exact matching target and a session-pooler connection', () => {
  assert.equal(new URL(cleanupSettings(env).databaseUrl).port, '5432');
  for (const patch of [
    { PARTNER_HUB_NEXT_BACKEND: 'vercel-v1' },
    { SUPABASE_URL: 'https://attacker.invalid' },
    { SUPABASE_STORAGE_BUCKET: '../objects' },
    { SUPABASE_SECRET_KEY: 'public' },
    {
      SUPABASE_DATABASE_URL: env.SUPABASE_DATABASE_URL.replace(
        target.projectRef,
        'zzzzzzzzzzzzzzzzzzzz',
      ),
    },
    {
      SUPABASE_DATABASE_URL: env.SUPABASE_DATABASE_URL.replace(
        'sslmode=require',
        'sslmode=disable',
      ),
    },
  ])
    assert.throws(() => cleanupSettings({ ...env, ...patch }), /CLEANUP_/);
});

void test('HTTP adapter uses metadata and explicit version bodies, with no redirects or customer bytes', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const transport = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    assert.ok(typeof input === 'string');
    const url = input;
    calls.push({ url, init });
    if (url.includes('/bucket/'))
      return Response.json({
        id: target.bucket,
        public: false,
        file_size_limit: 25 * 1024 * 1024,
        allowed_mime_types: ['application/octet-stream'],
      });
    if (init?.method === 'DELETE')
      return Response.json([{ name: stage(1), version: id(201) }]);
    return Response.json(info());
  };
  const storage = createCleanupStorage(cleanupSettings(env), transport);
  await storage.assertPrivate();
  assert.deepEqual(await storage.info(stage(1), id(201)), metadata());
  await storage.removeVersion(stage(1), id(201));
  const deletionBody = calls[2].init?.body;
  assert.ok(typeof deletionBody === 'string');
  assert.deepEqual(JSON.parse(deletionBody), {
    prefixes: [{ path: stage(1), versionId: id(201) }],
  });
  assert.match(calls[1].url, /\/object\/info\/authenticated\/.*\?versionId=/);
  for (const c of calls) {
    assert.equal(c.init?.redirect, 'error');
    assert.equal(c.init?.credentials, 'omit');
  }
  await assert.rejects(
    storage.removeVersion('partner-hub/objects/v1/original', id(201)),
    /INVALID_PATH/,
  );
  assert.equal(calls.length, 3);
});

void test('HTTP adapter distinguishes version absence from auth failures and sanitizes remote errors', async () => {
  for (const code of ['NoSuchKey', 'NoSuchVersion']) {
    const storage = createCleanupStorage(cleanupSettings(env), async () =>
      Response.json({ code }, { status: 404 }),
    );
    assert.equal(await storage.info(stage(1), id(201)), null);
  }
  for (const response of [
    Response.json({ code: 'AccessDenied', message: 'secret' }, { status: 403 }),
    Response.json({ code: 'NoSuchKey' }, { status: 401 }),
    new Response('x'.repeat(65537)),
    Response.json({ ...info(), version: id(999) }),
  ]) {
    const storage = createCleanupStorage(
      cleanupSettings(env),
      async () => response,
    );
    await assert.rejects(
      storage.info(stage(1), id(201)),
      /CLEANUP_(PROVIDER_RESPONSE|VERSION_API_UNCONFIRMED)/,
    );
  }
});

void test('HTTP adapter rejects public/changed bucket contracts and ambiguous delete responses', async () => {
  for (const value of [
    { id: target.bucket, public: true },
    {
      id: target.bucket,
      public: false,
      file_size_limit: 100,
      allowed_mime_types: ['*/*'],
    },
  ]) {
    const storage = createCleanupStorage(cleanupSettings(env), async () =>
      Response.json(value),
    );
    await assert.rejects(storage.assertPrivate(), /BUCKET_UNSAFE/);
  }
  const storage = createCleanupStorage(cleanupSettings(env), async () =>
    Response.json([{ name: stage(1) }]),
  );
  await assert.rejects(
    storage.removeVersion(stage(1), id(201)),
    /OUTCOME_UNKNOWN/,
  );
});

void test('SQL inventory projects reservation metadata only and refuses any business staging reference', async () => {
  const queries: string[] = [];
  const tx = {
    async unsafe(query: string) {
      queries.push(query);
      if (query.includes('clock_timestamp'))
        return [{ now_ms: String(created + 8_000_000) }];
      if (query.includes('supabase_file_transfers'))
        return [{ ...row(), created_at: String(created) }];
      return [{ referenced: false }];
    },
  };
  assert.deepEqual(await readCleanupSnapshot(tx, target), {
    target,
    now: created + 8_000_000,
    rows: [row()],
  });
  assert.doesNotMatch(
    queries.join('\n'),
    /\b(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b|user_id|session_hash|intent|payload/i,
  );
  assert.match(queries[1], /LIMIT 10001/);
  const unsafe = tx.unsafe.bind(tx);
  tx.unsafe = async (query) =>
    query.includes('storage_object_versions')
      ? [{ referenced: true }]
      : unsafe(query);
  await assert.rejects(readCleanupSnapshot(tx, target), /BUSINESS_REFERENCE/);
});

void test('CLI never defaults to apply and requires explicit absolute locations', () => {
  assert.equal(cleanupArguments([]).command, 'help');
  for (const args of [
    ['apply'],
    ['apply', '--plan', 'relative.json'],
    ['plan', '--output-dir', 'relative'],
    ['plan', '--output-dir', path.resolve('work'), '--force'],
    ['delete', '--plan', path.resolve('plan.json')],
  ]) {
    assert.throws(() => cleanupArguments(args), /INVALID_ARGUMENTS/);
  }
});

void test('advisory and table locks precede fresh inventory; concurrent jobs never enter cleanup', async () => {
  const queries: string[] = [],
    modes: string[] = [];
  let busy = false,
    ran = 0;
  const tx = {
    async unsafe(query: string) {
      queries.push(query);
      if (query.includes('pg_try_advisory')) return [{ locked: !busy }];
      if (query.includes('clock_timestamp'))
        return [{ now_ms: created + 8_000_000 }];
      if (query.includes('FROM partner_hub.supabase_file_transfers'))
        return [row()];
      if (
        query.includes('storage_object_versions') &&
        query.startsWith('SELECT')
      )
        return [{ referenced: false }];
      return [];
    },
  };
  // Test adapter only; no network, SQL mutations or real customer records.
  const connect = (() => ({
    begin: async (mode: string, run: (t: typeof tx) => Promise<unknown>) => {
      modes.push(mode);
      return run(tx);
    },
    end: async () => {},
  })) as unknown as Parameters<typeof cleanupDatabase>[1];
  const db = cleanupDatabase(cleanupSettings(env), connect);
  await db.withLock(async (snapshot: () => Promise<unknown>) => {
    ran++;
    await snapshot();
  });
  assert.equal(modes[0], 'isolation level read committed');
  assert.ok(
    queries.findIndex((q) => q.startsWith('LOCK TABLE')) <
      queries.findIndex((q) => q.includes('clock_timestamp')),
  );
  assert.match(
    queries.find((q) => q.startsWith('LOCK TABLE'))!,
    /IN SHARE MODE NOWAIT$/,
  );
  busy = true;
  await assert.rejects(
    db.withLock(async () => {
      ran++;
    }),
    /BUSY/,
  );
  assert.equal(ran, 1);
  await db.close();
});

void test('CLI help stays offline and automated apply is rejected before reading credentials', () => {
  const script = path.resolve('scripts/supabase-staging-cleanup.mjs');
  for (const args of [
    [],
    ['--help'],
    ['apply', '--plan', path.resolve('nonexistent/plan.json')],
    ['unknown'],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
      env: {
        NODE_ENV: 'test',
        SystemRoot: process.env.SystemRoot,
        PATH: process.env.PATH,
      },
    });
    if (args.length === 0 || args[0] === '--help') {
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /No default action, automatic retry/);
    } else {
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.match(
        result.stderr,
        /^CLEANUP_(TTY_REQUIRED|INVALID_ARGUMENTS)\r?\n$/,
      );
    }
  }
});
