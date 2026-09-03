import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyApplicationDetails } from '../lib/application-details';
import {
  ApplicationDraftResponseError,
  readApplicationDraftResponse,
} from '../lib/application-draft-response';
import { GET } from '../app/api/application-draft/route';

const draft = {
  companyName: '가상 작성 중 기업',
  applicantName: '가상파트너',
  applicantType: '한기평 컨설턴트',
  partnerMemberId: 'partner-1',
  selectedServices: ['정책자금'],
  details: emptyApplicationDetails(),
  step: 2,
  hasLocalAttachments: false,
};
const savedEnvelope = {
  revision: 3,
  draftId: 'draft-request-1',
  draft,
  submittedCaseId: null,
  updatedAt: '2026-09-03T00:00:00.000Z',
};

void test('real application draft route response passes the client guard', async () => {
  const response = await GET(
    new Request('http://localhost/api/application-draft', {
      headers: {
        'oai-authenticated-user-id': 'local-owner',
        'oai-authenticated-user-email': 'seedy@sites.test',
      },
    }),
  );
  const result = await readApplicationDraftResponse(response, 'read');

  assert.equal(Number.isSafeInteger(result.revision), true);
});

void test('valid draft response restores a fully parsed draft', async () => {
  const result = await readApplicationDraftResponse(
    Response.json(savedEnvelope),
    'read',
  );

  assert.deepEqual(result, savedEnvelope);
  assert.notEqual(result.draft, draft);
});

void test('save and discard responses require operation-consistent shapes', async () => {
  assert.equal(
    (await readApplicationDraftResponse(Response.json(savedEnvelope), 'save'))
      .draftId,
    'draft-request-1',
  );
  assert.deepEqual(
    await readApplicationDraftResponse(
      Response.json({
        revision: 4,
        draftId: null,
        draft: null,
        submittedCaseId: null,
        updatedAt: '2026-09-03T00:01:00.000Z',
      }),
      'discard',
    ),
    {
      revision: 4,
      draftId: null,
      draft: null,
      submittedCaseId: null,
      updatedAt: '2026-09-03T00:01:00.000Z',
    },
  );
  await assert.rejects(
    readApplicationDraftResponse(Response.json(savedEnvelope), 'discard'),
    /응답 형식이 올바르지 않습니다/,
  );
});

void test('HTTP and unreadable failures retain status and safe recovery text', async () => {
  await assert.rejects(
    readApplicationDraftResponse(
      Response.json(
        { error: '다른 창에서 임시저장을 변경했습니다.' },
        { status: 409 },
      ),
      'save',
    ),
    (error: unknown) =>
      error instanceof ApplicationDraftResponseError &&
      error.status === 409 &&
      error.message === '다른 창에서 임시저장을 변경했습니다.',
  );
  await assert.rejects(
    readApplicationDraftResponse(
      new Response('<html>error</html>', { status: 502 }),
      'read',
    ),
    (error: unknown) =>
      error instanceof ApplicationDraftResponseError &&
      error.status === 502 &&
      /현재 입력을 유지/.test(error.message),
  );
});

void test('malformed successful envelopes never reach the application form', async () => {
  for (const body of [
    { ...savedEnvelope, revision: -1 },
    { ...savedEnvelope, draftId: null },
    { ...savedEnvelope, draft: { ...draft, step: 7 } },
    { ...savedEnvelope, submittedCaseId: 'case-draft-other' },
    { ...savedEnvelope, updatedAt: 'not-a-date' },
  ])
    await assert.rejects(
      readApplicationDraftResponse(Response.json(body), 'read'),
      /응답 형식이 올바르지 않습니다/,
    );
});
