import test from 'node:test';
import assert from 'node:assert/strict';
import { GET, PUT } from '../app/api/state/route';
import { writePortalState, readPortalState } from '../lib/portal-state';
import { portalRevision } from '../lib/portal-revision';
import { PortalSaveQueue, putPortalSnapshot } from '../lib/portal-save-queue';
import type { PortalStorageTelemetry } from '../lib/pilot-readiness';
import type { PortalSaveConflictSummary } from '../lib/portal-conflict-metrics';
import { flushWaitUntil } from './runtime-mock.mjs';

const seed = () => ({
  version: 1,
  consultationNumber: 0,
  membersRevision: 0,
  cases: [
    {
      id: 'revision-case',
      company: '가상기업',
      trainee: '대표',
      partnerMemberId: '',
      stage: '접수',
    },
  ],
  tasks: [{ id: 'revision-task', status: '대기' }],
  timeline: [],
  companyDocuments: [],
  members: [],
  schedule: [],
});
function request(state?: unknown, revision?: string) {
  return new Request('http://localhost/api/state', {
    method: state ? 'PUT' : 'GET',
    headers: {
      origin: 'http://localhost',
      'content-type': 'application/json',
      'oai-authenticated-user-id': 'revision-owner',
      'oai-authenticated-user-email': 'smkim3733@gmail.com',
      ...(revision ? { 'if-match': `"${revision}"` } : {}),
    },
    ...(state
      ? { body: JSON.stringify({ state, expectedUserId: 'revision-owner' }) }
      : {}),
  });
}
async function snapshot() {
  return (await (await GET(request())).json()) as {
    state: ReturnType<typeof seed>;
    stateRevision: string;
    storage: PortalStorageTelemetry;
    saveConflicts: PortalSaveConflictSummary | null;
  };
}

void test('state capacity telemetry is exact, top-level, and administrator-only', async () => {
  const state = seed();
  state.members.push({
    id: 'partner-telemetry',
    name: '가상 파트너',
    email: 'partner-telemetry@example.invalid',
    status: '활성',
    permissions: {
      ownCases: true,
      sharedSchedule: true,
      collaborationApply: true,
      fileUpload: true,
      quoteContract: false,
    },
  } as never);
  await writePortalState(state);

  const owner = await snapshot();
  assert.equal(
    owner.storage.storedBytes,
    new TextEncoder().encode(JSON.stringify(state)).byteLength,
  );
  assert.equal(Object.hasOwn(owner.state, 'storage'), false);
  assert.equal(Object.hasOwn(owner.state, 'saveConflicts'), false);

  const partnerResponse = await GET(
    new Request('http://localhost/api/state', {
      headers: {
        'oai-authenticated-user-id': 'partner-telemetry-user',
        'oai-authenticated-user-email': 'partner-telemetry@example.invalid',
      },
    }),
  );
  assert.equal(partnerResponse.status, 200, await partnerResponse.clone().text());
  const partner = (await partnerResponse.json()) as Record<string, unknown>;
  assert.equal(Object.hasOwn(partner, 'storage'), false);
  assert.equal(Object.hasOwn(partner, 'saveConflicts'), false);
  assert.equal(
    Object.hasOwn(partner.state as Record<string, unknown>, 'storage'),
    false,
  );
  assert.equal(
    Object.hasOwn(partner.state as Record<string, unknown>, 'saveConflicts'),
    false,
  );
});

void test('revision ignores key order and login metadata but tracks business content', async () => {
  const a = {
    tasks: [{ id: 'a', status: '대기' }],
    members: [{ id: 'm', loginCount: 1, lastLoginAt: 'before' }],
  };
  const b = {
    members: [{ id: 'm', loginCount: 9, lastLoginAt: 'after' }],
    tasks: [{ status: '대기', id: 'a' }],
  };
  assert.equal(await portalRevision(a), await portalRevision(b));
  b.tasks[0].status = '완료';
  assert.notEqual(await portalRevision(a), await portalRevision(b));
});

