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
import { describeFlowTransfer } from '../lib/file-transfer-contract';
import { hashPassword } from '../lib/password-crypto';
import { PORTAL_OWNER_EMAIL } from '../lib/member-email';
import { provisionStandaloneAdmin } from '../lib/standalone-admin-store';
import type { ConsultingFlow } from '../lib/consulting-flow';

register('./supabase-auth-loader.mjs', import.meta.url);
const { createSupabaseTransferHandler } =
  await import('../lib/supabase-file-transfer');
const { loginPassword } = await import('../lib/password-handlers');
const { writePortalState, mutatePortalState } =
  await import('../lib/portal-state');
const { readFlow } = await import('../lib/consulting-flow-store');
const { GET: getFlow, POST: postFlow } =
  await import('../app/api/consulting-flow/[caseId]/route');
const { GET: download } =
  await import('../app/api/consulting-flow/[caseId]/files/[fileId]/route');
const origin = 'https://flow-races.example.test';
const sha = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
type Result = {
  id: string;
  uploads: Record<
    string,
    { url: string; method: 'PUT'; headers: Record<string, string> }
  >;
  flow: ConsultingFlow;
  duplicate?: boolean;
  error?: string;
};
async function body(response: Response, expected = 200) {
  assert.equal(response.status, expected, await response.clone().text());
  return response.json() as Promise<Result>;
}

