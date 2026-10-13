import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { register } from 'node:module';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { env } from 'cloudflare:workers';
import { nativePostgresFixture } from './native-postgres-fixture.mjs';
import { emptyApplicationDetails } from '../lib/application-details';
import { hashPassword } from '../lib/password-crypto';
import { newConsultingFlow } from '../lib/consulting-flow';
import { manualFlowCommand } from './supabase-flow-manual-fixture';

register('./supabase-auth-loader.mjs', import.meta.url);
const { writePortalState, readPortalState, mutatePortalState } =
  await import('../lib/portal-state');
const { PUT: saveDraft } = await import('../app/api/application-draft/route');
const { loginPassword } = await import('../lib/password-handlers');
const { commitFlow, readFlow } = await import('../lib/consulting-flow-store');
const origin = 'https://postgres-races.example.test';

void test(
  'independent PostgreSQL sessions preserve concurrent portal and draft writes',
  { timeout: 90000 },
  async (t) => {
    const fixture = await nativePostgresFixture();
    t.after(fixture.close);
    const a = await fixture.connection();
    const b = await fixture.connection();
    const observer = await fixture.connection();
    assert.notEqual(
      a.pid,
      b.pid,
      'The test must use independent server sessions.',
    );
    const runtime = env as unknown as { DB: D1Database };
    const descriptor = Object.getOwnPropertyDescriptor(runtime, 'DB')!;
    const context = new AsyncLocalStorage<D1Database>();
    Object.defineProperty(runtime, 'DB', {
      configurable: true,
      get: () => context.getStore() ?? a.db,
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
    t.after(() => {
      Object.defineProperty(runtime, 'DB', descriptor);
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
    const member = {
      id: 'concurrency-partner',
      name: '가상 담당자',
      email: 'concurrency@example.test',
      status: '활성',
      permissions: {
        collaborationApply: true,
        ownCases: true,
        fileUpload: true,
        quoteContract: false,
        sharedSchedule: true,
      },
    };
    await writePortalState({
      version: 1,
      consultationNumber: 0,
      members: [member],
      cases: [],
      tasks: [],
      timeline: [],
      schedule: [],
      companyDocuments: [],
    });

    async function race<T>(
      table: 'portal_state' | 'application_drafts' | 'consulting_flows',
      first: () => Promise<T>,
      second: () => Promise<T>,
    ) {
      let unlock!: () => void, locked!: () => void;
      const release = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const holding = fixture.admin.begin(async (transaction) => {
        await transaction.unsafe(
          `SELECT * FROM partner_hub.${table} FOR UPDATE`,
        );
        locked();
        await release;
      });
      await ready;
      const pending = Promise.allSettled([
        context.run(a.db, first),
        context.run(b.db, second),
      ]);
      try {
        // A fourth connection observes both writers waiting on the same real row lock.
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
          'Both independent writers must actually contend before release.',
        );
      } finally {
        unlock();
        await holding;
      }
      return pending;
    }

    await t.test(
      'portal CAS retries the losing transaction and preserves both changes',
      async () => {
        const increment = () =>
          mutatePortalState((current) => {
            const state = current as { consultationNumber: number };
            return {
              ...state,
              consultationNumber: state.consultationNumber + 1,
            };
          });
        const results = await race('portal_state', increment, increment);
        t.diagnostic(`PostgreSQL error codes: ${fixture.errorCodes.join(',')}`);
        assert.deepEqual(
          results.map((result) => result.status),
          ['fulfilled', 'fulfilled'],
        );
        const state = (await readPortalState()) as {
          consultationNumber: number;
        };
        assert.equal(state.consultationNumber, 2);
      },
    );

    const password = 'Synthetic concurrent partner password!';
    await a.db
      .prepare(
        'INSERT INTO portal_password_accounts VALUES (?1, ?2, ?3, ?4, ?5, ?5)',
      )
      .bind(
        member.id,
        member.email,
        hashPassword(password),
        'credential-concurrency',
        new Date().toISOString(),
      )
      .run();
    function request(body: unknown, cookie = '') {
      return new Request(`${origin}/api/application-draft`, {
        method: 'PUT',
        headers: {
          origin,
          'content-type': 'application/json',
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      });
    }
    const loggedIn = await loginPassword(
      new Request(`${origin}/api/auth/login`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ email: member.email, password }),
      }),
    );
    assert.equal(loggedIn.status, 200, await loggedIn.clone().text());
    const cookie = loggedIn.headers.get('set-cookie')!.split(';')[0];
    const body = (revision: number, companyName: string) => ({
      revision,
      draftId: 'synthetic-concurrent-draft',
      expectedUserId: `password:${member.id}`,
      draft: {
        companyName,
        applicantName: member.name,
        applicantType: '한기평 컨설턴트',
        partnerMemberId: member.id,
        selectedServices: ['정책자금'],
        details: emptyApplicationDetails(),
        step: 2,
        hasLocalAttachments: false,
      },
    });
    const seeded = await saveDraft(request(body(0, '가상 원본'), cookie));
    assert.equal(seeded.status, 200, await seeded.clone().text());

    await t.test(
      'competing draft edits return one success and one conflict, never a server error',
      async () => {
        const results = await race(
          'application_drafts',
          () => saveDraft(request(body(1, '가상 첫째'), cookie)),
          () => saveDraft(request(body(1, '가상 둘째'), cookie)),
        );
        assert.ok(results.every((result) => result.status === 'fulfilled'));
        const responses = results.map(
          (result) => (result as PromiseFulfilledResult<Response>).value,
        );
        assert.deepEqual(
          responses.map((response) => response.status).sort((a, b) => a - b),
          [200, 409],
        );
        assert.equal(
          await a.db
            .prepare('SELECT revision FROM application_drafts')
            .first('revision'),
          2,
        );
      },
    );

    await t.test(
      'duplicate draft requests and a lost-response retry advance the revision only once',
      async () => {
        const duplicate = body(2, '가상 동일 재시도');
        const results = await race(
          'application_drafts',
          () => saveDraft(request(duplicate, cookie)),
          () => saveDraft(request(duplicate, cookie)),
        );
        assert.ok(results.every((result) => result.status === 'fulfilled'));
        const responses = results.map(
          (result) => (result as PromiseFulfilledResult<Response>).value,
        );
        assert.deepEqual(
          responses.map((response) => response.status).sort((a, b) => a - b),
          [200, 409],
        );
        const retry = await saveDraft(request(duplicate, cookie));
        assert.equal(retry.status, 200);
        assert.equal(
          ((await retry.json()) as { revision: number }).revision,
          3,
        );
        assert.equal(
          await a.db
            .prepare('SELECT revision FROM application_drafts')
            .first('revision'),
          3,
        );
      },
    );

    await t.test(
      'portal retries regenerate paired effects without committing either effect twice',
      async () => {
        await fixture.admin.unsafe(
          'CREATE TABLE partner_hub.synthetic_effects (id text PRIMARY KEY, revision integer NOT NULL)',
        );
        const change = (id: string) =>
          mutatePortalState(
            (raw) => {
              const state = raw as { consultationNumber: number };
              return {
                ...state,
                consultationNumber: state.consultationNumber + 1,
              };
            },
            undefined,
            (db, payload) => [
              db
                .prepare(
                  'INSERT INTO synthetic_effects SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM portal_state WHERE payload = ?3)',
                )
                .bind(id, JSON.parse(payload).consultationNumber, payload),
            ],
          );
        const results = await race(
          'portal_state',
          () => change('effect-a'),
          () => change('effect-b'),
        );
        assert.deepEqual(
          results.map((result) => result.status),
          ['fulfilled', 'fulfilled'],
        );
        const rows = await a.db
          .prepare('SELECT revision FROM synthetic_effects ORDER BY revision')
          .all();
        assert.deepEqual(rows.results, [{ revision: 3 }, { revision: 4 }]);
        assert.equal(
          ((await readPortalState()) as { consultationNumber: number })
            .consultationNumber,
          4,
        );
      },
    );

    await t.test(
      'FLOW competing edits preserve one command and reject the stale transition with 409',
      async () => {
        const actor = {
          id: 'synthetic-admin',
          role: 'admin' as const,
          name: '김성민 대표',
        };
        const source =
          '실제 고객 자료가 없는 로컬 동시 저장 검증입니다. '.repeat(12);
        const initial = newConsultingFlow(
          'native-race-flow',
          '가상기업',
          member.id,
          member.name,
        );
        const seeded = manualFlowCommand(
          initial,
          { type: 'save_source', sourceText: source, privacyMasked: true },
          actor,
          'initial-source',
        );
        await commitFlow(seeded.previous, seeded.proposed);
        const proposals = ['source-a', 'source-b'].map((id) =>
          manualFlowCommand(
            seeded.proposed,
            {
              type: 'save_source',
              sourceText: `${source}${id}`,
              privacyMasked: true,
            },
            actor,
            id,
          ),
        );
        const results = await race(
          'consulting_flows',
          () => commitFlow(proposals[0].previous, proposals[0].proposed),
          () => commitFlow(proposals[1].previous, proposals[1].proposed),
        );
        assert.deepEqual(results.map((result) => result.status).sort(), [
          'fulfilled',
          'rejected',
        ]);
        assert.equal(
          (
            results.find(
              (result) => result.status === 'rejected',
            ) as PromiseRejectedResult
          ).reason.status,
          409,
        );
        const winner = results.findIndex(
          (result) => result.status === 'fulfilled',
        );
        assert.deepEqual(
          await readFlow(initial.caseId),
          proposals[winner].proposed,
        );
      },
    );
  },
);
