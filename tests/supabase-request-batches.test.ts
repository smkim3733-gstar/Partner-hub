import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  postgresRuntimeFixture,
  postgresTestOrigin as origin,
} from './supabase-runtime-fixture';
import { PORTAL_OWNER_EMAIL } from '../lib/member-email';
import { provisionStandaloneAdmin } from '../lib/standalone-admin-store';
import { flushWaitUntil } from './runtime-mock.mjs';

const {
  writePortalState,
  mutatePortalState,
  readPortalState,
  readPortalLoginStats,
} = await import('../lib/portal-state');
const { stateWithConsultingFlows } =
  await import('../lib/consulting-flow-store');
const { stateWithPortalLoginStats } = await import('../lib/portal-auth');
const { readPortalSaveConflictSummary } =
  await import('../lib/portal-conflict-metrics');
const { readPasswordLinkSummary, recordPasswordLinkMetric } =
  await import('../lib/password-link-metrics');
const { readDuplicateRequestSummary, recordDuplicateRequestMetric } =
  await import('../lib/duplicate-request-metrics');
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
// partner FLOW 14 -> 7 batches. The administrator and partner session lookups
// then shared one batch: partner state 5 -> 4, partner FLOW 7 -> 5. The
// administrator reads after sign-in (FLOW state, login stats and every
// summary) then shared one batch: administrator state 9 -> 3.
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
      4,
      () => getState(request('/api/state', undefined, partner)),
    ],
    [
      'administrator state',
      3,
      () => getState(request('/api/state', undefined, owner)),
    ],
    [
      'partner FLOW',
      5,
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

  // The administrator reads after sign-in ride in one batch, behind every
  // schema guard they need, and answer exactly what the separate reads do.
  await recordDuplicateRequestMetric({
    source: 'flow_command',
    outcome: 'safe_retry',
  });
  await recordPasswordLinkMetric({ issued: 1 });
  const adminStart = f.batches.length;
  const adminResponse = await getState(
    request('/api/state', undefined, owner),
  );
  assert.equal(adminResponse.status, 200);
  const adminBody = (await adminResponse.json()) as Record<string, unknown>;
  await flushWaitUntil();
  const adminBatches = f.batches
    .slice(adminStart)
    .map((batch) => batch.slice(1));
  assert.equal(adminBatches.length, 3);
  const shared = adminBatches[2];
  for (const guard of [
    'assert_consulting_flow_schema',
    'assert_portal_schema',
    'assert_portal_metrics_schema',
  ])
    assert.ok(
      shared.includes(`SELECT partner_hub.${guard}() AS ready`),
      `administrator batch lacks ${guard}`,
    );
  const firstWork = shared.findIndex((sql) => !schemaGuard.test(sql));
  assert.ok(
    shared.slice(firstWork).every((sql) => !schemaGuard.test(sql)),
    'schema guards run before the work they protect',
  );
  for (const table of [
    'consulting_flows',
    'portal_login_stats',
    'portal_password_link_stats',
    'portal_duplicate_request_stats',
    'portal_save_conflict_stats',
    'portal_conflict_recovery_stats',
  ])
    assert.ok(
      shared.some((sql) => sql.includes(`FROM ${table}`)),
      `administrator batch lacks ${table}`,
    );
  const json = (value: unknown) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(
    adminBody.state,
    json(
      stateWithPortalLoginStats(
        await stateWithConsultingFlows(await readPortalState()),
        await readPortalLoginStats(),
      ),
    ),
  );
  assert.deepEqual(
    adminBody.saveConflicts,
    json(await readPortalSaveConflictSummary()),
  );
  assert.deepEqual(
    adminBody.passwordLinks,
    json(await readPasswordLinkSummary()),
  );
  assert.equal((adminBody.passwordLinks as { issued: number }).issued, 1);
  assert.deepEqual(
    adminBody.duplicateRequests,
    json(await readDuplicateRequestSummary()),
  );
  assert.equal(
    (adminBody.duplicateRequests as { totalSafeRetries: number })
      .totalSafeRetries,
    1,
  );
  for (const key of [
    'applicationFunnel',
    'jointAnalysisConfirmation',
    'documentReviewWait',
    'supportRequests',
    'pipelineDropoff',
    'storage',
    'sessionExpiresInSeconds',
  ])
    assert.notEqual(adminBody[key] ?? null, null, key);

  // A failing summary still fails alone: the shared batch falls back to the
  // separate reads, so only the summaries behind the broken metrics schema
  // are unavailable and the rest of the screen loads as before.
  const logged: string[] = [];
  const errorLog = t.mock.method(console, 'error', (message: unknown) => {
    logged.push(String(message));
  });
  await f.engine.exec(
    'ALTER TABLE partner_hub.portal_duplicate_request_stats DISABLE ROW LEVEL SECURITY',
  );
  try {
    const response = await getState(request('/api/state', undefined, owner));
    assert.equal(response.status, 200);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.saveConflicts, null);
    assert.equal(body.duplicateRequests, null);
    assert.deepEqual(body.passwordLinks, adminBody.passwordLinks);
    assert.deepEqual(body.applicationFunnel, adminBody.applicationFunnel);
    assert.deepEqual(body.state, adminBody.state);
    assert.ok(
      logged.includes('Failed to read administrator state in one batch'),
    );
    assert.ok(logged.includes('Failed to read duplicate-request summary'));
  } finally {
    await f.engine.exec(
      'ALTER TABLE partner_hub.portal_duplicate_request_stats ENABLE ROW LEVEL SECURITY',
    );
  }
  // Required reads stay required: without login stats the response fails
  // closed as before instead of loading an incomplete screen.
  await f.engine.exec(
    'ALTER TABLE partner_hub.portal_login_stats RENAME COLUMN login_count TO login_count_unavailable',
  );
  try {
    const response = await getState(request('/api/state', undefined, owner));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: '저장된 운영 데이터를 불러오지 못했습니다.',
    });
  } finally {
    await f.engine.exec(
      'ALTER TABLE partner_hub.portal_login_stats RENAME COLUMN login_count_unavailable TO login_count',
    );
    errorLog.mock.restore();
  }
  assert.equal(
    (await getState(request('/api/state', undefined, owner))).status,
    200,
  );

  // The batched session lookup keeps the same access rules: administrator
  // sessions win, partner sessions still need approval, and unknown or
  // malformed tokens are rejected.
  const access = async (sessionCookie: string) => {
    const response = await getState(
      request('/api/state', undefined, sessionCookie),
    );
    const body = (await response.json()) as {
      currentUser?: { role: string };
    };
    return [response.status, body.currentUser?.role ?? null];
  };
  const cookieName = owner.slice(0, owner.indexOf('='));
  assert.deepEqual(await access(owner), [200, 'admin']);
  assert.deepEqual(await access(partner), [200, 'trainee']);
  assert.deepEqual(await access(`${cookieName}=${'0'.repeat(64)}`), [
    401,
    null,
  ]);
  assert.deepEqual(await access(`${cookieName}=not-a-session`), [401, null]);
  await mutatePortalState((raw) => {
    const state = raw as { members: Array<Record<string, unknown>> };
    return {
      ...state,
      members: state.members.map((member) => ({ ...member, status: '정지' })),
    };
  });
  assert.deepEqual(await access(partner), [403, null]);
  assert.deepEqual(await access(owner), [200, 'admin']);
});
