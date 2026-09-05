import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../app/api/consulting-flow/[caseId]/preflight/route';
import { POST } from '../app/api/consulting-flow/[caseId]/route';
import { writePortalState } from '../lib/portal-state';
import {
  flowBucket,
  flowEnvironment,
  readFlow,
} from '../lib/consulting-flow-store';
import type { ConsultingFlow } from '../lib/consulting-flow';
import { readReportPreflightResponse } from '../lib/report-preflight-response';

const caseId = 'preflight-api';
const context = { params: Promise.resolve({ caseId }) };
const permissions = {
  ownCases: true,
  fileUpload: true,
  sharedSchedule: true,
  collaborationApply: true,
  quoteContract: true,
};
const owner = 'seedy@sites.test';
const partner = 'preflight@example.invalid';
const bodyText =
  '이것은 가상의 사전점검용 본문입니다. 현재 기업 상황과 목표는 대표 확인이 필요한 내용입니다.';
function request(path: string, body?: unknown, email = owner) {
  return new Request(`http://localhost${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      origin: 'http://localhost',
      'oai-authenticated-user-id': email,
      'oai-authenticated-user-email': email,
      ...(body instanceof FormData
        ? {}
        : { 'content-type': 'application/json' }),
    },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
}

void test('admin-only preflight is non-mutating and generation rechecks files after a successful inspection', async () => {
  await writePortalState({
    version: 1,
    consultationNumber: 0,
    timeline: [],
    tasks: [],
    schedule: [],
    companyDocuments: [],
    members: [
      {
        id: 'preflight-member',
        name: '가상 파트너',
        email: partner,
        status: '활성',
        permissions,
      },
      {
        id: 'other-member',
        name: '다른 파트너',
        email: 'other@example.invalid',
        status: '활성',
        permissions,
      },
      {
        id: 'inactive-member',
        name: '정지 파트너',
        email: 'inactive@example.invalid',
        status: '정지',
        permissions,
      },
    ],
    cases: [
      {
        id: caseId,
        company: '가상 사전점검기업',
        trainee: '가상 파트너',
        partnerMemberId: 'preflight-member',
        stage: '접수',
        consultationCount: 0,
      },
    ],
  });
  const url = `/api/consulting-flow/${caseId}`;
  for (const email of [
    partner,
    'other@example.invalid',
    'inactive@example.invalid',
  ])
    assert.equal(
      (await GET(request(`${url}/preflight`, undefined, email), context))
        .status,
      403,
    );
  assert.equal(
    (await GET(new Request(`http://localhost${url}/preflight`), context))
      .status,
    401,
  );
  assert.equal(
    (
      await GET(request(`${url}/preflight`), {
        params: Promise.resolve({ caseId: 'missing-case' }),
      })
    ).status,
    404,
  );
  const empty = await GET(request(`${url}/preflight`), context);
  assert.equal(empty.status, 200);
  assert.match(empty.headers.get('cache-control') || '', /private, no-store/);
  assert.equal(
    (await readReportPreflightResponse(empty, caseId, 0)).canGenerate,
    false,
  );
  assert.equal(await readFlow(caseId), null);
  let revision = 0;
  let sequence = 0;
  async function command(
    cmd: Record<string, unknown>,
    file?: File,
    staleRevision?: number,
  ) {
    const payload = {
      commandId: `preflight-api-${++sequence}`,
      revision: staleRevision ?? revision,
      command: cmd,
    };
    const form = new FormData();
    form.set('payload', JSON.stringify(payload));
    if (file) form.set('file', file);
    const response = await POST(request(url, file ? form : payload), context);
    if (response.ok)
      revision = ((await response.clone().json()) as { flow: ConsultingFlow })
        .flow.revision;
    return response;
  }
  assert.equal(
    (
      await command(
        {
          type: 'save_source',
          sourceText: '',
          privacyMasked: true,
          fileConsent: true,
        },
        new File([bodyText], 'verified.txt'),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await command({
        type: 'set_ai_policy',
        enabled: true,
        thirdPartyConsent: true,
        privacyMasked: true,
        costConsent: true,
      })
    ).status,
    200,
  );
  const runtime = flowEnvironment();
  const key = runtime.ANTHROPIC_API_KEY;
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('No external calls allowed');
  };
  runtime.ANTHROPIC_API_KEY = 'synthetic-preflight-test-key';
  try {
    const before = await readFlow(caseId);
    assert.ok(before);
    const checked = await GET(request(`${url}/preflight`), context);
    const raw = await checked.clone().text();
    const result = await readReportPreflightResponse(checked, caseId, revision);
    assert.equal(result.canGenerate, true);
    assert.equal(result.files[0].name, 'verified.txt');
    assert.ok(
      !raw.includes(bodyText) &&
        !raw.includes('synthetic-preflight-test-key') &&
        !raw.includes(before.files[0].key),
    );
    assert.deepEqual(await readFlow(caseId), before);
    const replaced = new TextEncoder().encode(bodyText);
    replaced[replaced.byteLength - 1] ^= 1;
    await flowBucket().put(before.files[0].key, replaced, {
      httpMetadata: { contentType: before.files[0].contentType },
    });
    const replacedCheck = await readReportPreflightResponse(
      await GET(request(`${url}/preflight`), context),
      caseId,
      revision,
    );
    assert.equal(
      replacedCheck.checks.find((check) => check.id === 'sources')?.passed,
      false,
    );
    await flowBucket().put(
      before.files[0].key,
      new TextEncoder().encode(bodyText),
      { httpMetadata: { contentType: before.files[0].contentType } },
    );
    await flowBucket().delete(before.files[0].key);
    const missing = await command({ type: 'queue_report1' });
    assert.equal(missing.status, 400);
    assert.equal((await readFlow(caseId))?.jobs.length, 0);
    assert.equal((await readFlow(caseId))?.revision, revision);
    await flowBucket().put(
      before.files[0].key,
      new TextEncoder().encode(bodyText),
      { httpMetadata: { contentType: before.files[0].contentType } },
    );
    assert.equal(
      (await command({ type: 'queue_report1' }, undefined, 0)).status,
      409,
    );
    const queued = await command({ type: 'queue_report1' });
    assert.equal(queued.status, 200);
    assert.equal((await readFlow(caseId))?.jobs[0].status, 'queued');
    assert.equal(calls, 0, 'Neither inspection nor queuing calls the model');
    assert.equal(
      (
        await readReportPreflightResponse(
          await GET(request(`${url}/preflight`), context),
          caseId,
          revision,
        )
      ).canGenerate,
      false,
    );
  } finally {
    runtime.ANTHROPIC_API_KEY = key;
    globalThis.fetch = oldFetch;
  }
});