void test('stale and versionless writers cannot replace a newer case or task; fresh writes work', async () => {
  await writePortalState(seed());
  const a = await snapshot();
  const b = await snapshot();
  a.state.tasks[0].status = '완료';
  const first = await PUT(request(a.state, a.stateRevision));
  assert.equal(first.status, 200, await first.clone().text());
  b.state.cases[0].stage = '상담진행';
  assert.equal((await PUT(request(b.state, b.stateRevision))).status, 409);
  await flushWaitUntil();
  const conflictSummary = await snapshot();
  assert.ok((conflictSummary.saveConflicts?.total ?? 0) >= 1);
  assert.ok(
    conflictSummary.saveConflicts?.rows.some(
      (row) =>
        row.source === 'state_save' &&
        row.kind === 'state_revision' &&
        row.actorRole === 'admin',
    ),
  );
  assert.equal((await PUT(request(b.state))).status, 409);
  assert.equal(
    ((await readPortalState()) as ReturnType<typeof seed>).tasks[0].status,
    '완료',
  );
  const latest = await snapshot();
  latest.state.cases[0].stage = '상담진행';
  assert.equal(
    (await PUT(request(latest.state, latest.stateRevision))).status,
    200,
  );
  const after = (await readPortalState()) as ReturnType<typeof seed>;
  assert.equal(after.tasks[0].status, '완료');
  assert.equal(after.cases[0].stage, '상담진행');
});

void test('concurrent writers with the same baseline cannot silently overwrite one another', async () => {
  await writePortalState(seed());
  const baseline = await snapshot();
  const a = structuredClone(baseline.state);
  const b = structuredClone(baseline.state);
  a.tasks[0].status = '완료';
  b.tasks[0].status = '진행중';
  const responses = await Promise.all([
    PUT(request(a, baseline.stateRevision)),
    PUT(request(b, baseline.stateRevision)),
  ]);
  assert.deepEqual(
    responses.map((r) => r.status).sort((x, y) => x - y),
    [200, 409],
  );
});

void test('uncertain acknowledgement can be retried with the original revision only when no change results', async () => {
  await writePortalState(seed());
  const baseline = await snapshot();
  baseline.state.tasks[0].status = '완료';
  const first = await PUT(request(baseline.state, baseline.stateRevision));
  const ack = (await first.json()) as { stateRevision: string };
  const retry = await PUT(request(baseline.state, baseline.stateRevision));
  assert.equal(retry.status, 200);
  assert.equal(
    ((await retry.json()) as { stateRevision: string }).stateRevision,
    ack.stateRevision,
  );
  const latest = await snapshot();
  latest.state.tasks[0].status = '보류';
  assert.equal(
    (await PUT(request(latest.state, latest.stateRevision))).status,
    200,
  );
  assert.equal(
    (await PUT(request(baseline.state, baseline.stateRevision))).status,
    409,
  );
  assert.equal(
    ((await readPortalState()) as ReturnType<typeof seed>).tasks[0].status,
    '보류',
  );
});

void test('queued writes send the newly acknowledged server revision', async () => {
  const originalFetch = globalThis.fetch;
  const sent: string[] = [];
  let revision = 'first-revision';
  try {
    globalThis.fetch = async (_url, init) => {
      sent.push(new Headers(init?.headers).get('if-match')!);
      return Response.json({
        ok: true,
        membersRevision: 0,
        stateRevision: `revision-${sent.length}`,
      });
    };
    const queue = new PortalSaveQueue<{
      membersRevision: number;
      value: number;
    }>(
      async (state) => {
        const ack = await putPortalSnapshot(state, 'revision-owner', revision);
        revision = ack.stateRevision!;
        return ack;
      },
      () => {},
    );
    queue.update({ membersRevision: 0, value: 1 });
    await queue.flush();
    queue.update({ membersRevision: 0, value: 2 });
    await queue.flush();
    assert.deepEqual(sent, ['"first-revision"', '"revision-1"']);
    queue.dispose();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
