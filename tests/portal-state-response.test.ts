import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PortalStateResponseError,
  readPortalStateResponse,
} from '../lib/portal-state-response';
import { GET } from '../app/api/state/route';

type State = { version: 1; items: unknown[] };
const isState = (value: unknown): value is State =>
  Boolean(
    value &&
      typeof value === 'object' &&
      (value as Partial<State>).version === 1 &&
      Array.isArray((value as Partial<State>).items),
  );
const admin = {
  id: 'admin:owner@example.com',
  email: 'owner@example.com',
  displayName: '대표',
  role: 'admin',
  memberId: null,
  memberName: null,
  permissions: null,
  authMethod: 'chatgpt',
};

void test('real administrator state response passes every client response guard', async () => {
  const response = await GET(
    new Request('http://localhost/api/state', {
      headers: {
        'oai-authenticated-user-id': 'local-owner',
        'oai-authenticated-user-email': 'seedy@sites.test',
      },
    }),
  );
  const payload = await readPortalStateResponse(
    response,
    (value): value is Record<string, unknown> =>
      Boolean(
        value &&
          typeof value === 'object' &&
          (value as { version?: unknown }).version === 1,
      ),
  );

  assert.equal(payload.currentUser.role, 'admin');
  assert.equal(payload.storage !== null, true);
  assert.equal(payload.saveConflicts !== null, true);
  assert.equal(payload.passwordLinks !== null, true);
  assert.equal(payload.applicationFunnel !== null, true);
  assert.equal(payload.duplicateRequests !== null, true);
  assert.equal(payload.jointAnalysisConfirmation !== null, true);
  assert.equal(payload.documentReviewWait !== null, true);
  assert.equal(payload.supportRequests !== null, true);
  assert.equal(payload.pipelineDropoff !== null, true);
});

void test('validated portal state core becomes applicable', async () => {
  const state: State = { version: 1, items: [] };
  const payload = await readPortalStateResponse(
    Response.json({ state, currentUser: admin, stateRevision: 'revision-1' }),
    isState,
  );

  assert.deepEqual(payload.state, state);
  assert.equal(payload.currentUser.role, 'admin');
  assert.equal(payload.stateRevision, 'revision-1');
});

void test('uninitialized state remains explicit while malformed optional metrics are hidden', async () => {
  const payload = await readPortalStateResponse(
    Response.json({
      state: null,
      currentUser: admin,
      stateRevision: 'revision-empty',
      storage: { storedBytes: 'not-a-number' },
      passwordLinks: { issued: 'not-a-number' },
      duplicateRequests: {
        windowDays: 7,
        totalSafeRetries: 1,
        totalRequestKeyConflicts: 0,
        totalExistingRecordBlocks: 0,
        unkeyedUploadRequests: 0,
        rows: [{ source: 'unknown', outcome: 'safe_retry', count: 1 }],
      },
      applicationFunnel: {
        trackedApplications: 3,
        flowStarted: 3,
        firstConsultationsCompleted: 2,
        flowPending: 1,
        legacyConsultationsUnmeasurable: 0,
        flowNotStarted: 0,
        invalidCompletionTimes: 0,
        completionRatePercent: 66.7,
        durationDisclosureThreshold: 5,
        durationBuckets: null,
      },
    }),
    isState,
  );

  assert.equal(payload.state, null);
  assert.equal(payload.storage, null);
  assert.equal(payload.passwordLinks, null);
  assert.equal(payload.duplicateRequests, null);
  assert.equal(payload.applicationFunnel?.completionRatePercent, 66.7);
});

void test('HTTP denial preserves status and safe server message', async () => {
  await assert.rejects(
    readPortalStateResponse(
      Response.json({ error: '로그인이 필요합니다.' }, { status: 401 }),
      isState,
    ),
    (error: unknown) =>
      error instanceof PortalStateResponseError &&
      error.status === 401 &&
      error.message === '로그인이 필요합니다.',
  );
});

void test('unreadable responses use a Korean recovery message and retain HTTP status', async () => {
  await assert.rejects(
    readPortalStateResponse(
      new Response('<html>denied</html>', {
        status: 403,
        headers: { 'content-type': 'text/html' },
      }),
      isState,
    ),
    (error: unknown) =>
      error instanceof PortalStateResponseError &&
      error.status === 403 &&
      /로그인 정보를 확인/.test(error.message),
  );
});

void test('missing or malformed core fields never become portal state', async () => {
  for (const body of [
    { currentUser: admin, stateRevision: 'revision-1' },
    { state: { version: 2, items: [] }, currentUser: admin, stateRevision: 'revision-1' },
    { state: { version: 1, items: [] }, currentUser: { ...admin, role: 'partner' }, stateRevision: 'revision-1' },
    { state: { version: 1, items: [] }, currentUser: admin, stateRevision: '' },
  ]) {
    await assert.rejects(
      readPortalStateResponse(Response.json(body), isState),
      /포털 응답 형식이 올바르지 않습니다/,
    );
  }
});
