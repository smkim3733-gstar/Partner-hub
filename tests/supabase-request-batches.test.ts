import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  postgresRuntimeFixture,
  postgresTestOrigin as origin,
} from './supabase-runtime-fixture';
import { PORTAL_OWNER_EMAIL } from '../lib/member-email';
import { provisionStandaloneAdmin } from '../lib/standalone-admin-store';
import { flushWaitUntil } from './runtime-mock.mjs';

const { writePortalState, mutatePortalState } =
  await import('../lib/portal-state');
const { loginPassword, registerPassword } =
  await import('../lib/password-handlers');
const { GET: getState } = await import('../app/api/state/route');
const { GET: getFlow } =
  await import('../app/api/consulting-flow/[caseId]/route');

function request(path: string, body?: unknown, cookie = '') {
  return new Request(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      origin,
      ...(cookie ? { cookie } : {}),
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const schemaGuard = /^SELECT partner_hub\.assert_[a-z_]+\(\) AS ready$/;

// Each adapter batch is one PostgreSQL transaction and at least one network
// round trip to Supavisor. Schema guards must ride along with real work.
// Measured on 2026-10-26: partner state 10 -> 5, administrator state 18 -> 9,
// partner FLOW 14 -> 7 batches.
void test('signed-in Supabase requests spend no transaction on schema guards alone', async (t) => {
  const f = await postgresRuntimeFixture(t, { flowRoot: true });
  await writePortalState({
    version: 1,
    consultationNumber: 0,
    membersRevision: 0,
    members: [],
    timeline: [],
    tasks: [],
    schedule: [],
    cases: [],
    companyDocuments: [],
  });
  const password = 'Synthetic batch counting password!';
  await provisionStandaloneAdmin(f.db, {
    email: PORTAL_OWNER_EMAIL,
    password,
    deployment: 'remote',
  });
  const cookie = async (email: string) =>
    (await loginPassword(request('/api/auth/login', { email, password })))
      .headers.get('set-cookie')!
      .split(';')[0];
  const owner = await cookie(PORTAL_OWNER_EMAIL);
  const email = 'batch-partner@example.invalid';
  await registerPassword(
    request('/api/auth/register', {
      name: '가상담당',
      phone: '010-0000-0000',
      affiliation: '가상',
      email,
      password,
      consent: true,
    }),
  );
  await mutatePortalState((raw) => {
    const state = raw as { members: Array<Record<string, unknown>> };
    return {
      ...state,
      members: state.members.map((member) => ({
        ...member,
        status: '활성',
        permissions: {
          ownCases: true,
          fileUpload: true,
          sharedSchedule: true,
          quoteContract: true,
          collaborationApply: true,
        },
      })),
      cases: [
        {
          id: 'batch-case',
          company: '가상기업',
          trainee: '가상담당',
          partnerMemberId: state.members[0].id,
          stage: '접수',
          consultationCount: 0,
        },
      ],
    };
  });
  const partner = await cookie(email);
  await flushWaitUntil();
  const context = { params: Promise.resolve({ caseId: 'batch-case' }) };
  for (const [label, limit, run] of [
    [
      'partner state',
      5,
      () => getState(request('/api/state', undefined, partner)),
    ],
    [
      'administrator state',
      9,
      () => getState(request('/api/state', undefined, owner)),
    ],
    [
      'partner FLOW',
      7,
      () =>
        getFlow(
          request('/api/consulting-flow/batch-case', undefined, partner),
          context,
        ),
    ],
  ] as const) {
    const start = f.batches.length;
    const response = await run();
    assert.equal(response.status, 200, await response.clone().text());
    await response.text();
    await flushWaitUntil();
    const batches = f.batches.slice(start).map((batch) => batch.slice(1));
    assert.ok(
      batches.length <= limit,
      `${label}: ${batches.length} batches (limit ${limit})`,
    );
    for (const statements of batches)
      assert.ok(
        statements.some((sql) => !schemaGuard.test(sql)),
        `${label}: a transaction ran only schema guards`,
      );
  }
});