void test(
  'independent PostgreSQL FLOW attachments keep exact commands, paired files and revoked access safe',
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
      id: 'flow-race-partner',
      name: '가상담당',
      email: 'flow-race@example.invalid',
      status: '활성',
      permissions: {
        ownCases: true,
        fileUpload: true,
        collaborationApply: true,
        sharedSchedule: true,
        quoteContract: true,
      },
    };
    const cases = ['same', 'different', 'paired'].map(
      (suffix) => `case-draft-native-flow-${suffix}`,
    );
    await writePortalState({
      version: 1,
      consultationNumber: 0,
      members: [member],
      cases: cases.map((id) => ({
        id,
        company: '가상기업',
        trainee: member.name,
        partnerMemberId: member.id,
        service: '정책자금',
      })),
      companyDocuments: [],
      timeline: [],
      tasks: [],
      schedule: [],
    });
    const password = 'Synthetic independent FLOW password!';
    await provisionStandaloneAdmin(a.db, {
      email: PORTAL_OWNER_EMAIL,
      password,
      deployment: 'remote',
    });
    await a.db
      .prepare(
        'INSERT INTO portal_password_accounts VALUES (?1,?2,?3,?4,?5,?5)',
      )
      .bind(
        member.id,
        member.email,
        hashPassword(password),
        'flow-race-credential',
        new Date().toISOString(),
      )
      .run();
    const request = (
      value: unknown,
      cookie = '',
      path = '/api/blob-transfers',
    ) =>
      new Request(origin + path, {
        method: 'POST',
        headers: { origin, cookie, 'content-type': 'application/json' },
        body: JSON.stringify(value),
      });
    async function login(email: string) {
      const response = await loginPassword(request({ email, password }));
      await body(response);
      return response.headers.get('set-cookie')!.split(';')[0];
    }
    const adminCookie = await login(PORTAL_OWNER_EMAIL),
      partnerCookie = await login(member.email);
    const send = (db: D1Database, value: unknown, cookie = adminCookie) =>
      context.run(db, () => handlers.get(db)!(request(value, cookie)));
    const finish = (db: D1Database, id: string, cookie = adminCookie) =>
      send(db, { action: 'finish', id }, cookie);
    const current = async (caseId: string) =>
      (
        await body(
          await getFlow(
            new Request(`${origin}/api/consulting-flow/${caseId}`, {
              headers: { cookie: adminCookie },
            }),
            { params: Promise.resolve({ caseId }) },
          ),
        )
      ).flow;
    async function command(
      caseId: string,
      value: object,
      cookie = adminCookie,
    ) {
      const flow = await current(caseId);
      return (
        await body(
          await postFlow(
            request(
              {
                commandId: randomUUID(),
                revision: flow.revision,
                command: value,
              },
              cookie,
              `/api/consulting-flow/${caseId}`,
            ),
            { params: Promise.resolve({ caseId }) },
          ),
        )
      ).flow;
    }
    function sourceForm(
      revision: number,
      text = 'Synthetic FLOW source bytes',
    ) {
      const form = new FormData();
      form.set(
        'file',
        new File([text], 'synthetic.txt', { type: 'text/plain' }),
      );
      form.set(
        'payload',
        JSON.stringify({
          commandId: randomUUID(),
          revision,
          command: {
            type: 'save_source',
            fileConsent: true,
            privacyMasked: true,
          },
        }),
      );
      return form;
    }
    async function staged(
      caseId: string,
      form: FormData,
      cookie = adminCookie,
    ) {
      const grant = await body(
        await send(
          a.db,
          {
            action: 'prepare',
            intent: {
              ...(await describeFlowTransfer(caseId, form)),
              payload: form.get('payload'),
            },
          },
          cookie,
        ),
      );
      for (const [slot, value] of form)
        if (value instanceof File) {
          const upload = grant.uploads[slot];
          await body(
            await transport.browserUpload(upload.url, {
              method: upload.method,
              headers: upload.headers,
              body: value,
              credentials: 'omit',
              cache: 'no-store',
              redirect: 'error',
              referrerPolicy: 'no-referrer',
            }),
          );
        }
      return grant;
    }
    const count = (table: string, caseId: string) =>
      a.db
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE case_id = ?1`)
        .bind(caseId)
        .first<number>('n');
    const changeMember = (patch: Partial<typeof member>) =>
      context.run(b.db, () =>
        mutatePortalState((value) => {
          const state = value as { members: (typeof member)[] };
          return {
            ...state,
            members: state.members.map((value) => ({ ...value, ...patch })),
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
          'Previously stored bytes must remain unchanged.',
        );
    }
    async function race(
      table: 'storage_object_heads' | 'consulting_flows',
      first: () => Promise<Response>,
      second: () => Promise<Response>,
    ) {
      let unlock!: () => void, ready!: () => void;
      const release = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      const locked = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const holding = fixture.admin.begin(async (transaction) => {
        await transaction.unsafe(
          `LOCK TABLE partner_hub.${table} IN SHARE MODE`,
        );
        ready();
        await release;
      });
      await locked;
      const pending = Promise.all([first(), second()]);
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
          'Both independent requests must reach real PostgreSQL lock contention.',
        );
      } finally {
        unlock();
        await holding;
      }
      return pending;
    }

    await t.test(
      'same source command contends on storage publication, preserves originals and returns an explicit conflict',
      async (subtest) => {
        const caseId = cases[0],
          grant = await staged(caseId, sourceForm(0));
        const put = transport.storage.put.bind(transport.storage);
        let unknownWrites = 0;
        const lost = subtest.mock.method(
          transport.storage,
          'put',
          async (...args: Parameters<typeof put>) => {
            await put(...args);
            unknownWrites++;
            throw new Error('SYNTHETIC_LOST_STORAGE_RESPONSE');
          },
        );
        assert.equal((await finish(a.db, grant.id)).status, 503);
        assert.equal(
          unknownWrites,
          1,
          'Never replay an unknown physical write automatically.',
        );
        lost.mock.restore();
        const before = originals(),
          codes = fixture.errorCodes.length;
        const responses = await race(
          'storage_object_heads',
          () => finish(a.db, grant.id),
          () => finish(b.db, grant.id),
        );
        assert.ok(fixture.errorCodes.slice(codes).includes('40001'));
        subtest.diagnostic(
          `Concurrent attachment statuses: ${responses.map((value) => value.status).join(',')}`,
        );
        const saved = await body(
          responses.find((value) => value.status === 200)!,
        );
        const retained = originals();
        const replay = await body(await finish(b.db, grant.id));
        assert.equal(replay.duplicate, true);
        assert.equal(replay.flow.revision, saved.flow.revision);
        assert.deepEqual(replay.flow.files, saved.flow.files);
        assert.equal(replay.flow.revision, 1);
        assert.equal(
          replay.flow.commandIds.length,
          0,
          'The public response redacts internal command IDs.',
        );
        assert.equal((await readFlow(caseId))!.commandIds.length, 1);
        assert.equal(replay.flow.audit.length, 1);
        assert.equal(
          Number(await count('consulting_flow_upload_requests', caseId)),
          1,
        );
        assert.equal(
          Number(await count('consulting_flow_file_owners', caseId)),
          1,
        );
        assert.equal(
          transport.objects.size,
          retained.size,
          'Exact completed replay must not write another physical object.',
        );
        preserved(before);
        preserved(retained);
        assert.deepEqual(
          responses
            .map((value) => value.status)
            .sort((left, right) => left - right),
          [200, 409],
        );
      },
    );

    await t.test(
      'different attachment commands at one revision commit exactly one complete file ledger',
      async () => {
        const caseId = cases[1];
        const first = await staged(
          caseId,
          sourceForm(0, 'Synthetic candidate A'),
        );
        const second = await staged(
          caseId,
          sourceForm(0, 'Synthetic candidate B'),
        );
        const before = originals();
        const responses = await race(
          'consulting_flows',
          () => finish(a.db, first.id),
          () => finish(b.db, second.id),
        );
        assert.deepEqual(
          responses
            .map((value) => value.status)
            .sort((left, right) => left - right),
          [200, 409],
        );
        const winner = await body(
          responses.find((value) => value.status === 200)!,
        );
        const saved = await current(caseId);
        assert.equal(saved.revision, 1);
        assert.deepEqual(saved.files, winner.flow.files);
        assert.equal(
          saved.commandIds.length,
          0,
          'The public response redacts internal command IDs.',
        );
        assert.equal((await readFlow(caseId))!.commandIds.length, 1);
        assert.equal(saved.audit.length, 1);
        assert.equal(
          Number(await count('consulting_flow_file_owners', caseId)),
          1,
        );
        for (const table of [
          'consulting_flow_file_metadata',
          'consulting_flow_file_object_integrity',
          'consulting_flow_file_object_checksums',
          'consulting_flow_upload_completions',
        ])
          assert.equal(
            Number(
              await a.db
                .prepare(`SELECT COUNT(*) AS n FROM ${table} ledger
            JOIN consulting_flow_file_owners owner ON owner.file_id = ledger.file_id
            WHERE owner.case_id = ?1`)
                .bind(caseId)
                .first<number>('n'),
            ),
            1,
          );
        const statuses = (
          await a.db
            .prepare(
              'SELECT status FROM consulting_flow_upload_requests WHERE case_id = ?1 ORDER BY status',
            )
            .bind(caseId)
            .all<{ status: string }>()
        ).results;
        assert.deepEqual(
          statuses.map((row) => row.status),
          ['pending', 'ready'],
        );
        const loser = responses[0].status === 409 ? first : second;
        const retained = originals();
        await body(await finish(a.db, loser.id), 409);
        assert.equal(transport.objects.size, retained.size);
        preserved(before);
        preserved(retained);
      },
    );

    await t.test(
      'revoking upload permission between paired text and audio writes stops the second write and permits exact recovery',
      async (subtest) => {
        const caseId = cases[2];
        const text =
          '합성 상담 자료입니다. 고객의 개인정보나 실제 업무 자료를 포함하지 않습니다. '.repeat(
            50,
          );
        await command(caseId, {
          type: 'save_source',
          sourceText: text,
          privacyMasked: true,
        });
        let flow = await command(caseId, {
          type: 'save_report',
          stage: 1,
          body: text,
        });
        await command(caseId, {
          type: 'confirm_analysis',
          reportId: flow.reports.at(-1)!.id,
        });
        await command(
          caseId,
          { type: 'confirm_analysis', reportId: flow.reports.at(-1)!.id },
          partnerCookie,
        );
        await command(caseId, {
          type: 'book_meeting',
          kind: 'first',
          attendance: 'both',
          startsAt: '2026-01-01T00:00:00.000Z',
          endsAt: '2026-01-01T01:00:00.000Z',
          location: '가상 상담실',
        });
        flow = await command(caseId, {
          type: 'save_report',
          stage: 2,
          body: text,
        });
        const report = new FormData();
        report.set(
          'payload',
          JSON.stringify({
            commandId: randomUUID(),
            revision: flow.revision,
            command: { type: 'save_report', stage: 3, fileConsent: true },
          }),
        );
        report.set(
          'file',
          new File(['%PDF-1.7\nsynthetic report\n%%EOF'], 'synthetic.pdf', {
            type: 'application/pdf',
          }),
        );
        await body(await finish(a.db, (await staged(caseId, report)).id));
        flow = await command(caseId, {
          type: 'complete_meeting',
          meetingId: flow.meetings.at(-1)!.id,
        });
        const form = new FormData(),
          commandId = randomUUID();
        form.set(
          'payload',
          JSON.stringify({
            commandId,
            revision: flow.revision,
            command: {
              type: 'save_recording',
              meetingId: flow.meetings.at(-1)!.id,
              recordingConsent: true,
              privacyMasked: true,
              transcriptReviewed: true,
              transcript: text,
              fileConsent: true,
            },
          }),
        );
        form.set(
          'file',
          new File([text], 'synthetic.txt', { type: 'text/plain' }),
        );
        const audio = new Uint8Array(100);
        audio.set(new TextEncoder().encode('RIFF0000WAVE'));
        form.set(
          'audio',
          new File([audio], 'synthetic.wav', { type: 'audio/wav' }),
        );
        const grant = await staged(caseId, form, partnerCookie),
          before = originals();
        const put = transport.storage.put.bind(transport.storage);
        let writes = 0;
        const revoke = subtest.mock.method(
          transport.storage,
          'put',
          async (...args: Parameters<typeof put>) => {
            const result = await put(...args);
            writes++;
            if (writes === 1)
              await changeMember({
                permissions: { ...member.permissions, fileUpload: false },
              });
            return result;
          },
        );
        try {
          await body(await finish(a.db, grant.id, partnerCookie), 403);
          assert.equal(writes, 1);
          assert.equal((await current(caseId)).revision, flow.revision);
          assert.equal(
            Number(await count('consulting_flow_file_owners', caseId)),
            1,
            'Only the earlier report remains; no partial recording ledger.',
          );
          const pending = (
            await a.db
              .prepare(
                'SELECT file_id, status FROM consulting_flow_upload_requests WHERE case_id = ?1 AND command_id = ?2 ORDER BY slot',
              )
              .bind(caseId, commandId)
              .all<{ file_id: string; status: string }>()
          ).results;
          assert.equal(pending.length, 2);
          assert.deepEqual(
            pending.map((row) => row.status),
            ['pending', 'pending'],
          );
          assert.equal(transport.objects.size, before.size + 1);
          preserved(before);
          revoke.mock.restore();
          await changeMember({ permissions: member.permissions });
          const retained = originals();
          const saved = await body(await finish(b.db, grant.id, partnerCookie));
          assert.equal(saved.flow.revision, flow.revision + 1);
          const recording = saved.flow.recordings.at(-1)!;
          assert.deepEqual(
            new Set([recording.fileId, recording.audioFileId]),
            new Set(pending.map((row) => row.file_id)),
          );
          assert.equal(
            Number(await count('consulting_flow_file_owners', caseId)),
            3,
          );
          const completed = await a.db
            .prepare(
              'SELECT COUNT(*) AS n FROM consulting_flow_upload_completions WHERE command_id = ?1',
            )
            .bind(commandId)
            .first<number>('n');
          assert.equal(Number(completed), 2);
          const finalOriginals = originals();
          const replay = await body(
            await finish(a.db, grant.id, partnerCookie),
          );
          assert.equal(replay.duplicate, true);
          assert.equal(replay.flow.revision, saved.flow.revision);
          assert.equal(transport.objects.size, finalOriginals.size);
          preserved(retained);
          preserved(finalOriginals);
        } finally {
          revoke.mock.restore();
          await changeMember({ permissions: member.permissions });
        }
      },
    );

    await t.test(
      'suspension committed on another session during FLOW download denies body disclosure and keeps the original',
      async () => {
        const caseId = cases[0],
          flow = await current(caseId),
          fileId = flow.files[0].id;
        const before = originals();
        transport.onRead(async (key) => {
          if (key.startsWith('partner-hub/objects/'))
            await changeMember({ status: '정지' });
        });
        try {
          const response = await context.run(a.db, () =>
            download(
              new Request(
                `${origin}/api/consulting-flow/${caseId}/files/${fileId}`,
                { headers: { cookie: partnerCookie } },
              ),
              { params: Promise.resolve({ caseId, fileId }) },
            ),
          );
          const denied = await body(response, 403);
          assert.equal(
            JSON.stringify(denied).includes('Synthetic FLOW source bytes'),
            false,
          );
          assert.equal(transport.objects.size, before.size);
          preserved(before);
        } finally {
          transport.onRead();
          await changeMember({ status: '활성' });
        }
      },
    );
  },
);
