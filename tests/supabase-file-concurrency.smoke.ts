import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { register } from 'node:module';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { env } from 'cloudflare:workers';
import { nativePostgresFixture } from './native-postgres-fixture.mjs';
import { supabaseStorageHttpFixture } from './supabase-storage-http-fixture';
import { flushWaitUntil } from './runtime-mock.mjs';
import { createSupabaseStorageBucket } from '../lib/supabase-storage-bucket';
import { createSupabaseStorageManifest } from '../lib/supabase-storage-manifest';
import { describeCompanyTransfer } from '../lib/file-transfer-contract';
import { hashPassword } from '../lib/password-crypto';

register('./supabase-auth-loader.mjs', import.meta.url);
const { createSupabaseTransferHandler } =
  await import('../lib/supabase-file-transfer');
const { loginPassword } = await import('../lib/password-handlers');
const { writePortalState, mutatePortalState } =
  await import('../lib/portal-state');
const { GET: download } = await import('../app/api/files/[id]/route');
const origin = 'https://file-races.example.test';
const bytes = new TextEncoder().encode(
  'Synthetic independent-session original\n',
);
const sha = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
type Grant = {
  id: string;
  uploads: Record<
    string,
    { url: string; method: 'PUT'; headers: Record<string, string> }
  >;
};

async function body(response: Response, expected = 200) {
  assert.equal(response.status, expected, await response.clone().text());
  return response.json() as Promise<
    Grant & { file: { id: string }; error?: string }
  >;
}

