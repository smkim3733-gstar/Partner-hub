import test from 'node:test';
import assert from 'node:assert/strict';
import { GET, PUT, DELETE } from '../app/api/application-draft/route';
import {
  writePortalState,
  readPortalState,
  mutatePortalState,
} from '../lib/portal-state';
import { applicationDraftDatabase } from '../lib/application-draft-store';
import { PUT as saveState } from './state-request';
import { PUT as rawSaveState } from '../app/api/state/route';
import { portalRevision } from '../lib/portal-revision';
import {
  draftCaseId,
  parseApplicationDraft,
  type DraftEnvelope,
} from '../lib/application-draft';
import { emptyApplicationDetails } from '../lib/application-details';

const permissions = {
  collaborationApply: true,
  ownCases: true,
  fileUpload: true,
  quoteContract: false,
  sharedSchedule: true,
};
const draft = () => ({
  companyName: '가상 작성 중 기업',
  applicantName: '가상파트너',
  applicantType: '한기평 컨설턴트',
  partnerMemberId: '',
  selectedServices: ['정책자금'],
  details: {
    ...emptyApplicationDetails(),
    registrationNumber: '123-',
    message: '작성 중\n둘째 줄 ',
  },
  step: 2,
  hasLocalAttachments: true,
});
async function setup(id: string) {
  const member = {
    id,
    email: `${id}@example.invalid`,
    name: '가상파트너',
    status: '활성',
    permissions,
  };
  const peer = {
    ...member,
    id: `${id}-peer`,
    email: `${id}-peer@example.invalid`,
  };
  const state = {
    version: 1,
    consultationNumber: 0,
    members: [member, peer],
    cases: [] as Array<Record<string, unknown>>,
    tasks: [],
    timeline: [],
    schedule: [],
    companyDocuments: [],
  };
  await writePortalState(state);
  const request = (
    body?: unknown,
    email = member.email,
    method = body ? 'PUT' : 'GET',
    origin = 'http://localhost',
  ) =>
    new Request('http://localhost/api/application-draft', {
      method,
      headers: {
        origin,
        'content-type': 'application/json',
        ...(email
          ? {
              'oai-authenticated-user-id': email,
              'oai-authenticated-user-email': email,
            }
          : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const body = (revision = 0, draftId = `${id}-request`) => ({
    revision,
    draftId,
    expectedUserId: member.email,
    draft: draft(),
  });
  return { member, peer, state, request, body };
}

void test('partial draft fields survive server reload, while invalid shape and size are rejected', () => {
  assert.deepEqual(parseApplicationDraft(draft()), draft());
  assert.equal(
    parseApplicationDraft({ ...draft(), applicantType: '' }).applicantType,
    '',
  );
  for (const value of [
    null,
    [],
    { ...draft(), selectedServices: ['unknown'] },
    { ...draft(), companyName: 'x'.repeat(101) },
    { ...draft(), applicantType: '관리자' },
    { ...draft(), details: { ...draft().details, message: 'x'.repeat(2001) } },
    { ...draft(), step: 7 },
  ])
    assert.throws(() => parseApplicationDraft(value));
});

void test('draft writes reject lookalike JSON media and invalid declared length without mutation', async () => {
  const { request, body } = await setup('draft-json-boundary');
  const before = await readPortalState();
  const lookalike = request(body());
  lookalike.headers.set('content-type', 'application/jsonx');
  assert.equal((await PUT(lookalike)).status, 415);
  const invalidLength = request(body());
  invalidLength.headers.set('content-length', 'invalid');
  assert.equal((await PUT(invalidLength)).status, 400);
  assert.deepEqual(await readPortalState(), before);
  assert.equal(
    ((await (await GET(request())).json()) as DraftEnvelope).draft,
    null,
  );
});

void test('private draft persists across requests and duplicate saves reuse its revision without changing portal records', async () => {
  const { request, body, member } = await setup('draft-persistence');
  assert.equal(
    ((await (await GET(request())).json()) as DraftEnvelope).draft,
    null,
  );
  const before = await readPortalState();
  const response = await PUT(request(body()));
  assert.equal(response.status, 200, await response.clone().text());
  const saved = (await response.json()) as DraftEnvelope;
  assert.equal(saved.revision, 1);
  assert.equal(saved.draft?.partnerMemberId, member.id);
  assert.equal(saved.draft?.details.registrationNumber, '123-');
  assert.equal(saved.draft?.hasLocalAttachments, true);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(
    ((await (await PUT(request(body()))).json()) as DraftEnvelope).revision,
    1,
  );
  assert.deepEqual(await (await GET(request())).json(), saved);
  assert.deepEqual(await readPortalState(), before);
});

void test('another account cannot read, replace, or clear a private draft; authentication, origin and permission remain required', async () => {
  const { request, body, peer, state } = await setup('draft-private');
  await PUT(request(body()));
  assert.equal((await GET(request(undefined, ''))).status, 401);
  assert.equal(
    (await PUT(request(body(), undefined, 'PUT', 'https://wrong.example')))
      .status,
    403,
  );
  const other = await GET(request(undefined, peer.email));
  assert.equal(((await other.json()) as DraftEnvelope).draft, null);
  assert.equal(
    (await DELETE(request(body(1), peer.email, 'DELETE'))).status,
    403,
  );
  assert.equal((await PUT(request(body(), peer.email))).status, 403);
  state.members[0] = {
    ...state.members[0],
    permissions: { ...permissions, collaborationApply: false },
  };
  await writePortalState(state);
  assert.equal((await GET(request())).status, 403);
});

void test('simultaneous edits and stale saves cannot overwrite a newer private draft', async () => {
  const { request, body } = await setup('draft-concurrency');
  await PUT(request(body()));
  const a = { ...body(1), draft: { ...draft(), companyName: '가상 변경 A' } };
  const b = { ...body(1), draft: { ...draft(), companyName: '가상 변경 B' } };
  const responses = await Promise.all([PUT(request(a)), PUT(request(b))]);
  assert.deepEqual(
    responses.map((r) => r.status).sort((a, b) => a - b),
    [200, 409],
  );
  const saved = (await (await GET(request())).json()) as DraftEnvelope;
  assert.equal(saved.revision, 2);
  assert.equal((await PUT(request(body(1)))).status, 409);
  assert.deepEqual(await (await GET(request())).json(), saved);
});

void test('clearing uses a revision tombstone and cannot resurrect a stale draft or delete a newer one', async () => {
  const { request, body } = await setup('draft-clear');
  await PUT(request(body()));
  assert.equal(
    (await DELETE(request(body(1), undefined, 'DELETE'))).status,
    200,
  );
  assert.equal(
    (await DELETE(request(body(1), undefined, 'DELETE'))).status,
    200,
  );
  assert.equal((await PUT(request(body()))).status, 409);
  assert.equal(
    (await PUT(request(body(2, 'fresh-draft-request')))).status,
    200,
  );
  assert.equal(
    (await DELETE(request(body(2), undefined, 'DELETE'))).status,
    409,
  );
  assert.equal(
    ((await (await GET(request())).json()) as DraftEnvelope).draftId,
    'fresh-draft-request',
  );
});

void test('a submitted draft is recognized after a lost response and cleanup preserves the completed case', async () => {
  const { request, body, state, member } = await setup('draft-submitted');
  const requestBody = body();
  await PUT(request(requestBody));
  const caseId = draftCaseId(requestBody.draftId);
  state.cases.push({
    id: caseId,
    company: '가상 접수기업',
    trainee: member.name,
    partnerMemberId: member.id,
  });
  await writePortalState(state);
  assert.equal(
    ((await (await GET(request())).json()) as DraftEnvelope).submittedCaseId,
    caseId,
  );
  assert.equal((await PUT(request(body(1)))).status, 409);
  assert.equal(
    (await DELETE(request(body(1), undefined, 'DELETE'))).status,
    200,
  );
  assert.deepEqual(await readPortalState(), state);
});

void test('final submission requires this account draft and its current revision, including a change immediately before the write', async () => {
  const { request, body, state, member, peer } =
    await setup('draft-commit-guard');
  const id = body().draftId;
  await PUT(request(body()));
  const caseRecord = {
    id: draftCaseId(id),
    company: '가상기업',
    trainee: member.name,
    partnerMemberId: member.id,
    applicationDraftRevision: 0,
  };
  assert.equal(
    (await saveState(request({ state: { ...state, cases: [caseRecord] } })))
      .status,
    409,
  );
  const forged = {
    ...caseRecord,
    partnerMemberId: peer.id,
    applicationDraftRevision: 1,
  };
  assert.equal(
    (
      await saveState(
        request({ state: { ...state, cases: [forged] } }, peer.email),
      )
    ).status,
    403,
  );
  const db = await applicationDraftDatabase();
  let first = true;
  await assert.rejects(
    mutatePortalState(
      async (current) => {
        if (first) {
          first = false;
          await db
            .prepare(
              'UPDATE application_drafts SET revision = 2 WHERE owner_key = ?1',
            )
            .bind(`member:${member.id}`)
            .run();
        }
        return {
          ...(current as object),
          cases: [{ ...caseRecord, applicationDraftRevision: 1 }],
        };
      },
      () => ({ ownerKey: `member:${member.id}`, draftId: id, revision: 1 }),
    ),
    /다른 창/,
  );
  assert.deepEqual(await readPortalState(), state);
  const response = await saveState(
    request({
      state: {
        ...state,
        cases: [{ ...caseRecord, applicationDraftRevision: 2 }],
      },
    }),
  );
  assert.equal(response.status, 200, await response.clone().text());
  const firstAck = (await response.json()) as { stateRevision: string };
  const savedState = (await readPortalState()) as typeof state;
  const savedCase = savedState.cases[0];
  assert.equal(savedCase.submissionTrackingVersion, 1);
  assert.match(
    String(savedCase.submittedAt),
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  );
  assert.equal(savedCase.pipelineLifecycleVersion, 1);
  assert.equal(savedCase.pipelineLifecycleStatus, 'active');
  assert.equal(savedCase.pipelineHighestStage, '접수');
  assert.equal(savedCase.pipelineStageSource, 'manual_reported');

  const originalRevision = await portalRevision(state);
  const lostResponseRetry = await rawSaveState(
    new Request('http://localhost/api/state', {
      method: 'PUT',
      headers: {
        origin: 'http://localhost',
        'content-type': 'application/json',
        'oai-authenticated-user-id': member.email,
        'oai-authenticated-user-email': member.email,
        'if-match': `"${originalRevision}"`,
      },
      body: JSON.stringify({
        state: {
          ...state,
          cases: [{ ...caseRecord, applicationDraftRevision: 2 }],
        },
      }),
    }),
  );
  assert.equal(
    lostResponseRetry.status,
    200,
    await lostResponseRetry.clone().text(),
  );
  assert.equal(
    ((await lostResponseRetry.json()) as { stateRevision: string })
      .stateRevision,
    firstAck.stateRevision,
  );
  assert.equal(
    ((await readPortalState()) as typeof state).cases[0].submittedAt,
    savedCase.submittedAt,
  );
});