void test(
  'independent PostgreSQL file requests preserve originals across conflicts and revocation',
  { timeout: 90000 },
  async (t) => {
    const fixture = await nativePostgresFixture();
    t.after(fixture.close);
    const a = await fixture.connection(),
      b = await fixture.connection(),
      observer = await fixture.connection();
    assert.equal(new Set([a.pid, b.pid, observer.pid]).size, 3);
    const context = new AsyncLocalStorage<D1Database>();
    const transport = supabaseStorageHttpFixture();
    const buckets = new Map(
      [a, b].map(({ db }) => [
        db,
        createSupabaseStorageBucket(
          transport.storage,
          createSupabaseStorageManifest(db),
        ),
      ]),
    );
    const handlers = new Map(
      [a, b].map(({ db }) => [
        db,
        createSupabaseTransferHandler(
          db,
          { appOrigin: origin },
          transport.storage,
        ),
      ]),
    );
    const runtime = env as unknown as {
      DB: D1Database;
      AI_SOURCE_FILES: R2Bucket;
    };
    const descriptors = ['DB', 'AI_SOURCE_FILES'].map(
      (key) => [key, Object.getOwnPropertyDescriptor(runtime, key)!] as const,
    );
    Object.defineProperty(runtime, 'DB', {
      configurable: true,
      get: () => context.getStore() ?? a.db,
    });
    Object.defineProperty(runtime, 'AI_SOURCE_FILES', {
      configurable: true,
      get: () => buckets.get(context.getStore() ?? a.db)!,
    });
    const config = {
      PARTNER_HUB_NEXT_BACKEND: 'supabase-v1',
      PARTNER_HUB_BACKEND_ENABLED: '1',
      PARTNER_HUB_LOCAL_STORAGE: '0',
      PARTNER_HUB_APP_ORIGIN: origin,
      SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      SUPABASE_DATABASE_URL:
        'postgresql://postgres.abcdefghijklmnopqrst:synthetic@aws-0-synthetic.pooler.supabase.com:6543/postgres',
      SUPABASE_SECRET_KEY: `sb_secret_${'x'.repeat(32)}`,
      SUPABASE_STORAGE_BUCKET: 'synthetic-private',
    };
    const previous = Object.keys(config).map(
      (key) => [key, process.env[key]] as const,
    );
    Object.assign(process.env, config);
    t.after(async () => {
      await flushWaitUntil();
      for (const [key, descriptor] of descriptors)
        Object.defineProperty(runtime, key, descriptor);
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
    const member = {
      id: 'file-race-partner',
      name: '가상담당',
      email: 'file-race@example.invalid',
      status: '활성',
      permissions: {
        ownCases: true,
        fileUpload: true,
        collaborationApply: true,
        sharedSchedule: true,
        quoteContract: true,
      },
    };
    const caseId = 'case-draft-native-file-race';
    await writePortalState({
      version: 1,
      consultationNumber: 0,
      members: [member],
      cases: [
        {
          id: caseId,
          company: '가상기업',
          trainee: member.name,
          partnerMemberId: member.id,
          service: '정책자금',
        },
      ],
      companyDocuments: [],
      timeline: [],
      tasks: [],
      schedule: [],
    });
    const password = 'Synthetic independent-session password!';
    await a.db
      .prepare(
        'INSERT INTO portal_password_accounts VALUES (?1,?2,?3,?4,?5,?5)',
      )
      .bind(
        member.id,
        member.email,
        hashPassword(password),
        'file-race-credential',
        new Date().toISOString(),
      )
      .run();
    const request = (value: unknown, cookie = '') =>
      new Request(origin + '/api/blob-transfers', {
        method: 'POST',
        headers: { origin, cookie, 'content-type': 'application/json' },
        body: JSON.stringify(value),
      });
    const login = await loginPassword(
      request({ email: member.email, password }),
    );
    await body(login);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const send = (db: D1Database, value: unknown) =>
      context.run(db, () => handlers.get(db)!(request(value, cookie)));
    const finish = (db: D1Database, id: string) =>
      send(db, { action: 'finish', id });
    function form() {
      const result = new FormData();
      result.set(
        'file',
        new File([Uint8Array.from(bytes)], 'synthetic.txt', {
          type: 'text/plain',
        }),
      );
      for (const [key, value] of Object.entries({
        company: '가상기업',
        title: '합성 전송자료',
        category: '기타자료',
        consent: 'confirmed',
        caseId,
      }))
        result.set(key, value);
      return result;
    }
    const prepare = async () =>
      send(a.db, {
        action: 'prepare',
        intent: await describeCompanyTransfer(form(), sha(randomUUID())),
      });
    async function staged() {
      const grant = (await body(await prepare())) as Grant;
      const upload = grant.uploads.file;
      await body(
        await transport.browserUpload(upload.url, {
          method: upload.method,
          headers: upload.headers,
          body: form().get('file') as File,
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
        }),
      );
      return grant;
    }
    const count = (table: string) =>
      a.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<number>('n');
    const changeStatus = (status: string) =>
      context.run(b.db, () =>
        mutatePortalState((current) => {
          const state = current as { members: (typeof member)[] };
          return {
            ...state,
            members: state.members.map((value) => ({ ...value, status })),
          };
        }),
      );
    const originals = () =>
      new Map([...transport.objects].map(([key, value]) => [key, sha(value)]));
    function preserved(before: Map<string, string>) {
      for (const [key, hash] of before)
        assert.equal(
          sha(transport.objects.get(key)!),
          hash,
          'No existing original may be removed or overwritten.',
        );
    }
    async function race(
      table: 'company_file_upload_requests' | 'storage_object_heads',
      id: string,
    ) {
      let unlock!: () => void, ready!: () => void;
      const release = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      const locked = new Promise<void>((resolve) => {
        ready = resolve;
      });
      // SHARE permits authorization reads but holds both independent INSERT transactions.
      const holding = fixture.admin.begin(async (transaction) => {
        await transaction.unsafe(
          `LOCK TABLE partner_hub.${table} IN SHARE MODE`,
        );
        ready();
        await release;
      });
      await locked;
      const pending = Promise.all([finish(a.db, id), finish(b.db, id)]);
      try {
        const deadline = Date.now() + 3500;
        let waiters = 0;
        do {
          const rows = await observer.client.unsafe(
            'SELECT count(*)::integer AS n FROM pg_stat_activity WHERE pid IN ($1,$2) AND wait_event_type=$3',
            [a.pid, b.pid, 'Lock'],
          );
          waiters = Number(rows[0].n);
          if (waiters === 2) break;
          await delay(15);
        } while (Date.now() < deadline);
        assert.equal(
          waiters,
          2,
          'Both file requests must reach real PostgreSQL lock contention.',
        );
      } finally {
        unlock();
        await holding;
      }
      return pending;
    }

    await t.test(
      'simultaneous reservation returns one saved result and a recoverable conflict, with a stable explicit retry',
      async () => {
        const grant = await staged(),
          before = originals();
        const initial = Number(await count('company_file_objects'));
        const errors = fixture.errorCodes.length;
        const responses = await race('company_file_upload_requests', grant.id);
        assert.ok(fixture.errorCodes.slice(errors).includes('40001'));
        const winner = responses.find((response) => response.status === 201)!;
        const saved = await body(winner, 201);
        const replay = await body(await finish(b.db, grant.id), 201);
        assert.equal(replay.file.id, saved.file.id);
        assert.equal(Number(await count('company_file_objects')), initial + 1);
        preserved(before);
        assert.deepEqual(
          responses
            .map((response) => response.status)
            .sort((left, right) => left - right),
          [201, 409],
        );
      },
    );

    await t.test(
      'simultaneous manifest publication retains every physical original and never replays an unknown upload result',
      async (subtest) => {
        const grant = await staged();
        const initial = Number(await count('company_file_objects'));
        const put = transport.storage.put.bind(transport.storage);
        let writes = 0;
        const failed = subtest.mock.method(
          transport.storage,
          'put',
          async (...args: Parameters<typeof put>) => {
            await put(...args);
            writes++;
            throw new Error('SYNTHETIC_UPLOAD_RESPONSE_LOST');
          },
        );
        assert.equal((await finish(a.db, grant.id)).status, 500);
        assert.equal(
          writes,
          1,
          'An unknown external write outcome is not automatically retried.',
        );
        failed.mock.restore();
        const before = originals(),
          versions = Number(await count('storage_object_versions'));
        const errors = fixture.errorCodes.length;
        const responses = await race('storage_object_heads', grant.id);
        assert.ok(fixture.errorCodes.slice(errors).includes('40001'));
        const winner = responses.find((response) => response.status === 201)!;
        const saved = await body(winner, 201);
        const replay = await body(await finish(b.db, grant.id), 201);
        assert.equal(replay.file.id, saved.file.id);
        assert.equal(Number(await count('company_file_objects')), initial + 1);
        assert.equal(
          Number(await count('storage_object_versions')),
          versions + 1,
        );
        assert.equal(
          transport.objects.size,
          before.size + 2,
          'Both contested physical writes are retained; only one manifest is published.',
        );
        preserved(before);
        assert.deepEqual(
          responses
            .map((response) => response.status)
            .sort((left, right) => left - right),
          [201, 409],
        );
      },
    );

    await t.test(
      'suspension on another session while signing exposes no upload capability',
      async () => {
        transport.onSign(async () => {
          await changeStatus('정지');
        });
        const before = originals();
        try {
          const response = await prepare();
          const denied = await body(response, 403);
          assert.equal(denied.uploads, undefined);
          assert.equal(transport.objects.size, before.size);
          preserved(before);
        } finally {
          transport.onSign();
          await changeStatus('활성');
        }
      },
    );

    await t.test(
      'suspension committed during physical upload denies publication of business records and preserves the original',
      async (subtest) => {
        const grant = await staged(),
          before = originals();
        const initial = Number(await count('company_file_objects'));
        const put = transport.storage.put.bind(transport.storage);
        const delayed = subtest.mock.method(
          transport.storage,
          'put',
          async (...args: Parameters<typeof put>) => {
            const result = await put(...args);
            await changeStatus('정지');
            return result;
          },
        );
        try {
          await body(await finish(a.db, grant.id), 403);
          assert.equal(Number(await count('company_file_objects')), initial);
          assert.equal(transport.objects.size, before.size + 1);
          preserved(before);
          delayed.mock.restore();
          await changeStatus('활성');
          const retained = originals();
          await body(await finish(a.db, grant.id), 201);
          assert.equal(
            transport.objects.size,
            retained.size + 1,
            'Explicit retry may publish a new immutable version; the earlier physical original must remain.',
          );
          preserved(retained);
        } finally {
          delayed.mock.restore();
          await changeStatus('활성');
        }
      },
    );

    await t.test(
      'suspension on another session after download I/O prevents disclosure without deleting bytes',
      async () => {
        const grant = await staged();
        const saved = await body(await finish(a.db, grant.id), 201);
        const before = originals();
        transport.onRead(async (key) => {
          if (key.startsWith('partner-hub/objects/'))
            await changeStatus('정지');
        });
        try {
          const response = await context.run(a.db, () =>
            download(
              new Request(`${origin}/api/files/${saved.file.id}`, {
                headers: { cookie },
              }),
              { params: Promise.resolve({ id: saved.file.id }) },
            ),
          );
          const denied = await body(response, 403);
          assert.equal(
            JSON.stringify(denied).includes(new TextDecoder().decode(bytes)),
            false,
          );
          assert.equal(transport.objects.size, before.size);
          preserved(before);
        } finally {
          transport.onRead();
          await changeStatus('활성');
        }
      },
    );

    await t.test(
      'session revocation committed during staging read prevents file commit and preserves staged bytes',
      async () => {
        const grant = await staged(),
          before = originals();
        const initial = Number(await count('company_file_objects'));
        transport.onRead(async (key) => {
          if (key.startsWith('partner-hub/staging/'))
            await b.db
              .prepare(
                'DELETE FROM portal_password_sessions WHERE token_hash = ?1',
              )
              .bind(sha(cookie.split('=')[1]))
              .run();
        });
        try {
          await body(await finish(a.db, grant.id), 401);
          assert.equal(Number(await count('company_file_objects')), initial);
          assert.equal(transport.objects.size, before.size);
          preserved(before);
        } finally {
          transport.onRead();
        }
      },
    );
  },
);
