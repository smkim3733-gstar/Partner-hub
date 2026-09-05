import test from 'node:test';
import assert from 'node:assert/strict';
import { POST, GET } from '../app/api/consulting-flow/[caseId]/route';
import { POST as run } from '../app/api/consulting-flow/[caseId]/run/route';
import { env } from 'cloudflare:workers';
import { GET as download } from '../app/api/consulting-flow/[caseId]/files/[fileId]/route';
import {
  applyFlowCommand,
  FlowError,
  newConsultingFlow,
  type ConsultingFlow,
} from '../lib/consulting-flow';
import {
  commitFlow,
  readFlow,
  flowBucket,
  flowDatabase,
  stateWithConsultingFlows,
} from '../lib/consulting-flow-store';
import { readPortalState, writePortalState } from '../lib/portal-state';
import { readDuplicateRequestSummary } from '../lib/duplicate-request-metrics';
import { flushWaitUntil } from './runtime-mock.mjs';
import {
  flowCommandReceipt,
  flowCommandRetryKey,
  isFlowCommandRetry,
} from '../lib/flow-command-receipt';
import type { PortalUser } from '../lib/portal-auth';
import {
  FLOW_COLLECTION_LIMITS,
  FLOW_TEXT_LIMITS,
} from '../lib/consulting-flow-shape';
import {
  MAX_FLOW_UPLOAD_BYTES,
  type StoredFlowFilePurpose,
} from '../lib/consulting-flow-upload-policy';
import { MAX_AI_SOURCE_BYTES } from '../lib/intake-source-policy';
import { MAX_TRANSCRIPT_FILE_BYTES } from '../lib/transcript-policy';

const partner = {
  id: 'safety-partner',
  name: '가상 담당자',
  email: 'flow-safety@example.invalid',
  status: '활성',
  permissions: { ownCases: true, fileUpload: true, quoteContract: true },
};
const adminEmail = 'seedy@sites.test';
const body =
  '가상 자료를 이용한 내부 회귀 검증용 보고서입니다. 실제 기업 자료나 유료 분석을 이용하지 않습니다. '.repeat(
    4,
  );
let sequence = 0;
const context = (caseId: string) => ({ params: Promise.resolve({ caseId }) });

void test('FLOW stops a queued model request when the caller is suspended during source preparation', async () => {
  const flow = await fixture();
  const next = structuredClone(flow),
    source = 'SYNTHETIC INTERNAL SOURCE FOR LOCAL REGRESSION ONLY';
  next.revision++;
  next.ai.enabled = true;
  next.files.push({
    id: 'source',
    purpose: 'source',
    name: 'source.txt',
    contentType: 'text/plain',
    size: source.length,
    key: `synthetic/${flow.caseId}`,
    createdAt: new Date().toISOString(),
  });
  next.jobs.push({
    id: 'synthetic-job',
    stage: 1,
    status: 'queued',
    reason: '',
    createdAt: new Date().toISOString(),
  });
  await commitFlow(flow, next);
  const bucket = flowBucket(),
    get = bucket.get.bind(bucket),
    runtime = env as unknown as Record<string, unknown>;
  const previousKey = runtime.ANTHROPIC_API_KEY,
    fetch = globalThis.fetch;
  await bucket.put(next.files[0].key, source);
  let calls = 0;
  runtime.ANTHROPIC_API_KEY = 'SYNTHETIC_NOT_A_REAL_KEY';
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: body + '[분석 끝]' }],
    });
  };
  bucket.get = async (...args: Parameters<R2Bucket['get']>) => {
    const object = await get(...args);
    await suspend();
    return object;
  };
  try {
    await run(
      request(flow.caseId, {}, 0, undefined, partner.email),
      context(flow.caseId),
    );
    assert.equal(calls, 0);
    const stored = (await readFlow(flow.caseId))!;
    assert.equal(stored.reports.length, flow.reports.length);
    assert.notEqual(stored.jobs[0].status, 'complete');
  } finally {
    bucket.get = get;
    globalThis.fetch = fetch;
    if (previousKey === undefined) delete runtime.ANTHROPIC_API_KEY;
    else runtime.ANTHROPIC_API_KEY = previousKey;
  }
});

void test('FLOW rejects a decorated oversized AI result without leaving the job processing', async () => {
  const flow = await fixture();
  const queued = structuredClone(flow);
  queued.revision++;
  queued.updatedAt = new Date().toISOString();
  queued.ai = {
    enabled: true,
    sourceText: 'SYNTHETIC INTERNAL SOURCE FOR LOCAL REGRESSION ONLY',
    approvedAt: queued.updatedAt,
    approvedBy: adminEmail,
  };
  queued.jobs.push({
    id: 'oversized-ai-result-job',
    stage: 1,
    status: 'queued',
    reason: '',
    createdAt: queued.updatedAt,
  });
  await commitFlow(flow, queued);

  const runtime = env as unknown as Record<string, unknown>;
  const previousKey = runtime.ANTHROPIC_API_KEY;
  const previousFetch = globalThis.fetch;
  let calls = 0;
  runtime.ANTHROPIC_API_KEY = 'SYNTHETIC_NOT_A_REAL_KEY';
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: `${'가'.repeat(79990)}\n[분석 끝]`,
        },
      ],
    });
  };
  try {
    const response = await run(
      request(flow.caseId, {}, 0, undefined, adminEmail),
      context(flow.caseId),
    );
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(calls, 1);
    const stored = (await readFlow(flow.caseId))!;
    assert.equal(stored.jobs.at(-1)?.status, 'failed');
    assert.equal(stored.reports.length, flow.reports.length);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete runtime.ANTHROPIC_API_KEY;
    else runtime.ANTHROPIC_API_KEY = previousKey;
  }
});

void test('FLOW duplicate payment requests persist one payment and accept an exact retry', async () => {
  const flow = await fixture(),
    signed = structuredClone(flow);
  signed.revision++;
  signed.files.push({
    id: 'synthetic-signed',
    name: 'synthetic-signed.pdf',
    contentType: 'application/pdf',
    size: 1,
    key: 'synthetic/signed.pdf',
    createdAt: new Date().toISOString(),
    purpose: 'signed_contract',
  });
  signed.reports.push({
    id: 'synthetic-report',
    stage: 6,
    version: 1,
    title: '가상 계약서',
    body: '',
    sourceReportId: flow.reports[0].id,
    createdAt: new Date().toISOString(),
    createdBy: '가상 대표',
    origin: 'manual',
  });
  signed.meetings.push({
    id: 'synthetic-meeting',
    kind: 'contract',
    startsAt: '2026-08-30T00:00:00.000Z',
    endsAt: '2026-08-30T01:00:00.000Z',
    location: '가상',
    attendance: 'admin',
    status: 'completed',
    note: '',
    createdBy: '가상 대표',
    completedAt: '2026-08-30T01:00:00.000Z',
  });
  signed.contract = {
    meetingId: 'synthetic-meeting',
    reportId: 'synthetic-report',
    signedFileId: 'synthetic-signed',
    signedAt: '2026-08-30',
    expectedDepositWon: 1000,
    recordedBy: '가상 대표',
  };
  await commitFlow(flow, signed);
  const command = {
      type: 'confirm_payment',
      paymentConfirmed: true,
      amountWon: 1000,
      receivedAt: '2026-08-30',
      reference: 'SYNTHETIC_PAYMENT_ONLY',
    },
    commandId = `flow-safety-${++sequence}`;
  const responses = await Promise.all([
    POST(
      request(flow.caseId, command, signed.revision, commandId),
      context(flow.caseId),
    ),
    POST(
      request(flow.caseId, command, signed.revision, commandId),
      context(flow.caseId),
    ),
  ]);
  assert.ok(responses.some((response) => response.status === 200));
  assert.ok(
    responses.every((response) => [200, 409].includes(response.status)),
  );
  const retry = await POST(
    request(flow.caseId, command, signed.revision, commandId),
    context(flow.caseId),
  );
  assert.equal(retry.status, 200);
  const result = (await retry.json()) as {
    flow: ConsultingFlow;
    duplicate: boolean;
  };
  assert.equal(result.duplicate, true);
  assert.equal(result.flow.payments.length, 1);
  assert.equal(result.flow.commandReceipts, undefined);
  assert.equal((await readFlow(flow.caseId))!.revision, signed.revision + 1);
});

void test('legacy command IDs without receipts require refresh and cannot silently acknowledge a new action', async () => {
  const flow = await fixture();
  const response = await POST(
    request(
      flow.caseId,
      { type: 'confirm_analysis', reportId: flow.reports[0].id },
      flow.revision,
      flow.commandIds[0],
    ),
    context(flow.caseId),
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await readFlow(flow.caseId), flow);
});
function request(
  caseId: string,
  command: Record<string, unknown> | undefined,
  revision = 0,
  commandId = `flow-safety-${++sequence}`,
  email = adminEmail,
  file?: File,
) {
  const payload = JSON.stringify({ command, revision, commandId });
  const form = new FormData();
  form.set('payload', payload);
  if (file) form.set('file', file);
  return new Request(`http://localhost/api/consulting-flow/${caseId}`, {
    method: command ? 'POST' : 'GET',
    headers: {
      origin: 'http://localhost',
      'oai-authenticated-user-id': email,
      'oai-authenticated-user-email': email,
      ...(!file ? { 'content-type': 'application/json' } : {}),
    },
    ...(command ? { body: file ? form : payload } : {}),
  });
}
async function fixture() {
  const caseId = `flow-safety-case-${++sequence}`;
  await writePortalState({
    version: 1,
    consultationNumber: 0,
    members: [
      partner,
      { ...partner, id: 'other', email: 'other-flow@example.invalid' },
    ],
    cases: [
      {
        id: caseId,
        company: '가상기업',
        trainee: partner.name,
        partnerMemberId: partner.id,
      },
    ],
    tasks: [],
    timeline: [],
    schedule: [],
    companyDocuments: [],
  });
  const initial = newConsultingFlow(
    caseId,
    '가상기업',
    partner.id,
    partner.name,
  );
  const flow = applyFlowCommand(
    initial,
    { type: 'save_report', stage: 1, body },
    { id: adminEmail, role: 'admin', name: '가상 대표' },
    { commandId: `fixture-${++sequence}`, now: new Date().toISOString() },
  );
  await commitFlow(initial, flow);
  return (await readFlow(caseId))!;
}
async function fixtureWithAttachment() {
  const flow = await fixture();
  const response = await POST(
    request(
      flow.caseId,
      { type: 'save_report', stage: 1, body, fileConsent: true },
      flow.revision,
      undefined,
      adminEmail,
      new File(['SYNTHETIC_ORIGINAL'], 'report.txt', { type: 'text/plain' }),
    ),
    context(flow.caseId),
  );
  assert.equal(response.status, 200, await response.clone().text());
  const saved = (await readFlow(flow.caseId))!;
  return { saved, file: saved.files[0] };
}
async function replaceStoredFlow(
  caseId: string,
  transform: (payload: Record<string, unknown>) => unknown,
) {
  const db = await flowDatabase();
  const row = await db
    .prepare('SELECT payload FROM consulting_flows WHERE case_id = ?1')
    .bind(caseId)
    .first<{ payload: string }>();
  assert.ok(row);
  await db
    .prepare('UPDATE consulting_flows SET payload = ?1 WHERE case_id = ?2')
    .bind(JSON.stringify(transform(JSON.parse(row.payload))), caseId)
    .run();
}
async function suspend() {
  const state = (await readPortalState()) as {
    members: Array<{ status: string }>;
  };
  state.members[0].status = '정지';
  await writePortalState(state);
}

void test('FLOW rejects a payload partner identity mismatch before access control', async () => {
  const flow = await fixture();
  await replaceStoredFlow(flow.caseId, (payload) => ({
    ...payload,
    partnerId: 'other',
  }));
  const response = await GET(
    request(flow.caseId, undefined, 0, undefined, 'other-flow@example.invalid'),
    context(flow.caseId),
  );
  assert.equal(response.status, 503, await response.clone().text());
});

void test('FLOW rejects stored case and revision envelope mismatches', async () => {
  const caseFlow = await fixture();
  await replaceStoredFlow(caseFlow.caseId, (payload) => ({
    ...payload,
    caseId: `${caseFlow.caseId}-changed`,
  }));
  await assert.rejects(
    readFlow(caseFlow.caseId),
    (error) => error instanceof FlowError && error.status === 503,
  );

  const revisionFlow = await fixture();
  await replaceStoredFlow(revisionFlow.caseId, (payload) => ({
    ...payload,
    revision: revisionFlow.revision + 1,
  }));
  await assert.rejects(
    readFlow(revisionFlow.caseId),
    (error) => error instanceof FlowError && error.status === 503,
  );
});

void test('FLOW isolates malformed stored JSON from detail and dashboard reads', async () => {
  const flow = await fixture();
  const db = await flowDatabase();
  await db
    .prepare('UPDATE consulting_flows SET payload = ?1 WHERE case_id = ?2')
    .bind('{malformed', flow.caseId)
    .run();
  await assert.rejects(
    readFlow(flow.caseId),
    (error) => error instanceof FlowError && error.status === 503,
  );
  await assert.rejects(
    stateWithConsultingFlows(await readPortalState()),
    (error) => error instanceof FlowError && error.status === 503,
  );
});

void test('FLOW commit refuses case and partner identity changes before D1 writes', async () => {
  for (const field of ['caseId', 'partnerId'] as const) {
    const initial = newConsultingFlow(
      `flow-transition-${field}-${++sequence}`,
      '가상기업',
      partner.id,
      partner.name,
    );
    const changed = {
      ...initial,
      [field]: `${initial[field]}-changed`,
      revision: 1,
      updatedAt: new Date().toISOString(),
    };
    await assert.rejects(
      commitFlow(initial, changed),
      (error) => error instanceof FlowError && error.status === 503,
    );
    assert.equal(await readFlow(initial.caseId), null);
    assert.equal(await readFlow(changed.caseId), null);
  }
});

void test('FLOW commit requires exactly one revision and a valid stored timestamp', async () => {
  for (const revision of [0, 2]) {
    const initial = newConsultingFlow(
      `flow-transition-revision-${revision}-${++sequence}`,
      '가상기업',
      partner.id,
      partner.name,
    );
    await assert.rejects(
      commitFlow(initial, {
        ...initial,
        revision,
        updatedAt: new Date().toISOString(),
      }),
      (error) => error instanceof FlowError && error.status === 503,
    );
    assert.equal(await readFlow(initial.caseId), null);
  }
  const initial = newConsultingFlow(
    `flow-transition-time-${++sequence}`,
    '가상기업',
    partner.id,
    partner.name,
  );
  await assert.rejects(
    commitFlow(initial, { ...initial, revision: 1, updatedAt: 'invalid' }),
    (error) => error instanceof FlowError && error.status === 503,
  );
  assert.equal(await readFlow(initial.caseId), null);
});

void test('FLOW rejects a D1 updated timestamp that differs from its payload', async () => {
  const flow = await fixture();
  const db = await flowDatabase();
  await db
    .prepare('UPDATE consulting_flows SET updated_at = ?1 WHERE case_id = ?2')
    .bind('2020-01-01T00:00:00.000Z', flow.caseId)
    .run();
  await assert.rejects(
    readFlow(flow.caseId),
    (error) => error instanceof FlowError && error.status === 503,
  );
  await assert.rejects(
    stateWithConsultingFlows(await readPortalState()),
    (error) => error instanceof FlowError && error.status === 503,
  );
});

void test('FLOW rejects malformed required payload structure before detail use', async () => {
  const corruptions: Array<
    [string, (payload: Record<string, unknown>) => unknown]
  > = [
    ['company', (payload) => ({ ...payload, company: '' })],
    ['partnerName', (payload) => ({ ...payload, partnerName: [] })],
    ['reports', (payload) => ({ ...payload, reports: {} })],
    ['files', (payload) => ({ ...payload, files: null })],
    ['analysis', (payload) => ({ ...payload, analysis: null })],
    [
      'ai source',
      (payload) => ({
        ...payload,
        ai: { ...(payload.ai as Record<string, unknown>), sourceText: 1 },
      }),
    ],
  ];
  for (const [name, corrupt] of corruptions) {
    const flow = await fixture();
    await replaceStoredFlow(flow.caseId, corrupt);
    await assert.rejects(
      readFlow(flow.caseId),
      (error) => error instanceof FlowError && error.status === 503,
      name,
    );
  }
});

void test('FLOW rejects malformed collection entries before detail use', async () => {
  const corruptions: Array<
    [string, (payload: Record<string, unknown>) => unknown]
  > = [
    [
      'report stage',
      (payload) => ({
        ...payload,
        reports: (payload.reports as Array<Record<string, unknown>>).map(
          (item: Record<string, unknown>, index: number) =>
            index === 0 ? { ...item, stage: 9 } : item,
        ),
      }),
    ],
    [
      'file size',
      (payload) => ({
        ...payload,
        files: [
          {
            id: 'corrupt-file',
            name: '손상.pdf',
            contentType: 'application/pdf',
            size: -1,
            key: 'flow/corrupt.pdf',
            createdAt: new Date().toISOString(),
            purpose: 'source',
          },
        ],
      }),
    ],
    [
      'meeting status',
      (payload) => ({
        ...payload,
        meetings: [
          {
            id: 'corrupt-meeting',
            kind: 'first',
            startsAt: '2026-09-05T00:00:00.000Z',
            endsAt: '2026-09-05T01:00:00.000Z',
            location: '온라인',
            attendance: 'both',
            status: 'unknown',
            note: '',
            createdBy: partner.id,
          },
        ],
      }),
    ],
    [
      'request required',
      (payload) => ({
        ...payload,
        requests: [
          {
            id: 'corrupt-request',
            title: '자료',
            required: 'yes',
            channel: '이메일',
            recipient: partner.email,
            dueDate: '2026-09-10',
            status: 'requested',
            note: '',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    ],
    [
      'payment amount',
      (payload) => ({
        ...payload,
        payments: [
          {
            id: 'corrupt-payment',
            amountWon: -1,
            receivedAt: '2026-09-05',
            reference: 'test',
            confirmedBy: partner.id,
            recordedAt: new Date().toISOString(),
          },
        ],
      }),
    ],
  ];
  for (const [name, corrupt] of corruptions) {
    const flow = await fixture();
    await replaceStoredFlow(flow.caseId, corrupt);
    await assert.rejects(
      readFlow(flow.caseId),
      (error) => error instanceof FlowError && error.status === 503,
      name,
    );
  }
});

void test('FLOW rejects orphaned internal references before detail use', async () => {
  const corruptions: Array<
    [string, (payload: Record<string, unknown>) => unknown]
  > = [
    [
      'report file',
      (payload) => ({
        ...payload,
        reports: (payload.reports as Array<Record<string, unknown>>).map(
          (item, index) =>
            index === 0 ? { ...item, fileId: 'missing-file' } : item,
        ),
      }),
    ],
    [
      'report source',
      (payload) => ({
        ...payload,
        reports: (payload.reports as Array<Record<string, unknown>>).map(
          (item, index) =>
            index === 0 ? { ...item, sourceReportId: 'missing-report' } : item,
        ),
      }),
    ],
    [
      'analysis report',
      (payload) => ({
        ...payload,
        analysis: {
          ...(payload.analysis as Record<string, unknown>),
          reportId: 'missing-report',
        },
      }),
    ],
    [
      'recording meeting',
      (payload) => ({
        ...payload,
        recordings: [
          {
            id: 'orphan-recording',
            meetingId: 'missing-meeting',
            transcript: '',
            consentAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    ],
    [
      'request file',
      (payload) => ({
        ...payload,
        requests: [
          {
            id: 'orphan-request',
            title: '자료',
            required: true,
            channel: '이메일',
            recipient: partner.email,
            dueDate: '',
            status: 'received',
            fileId: 'missing-file',
            note: '',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    ],
    [
      'decision report',
      (payload) => ({
        ...payload,
        decision: {
          id: 'orphan-decision',
          reportId: 'missing-report',
          solutions: ['가상 솔루션'],
          note: '',
          documentsNeeded: false,
          at: new Date().toISOString(),
        },
      }),
    ],
    [
      'AI job source',
      (payload) => ({
        ...payload,
        jobs: [
          {
            id: 'orphan-job',
            stage: 4,
            sourceRecordingId: 'missing-recording',
            sourceReportId: (payload.reports as Array<{ id: string }>)[0].id,
            status: 'blocked',
            reason: '가상 대기',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    ],
    [
      'command receipt',
      (payload) => ({
        ...payload,
        commandReceipts: {
          ...(payload.commandReceipts as Record<string, unknown>),
          'orphan-command': {
            actorKey: 'member:synthetic',
            fingerprint: 'synthetic-fingerprint',
          },
        },
      }),
    ],
  ];
  for (const [name, corrupt] of corruptions) {
    const flow = await fixture();
    await replaceStoredFlow(flow.caseId, corrupt);
    await assert.rejects(
      readFlow(flow.caseId),
      (error) => error instanceof FlowError && error.status === 503,
      name,
    );
  }
});

void test('FLOW commit rejects an orphaned reference before D1 writes', async () => {
  const initial = newConsultingFlow(
    `flow-orphan-commit-${++sequence}`,
    '가상기업',
    partner.id,
    partner.name,
  );
  const changed = applyFlowCommand(
    initial,
    { type: 'save_report', stage: 1, body },
    { id: adminEmail, role: 'admin', name: '가상 대표' },
    { commandId: `orphan-${++sequence}`, now: new Date().toISOString() },
  );
  changed.reports[0].fileId = 'missing-file';
  await assert.rejects(
    commitFlow(initial, changed),
    (error) => error instanceof FlowError && error.status === 503,
  );
  assert.equal(await readFlow(initial.caseId), null);
});

void test('FLOW rejects inconsistent time and status evidence before detail use', async () => {
  const corruptions: Array<
    [string, (payload: Record<string, unknown>) => unknown]
  > = [
    [
      'completed meeting without completion time',
      (payload) => ({
        ...payload,
        meetings: [
          {
            id: 'invalid-completed-meeting',
            kind: 'first',
            startsAt: '2026-09-05T00:00:00.000Z',
            endsAt: '2026-09-05T01:00:00.000Z',
            location: '온라인',
            attendance: 'both',
            status: 'completed',
            note: '',
            createdBy: partner.id,
          },
        ],
      }),
    ],
    [
      'verified request without verification time',
      (payload) => ({
        ...payload,
        files: [
          {
            id: 'status-file',
            name: 'status.pdf',
            contentType: 'application/pdf',
            size: 1,
            key: 'flow/status.pdf',
            createdAt: '2026-09-05T00:00:00.000Z',
            purpose: 'requested_document',
          },
        ],
        requests: [
          {
            id: 'invalid-verified-request',
            title: '자료',
            required: true,
            channel: '이메일',
            recipient: partner.email,
            dueDate: '2026-09-06',
            status: 'verified',
            fileId: 'status-file',
            note: '',
            createdAt: '2026-09-05T00:00:00.000Z',
            receivedAt: '2026-09-05T01:00:00.000Z',
            reviewedAt: '2026-09-05T02:00:00.000Z',
          },
        ],
      }),
    ],
    [
      'queued AI job with a start time',
      (payload) => ({
        ...payload,
        jobs: [
          {
            id: 'invalid-queued-job',
            stage: 1,
            status: 'queued',
            reason: '',
            createdAt: '2026-09-05T00:00:00.000Z',
            startedAt: '2026-09-05T01:00:00.000Z',
          },
        ],
      }),
    ],
  ];
  for (const [name, corrupt] of corruptions) {
    const flow = await fixture();
    await replaceStoredFlow(flow.caseId, corrupt);
    await assert.rejects(
      readFlow(flow.caseId),
      (error) => error instanceof FlowError && error.status === 503,
      name,
    );
  }
});

void test('FLOW commit rejects inconsistent state evidence before D1 writes', async () => {
  const initial = newConsultingFlow(
    `flow-state-commit-${++sequence}`,
    '가상기업',
    partner.id,
    partner.name,
  );
  const changed = applyFlowCommand(
    initial,
    { type: 'save_report', stage: 1, body },
    { id: adminEmail, role: 'admin', name: '가상 대표' },
    { commandId: `state-${++sequence}`, now: new Date().toISOString() },
  );
  changed.jobs.push({
    id: 'invalid-queued-job',
    stage: 1,
    status: 'queued',
    reason: '',
    createdAt: changed.updatedAt,
    startedAt: changed.updatedAt,
  });
  await assert.rejects(
    commitFlow(initial, changed),
    (error) => error instanceof FlowError && error.status === 503,
  );
  assert.equal(await readFlow(initial.caseId), null);
});

void test('FLOW rejects excessive collections and oversized fields before detail use', async () => {
  const collectionFlow = await fixture();
  await replaceStoredFlow(collectionFlow.caseId, (payload) => ({
    ...payload,
    commandIds: [
      ...(payload.commandIds as string[]),
      ...Array.from(
        { length: FLOW_COLLECTION_LIMITS.commandIds },
        (_, index) => `excess-command-${index}`,
      ),
    ],
  }));
  await assert.rejects(
    readFlow(collectionFlow.caseId),
    (error) => error instanceof FlowError && error.status === 503,
  );

  const fieldFlow = await fixture();
  await replaceStoredFlow(fieldFlow.caseId, (payload) => ({
    ...payload,
    reports: (payload.reports as Array<Record<string, unknown>>).map(
      (item, index) =>
        index === 0 ? { ...item, body: 'x'.repeat(80001) } : item,
    ),
  }));
  await assert.rejects(
    readFlow(fieldFlow.caseId),
    (error) => error instanceof FlowError && error.status === 503,
  );
});

void test('FLOW detail and dashboard reject empty, oversized and unknown-purpose file metadata', async () => {
  const corruptions: Array<{
    contentType: string;
    name: string;
    purpose: StoredFlowFilePurpose | 'unknown';
    size: number;
  }> = [
    {
      contentType: 'application/pdf',
      name: 'empty.pdf',
      purpose: 'report',
      size: 0,
    },
    {
      contentType: 'application/pdf',
      name: 'oversized-report.pdf',
      purpose: 'report',
      size: MAX_FLOW_UPLOAD_BYTES + 1,
    },
    {
      contentType: 'application/pdf',
      name: 'oversized-source.pdf',
      purpose: 'source_archived',
      size: MAX_AI_SOURCE_BYTES + 1,
    },
    {
      contentType: 'text/plain',
      name: 'oversized-transcript.txt',
      purpose: 'transcript',
      size: MAX_TRANSCRIPT_FILE_BYTES + 1,
    },
    {
      contentType: 'application/pdf',
      name: 'unknown.pdf',
      purpose: 'unknown',
      size: 1,
    },
  ];
  for (const [index, corruption] of corruptions.entries()) {
    await (await flowDatabase()).prepare('DELETE FROM consulting_flows').run();
    const flow = await fixture();
    await replaceStoredFlow(flow.caseId, (payload) => {
      (payload.files as Array<Record<string, unknown>>).push({
        id: `invalid-file-${index}`,
        name: corruption.name,
        contentType: corruption.contentType,
        size: corruption.size,
        key: `synthetic/invalid-file-${index}`,
        createdAt: payload.updatedAt,
        purpose: corruption.purpose,
      });
      return payload;
    });
    await assert.rejects(
      readFlow(flow.caseId),
      (error) => error instanceof FlowError && error.status === 503,
    );
    await assert.rejects(
      stateWithConsultingFlows(await readPortalState()),
      (error) => error instanceof FlowError && error.status === 503,
    );
  }
});

void test('FLOW detail and dashboard reject file extensions and MIME outside their stored purpose', async () => {
  const corruptions = [
    {
      name: 'signed-contract.txt',
      contentType: 'text/plain',
      purpose: 'signed_contract',
    },
    {
      name: 'report.pdf',
      contentType: 'text/plain',
      purpose: 'report',
    },
    {
      name: 'report.exe',
      contentType: 'application/pdf',
      purpose: 'report',
    },
    {
      name: 'archived-source.docx',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      purpose: 'source_archived',
    },
  ] as const;
  for (const [index, corruption] of corruptions.entries()) {
    await (await flowDatabase()).prepare('DELETE FROM consulting_flows').run();
    const flow = await fixture();
    await replaceStoredFlow(flow.caseId, (payload) => {
      (payload.files as Array<Record<string, unknown>>).push({
        id: `invalid-file-format-${index}`,
        name: corruption.name,
        contentType: corruption.contentType,
        size: 1,
        key: `synthetic/invalid-file-format-${index}`,
        createdAt: payload.updatedAt,
        purpose: corruption.purpose,
      });
      return payload;
    });
    await assert.rejects(
      readFlow(flow.caseId),
      (error) => error instanceof FlowError && error.status === 503,
    );
    await assert.rejects(
      stateWithConsultingFlows(await readPortalState()),
      (error) => error instanceof FlowError && error.status === 503,
    );
  }
});

void test('FLOW commit rejects an oversized field before D1 writes', async () => {
  const initial = newConsultingFlow(
    `flow-size-commit-${++sequence}`,
    '가상기업',
    partner.id,
    partner.name,
  );
  const changed = applyFlowCommand(
    initial,
    { type: 'save_report', stage: 1, body },
    { id: adminEmail, role: 'admin', name: '가상 대표' },
    { commandId: `size-command-${++sequence}`, now: new Date().toISOString() },
  );
  changed.reports[0].body = 'x'.repeat(80001);
  await assert.rejects(
    commitFlow(initial, changed),
    (error) => error instanceof FlowError && error.status === 503,
  );
  assert.equal(await readFlow(initial.caseId), null);
});

void test('FLOW dashboard validates full stored structure before SQLite projection', async () => {
  await (await flowDatabase()).prepare('DELETE FROM consulting_flows').run();
  const flow = await fixture();
  await replaceStoredFlow(flow.caseId, (payload) => {
    const { files: _files, ...withoutFiles } = payload;
    return withoutFiles;
  });
  await assert.rejects(
    stateWithConsultingFlows(await readPortalState()),
    (error) => error instanceof FlowError && error.status === 503,
  );
});

void test('FLOW dashboard rejects non-object hidden collection entries', async () => {
  await (await flowDatabase()).prepare('DELETE FROM consulting_flows').run();
  const flow = await fixture();
  await replaceStoredFlow(flow.caseId, (payload) => ({
    ...payload,
    files: [1],
  }));
  await assert.rejects(
    stateWithConsultingFlows(await readPortalState()),
    (error) => error instanceof FlowError && error.status === 503,
  );
});

void test('FLOW dashboard rejects a hidden orphaned file reference', async () => {
  await (await flowDatabase()).prepare('DELETE FROM consulting_flows').run();
  const flow = await fixture();
  await replaceStoredFlow(flow.caseId, (payload) => ({
    ...payload,
    requests: [
      {
        id: 'orphan-dashboard-request',
        title: '자료',
        required: true,
        channel: '이메일',
        recipient: partner.email,
        dueDate: '',
        status: 'received',
        fileId: 'missing-file',
        note: '',
        createdAt: new Date().toISOString(),
      },
    ],
  }));
  await assert.rejects(
    stateWithConsultingFlows(await readPortalState()),
    (error) => error instanceof FlowError && error.status === 503,
  );
});

void test('FLOW dashboard rejects inconsistent hidden AI job state', async () => {
  await (await flowDatabase()).prepare('DELETE FROM consulting_flows').run();
  const flow = await fixture();
  await replaceStoredFlow(flow.caseId, (payload) => ({
    ...payload,
    jobs: [
      {
        id: 'invalid-dashboard-job',
        stage: 1,
        status: 'complete',
        reason: '',
        createdAt: '2026-09-05T00:00:00.000Z',
      },
    ],
  }));
  await assert.rejects(
    stateWithConsultingFlows(await readPortalState()),
    (error) => error instanceof FlowError && error.status === 503,
  );
});

void test('FLOW dashboard rejects excessive hidden collection entries', async () => {
  await (await flowDatabase()).prepare('DELETE FROM consulting_flows').run();
  const flow = await fixture();
  await replaceStoredFlow(flow.caseId, (payload) => ({
    ...payload,
    commandIds: [
      ...(payload.commandIds as string[]),
      ...Array.from(
        { length: FLOW_COLLECTION_LIMITS.commandIds },
        (_, index) => `dashboard-excess-${index}`,
      ),
    ],
  }));
  await assert.rejects(
    stateWithConsultingFlows(await readPortalState()),
    (error) => error instanceof FlowError && error.status === 503,
  );
});

void test('FLOW detail and dashboard share SQLite Unicode code-point limits', async () => {
  await (await flowDatabase()).prepare('DELETE FROM consulting_flows').run();
  const flow = await fixture();
  await replaceStoredFlow(flow.caseId, (payload) => {
    const audit = payload.audit as Array<Record<string, unknown>>;
    audit[0].detail = '😀'.repeat(FLOW_TEXT_LIMITS.auditDetail);
    return payload;
  });
  const stored = await readFlow(flow.caseId);
  assert.ok(stored);
  assert.equal(
    stored.audit[0].detail,
    '😀'.repeat(FLOW_TEXT_LIMITS.auditDetail),
  );
  await stateWithConsultingFlows(await readPortalState());

  await replaceStoredFlow(flow.caseId, (payload) => {
    const audit = payload.audit as Array<Record<string, unknown>>;
    audit[0].detail += '😀';
    return payload;
  });
  await assert.rejects(
    readFlow(flow.caseId),
    (error) => error instanceof FlowError && error.status === 503,
  );
  await assert.rejects(
    stateWithConsultingFlows(await readPortalState()),
    (error) => error instanceof FlowError && error.status === 503,
  );
});

void test('FLOW detail and dashboard reject unpaired UTF-16 surrogates', async () => {
  const corruptions: Array<(payload: Record<string, unknown>) => void> = [
    (payload) => {
      const audit = payload.audit as Array<Record<string, unknown>>;
      audit[0].detail = `손상 문자열\ud800`;
    },
    (payload) => {
      payload[`unknown\udc00`] = '손상 확장 키';
    },
  ];
  for (const corrupt of corruptions) {
    await (await flowDatabase()).prepare('DELETE FROM consulting_flows').run();
    const flow = await fixture();
    await replaceStoredFlow(flow.caseId, (payload) => {
      corrupt(payload);
      return payload;
    });
    await assert.rejects(
      readFlow(flow.caseId),
      (error) => error instanceof FlowError && error.status === 503,
    );
    await assert.rejects(
      stateWithConsultingFlows(await readPortalState()),
      (error) => error instanceof FlowError && error.status === 503,
    );
  }
});

void test('FLOW detail and dashboard reject undefined root and hidden nested properties', async () => {
  const corruptions: Array<(payload: Record<string, unknown>) => void> = [
    (payload) => {
      payload.futurePrivateValue = '숨김 루트 값';
    },
    (payload) => {
      const reports = payload.reports as Array<Record<string, unknown>>;
      reports[0].futurePrivateValue = '숨김 보고서 값';
    },
    (payload) => {
      const audit = payload.audit as Array<Record<string, unknown>>;
      audit[0].futurePrivateValue = '숨김 감사 값';
    },
  ];
  for (const corrupt of corruptions) {
    await (await flowDatabase()).prepare('DELETE FROM consulting_flows').run();
    const flow = await fixture();
    await replaceStoredFlow(flow.caseId, (payload) => {
      corrupt(payload);
      return payload;
    });
    await assert.rejects(
      readFlow(flow.caseId),
      (error) => error instanceof FlowError && error.status === 503,
    );
    await assert.rejects(
      stateWithConsultingFlows(await readPortalState()),
      (error) => error instanceof FlowError && error.status === 503,
    );
  }
});

void test('FLOW dashboard rejects malformed or oversized fields removed by SQLite projection', async () => {
  const corruptions: Array<{
    label: string;
    apply: (payload: Record<string, unknown>) => void;
  }> = [
    {
      label: 'report body',
      apply: (payload) => {
        const reports = payload.reports as Array<Record<string, unknown>>;
        reports[0].body = '가'.repeat(FLOW_TEXT_LIMITS.reportBody + 1);
      },
    },
    {
      label: 'AI source text',
      apply: (payload) => {
        (payload.ai as Record<string, unknown>).sourceText = '가'.repeat(
          FLOW_TEXT_LIMITS.aiSourceText + 1,
        );
      },
    },
    {
      label: 'audit detail',
      apply: (payload) => {
        const audit = payload.audit as Array<Record<string, unknown>>;
        audit[0].detail = '가'.repeat(FLOW_TEXT_LIMITS.auditDetail + 1);
      },
    },
    {
      label: 'job reason',
      apply: (payload) => {
        (payload.jobs as Array<Record<string, unknown>>).push({
          id: 'oversized-hidden-job',
          stage: 1,
          status: 'queued',
          reason: '가'.repeat(FLOW_TEXT_LIMITS.jobReason + 1),
          createdAt: payload.updatedAt,
        });
      },
    },
    {
      label: 'file storage key',
      apply: (payload) => {
        (payload.files as Array<Record<string, unknown>>).push({
          id: 'oversized-hidden-file',
          name: 'synthetic.txt',
          contentType: 'text/plain',
          size: 1,
          key: 'k'.repeat(601),
          createdAt: payload.updatedAt,
          purpose: 'source_archived',
        });
      },
    },
    {
      label: 'recording transcript',
      apply: (payload) => {
        (payload.meetings as Array<Record<string, unknown>>).push({
          id: 'hidden-meeting',
          kind: 'followup',
          startsAt: '2026-09-05T01:00:00.000Z',
          endsAt: '2026-09-05T02:00:00.000Z',
          location: '온라인',
          attendance: 'admin',
          status: 'completed',
          completedAt: '2026-09-05T02:00:00.000Z',
          note: '',
          createdBy: adminEmail,
        });
        (payload.recordings as Array<Record<string, unknown>>).push({
          id: 'oversized-hidden-recording',
          meetingId: 'hidden-meeting',
          transcript: '가'.repeat(FLOW_TEXT_LIMITS.transcript + 1),
          consentAt: '2026-09-05T02:00:00.000Z',
          createdAt: '2026-09-05T02:00:00.000Z',
        });
      },
    },
    {
      label: 'command ID',
      apply: (payload) => {
        (payload.commandIds as string[])[0] = 'c'.repeat(201);
      },
    },
    {
      label: 'command receipt actor',
      apply: (payload) => {
        const commandId = (payload.commandIds as string[])[0];
        payload.commandReceipts = {
          [commandId]: {
            actorKey: 'a'.repeat(501),
            fingerprint: 'synthetic-fingerprint',
          },
        };
      },
    },
    {
      label: 'hidden job stage',
      apply: (payload) => {
        (payload.jobs as Array<Record<string, unknown>>).push({
          id: 'malformed-hidden-job',
          stage: 9,
          status: 'queued',
          reason: '',
          createdAt: payload.updatedAt,
        });
      },
    },
    {
      label: 'duplicate hidden file ID',
      apply: (payload) => {
        const files = payload.files as Array<Record<string, unknown>>;
        for (const suffix of ['a', 'b'])
          files.push({
            id: 'duplicate-hidden-file',
            name: `synthetic-${suffix}.txt`,
            contentType: 'text/plain',
            size: 1,
            key: `synthetic/${suffix}`,
            createdAt: payload.updatedAt,
            purpose: 'source_archived',
          });
      },
    },
    {
      label: 'duplicate hidden audit ID',
      apply: (payload) => {
        const audit = payload.audit as Array<Record<string, unknown>>;
        audit.push({ ...audit[0] });
      },
    },
    {
      label: 'duplicate hidden command ID',
      apply: (payload) => {
        const commandIds = payload.commandIds as string[];
        commandIds.push(commandIds[0]);
      },
    },
  ];

  for (const corruption of corruptions) {
    await (await flowDatabase()).prepare('DELETE FROM consulting_flows').run();
    const flow = await fixture();
    await replaceStoredFlow(flow.caseId, (payload) => {
      corruption.apply(payload);
      return payload;
    });
    await assert.rejects(
      stateWithConsultingFlows(await readPortalState()),
      (error) => error instanceof FlowError && error.status === 503,
      corruption.label,
    );
  }
});

void test('FLOW dashboard rejects blank or invalid-date fields removed by SQLite projection', async () => {
  const addFile = (
    payload: Record<string, unknown>,
    overrides: Record<string, unknown>,
  ) => {
    (payload.files as Array<Record<string, unknown>>).push({
      id: 'semantic-hidden-file',
      name: 'synthetic.txt',
      contentType: 'text/plain',
      size: 1,
      key: 'synthetic/semantic-hidden-file',
      createdAt: payload.updatedAt,
      purpose: 'source_archived',
      ...overrides,
    });
  };
  const addRecording = (
    payload: Record<string, unknown>,
    overrides: Record<string, unknown>,
  ) => {
    (payload.meetings as Array<Record<string, unknown>>).push({
      id: 'semantic-hidden-meeting',
      kind: 'followup',
      startsAt: '2026-09-05T01:00:00.000Z',
      endsAt: '2026-09-05T02:00:00.000Z',
      location: '온라인',
      attendance: 'admin',
      status: 'completed',
      completedAt: '2026-09-05T02:00:00.000Z',
      note: '',
      createdBy: adminEmail,
    });
    (payload.recordings as Array<Record<string, unknown>>).push({
      id: 'semantic-hidden-recording',
      meetingId: 'semantic-hidden-meeting',
      transcript: '',
      consentAt: '2026-09-05T02:00:00.000Z',
      createdAt: '2026-09-05T02:00:00.000Z',
      ...overrides,
    });
  };
  const corruptions: Array<{
    label: string;
    apply: (payload: Record<string, unknown>) => void;
  }> = [
    {
      label: 'blank report title',
      apply: (payload) => {
        (payload.reports as Array<Record<string, unknown>>)[0].title = ' \t';
      },
    },
    {
      label: 'blank report author',
      apply: (payload) => {
        (payload.reports as Array<Record<string, unknown>>)[0].createdBy =
          '\u00a0';
      },
    },
    {
      label: 'invalid report timestamp',
      apply: (payload) => {
        (payload.reports as Array<Record<string, unknown>>)[0].createdAt =
          'not-a-date';
      },
    },
    {
      label: 'blank file storage key',
      apply: (payload) => addFile(payload, { key: '\u3000' }),
    },
    {
      label: 'blank file reviewer',
      apply: (payload) => addFile(payload, { sourceReviewedBy: ' \r\n' }),
    },
    {
      label: 'invalid file timestamp',
      apply: (payload) => addFile(payload, { createdAt: 'not-a-date' }),
    },
    {
      label: 'blank recording reviewer',
      apply: (payload) =>
        addRecording(payload, { transcriptReviewedBy: '\ufeff' }),
    },
    {
      label: 'invalid recording consent timestamp',
      apply: (payload) => addRecording(payload, { consentAt: 'not-a-date' }),
    },
    {
      label: 'invalid job processing timestamp',
      apply: (payload) => {
        (payload.jobs as Array<Record<string, unknown>>).push({
          id: 'semantic-hidden-job',
          stage: 1,
          status: 'processing',
          reason: '',
          createdAt: payload.updatedAt,
          startedAt: 'not-a-date',
        });
      },
    },
    {
      label: 'reversed job processing timestamp',
      apply: (payload) => {
        (payload.jobs as Array<Record<string, unknown>>).push({
          id: 'semantic-hidden-job',
          stage: 1,
          status: 'processing',
          reason: '',
          createdAt: '2026-09-05T02:00:00.000Z',
          startedAt: '2026-09-05T01:00:00.000Z',
        });
      },
    },
    {
      label: 'blank audit actor',
      apply: (payload) => {
        (payload.audit as Array<Record<string, unknown>>)[0].actor = '\u2007';
      },
    },
    {
      label: 'blank audit detail',
      apply: (payload) => {
        (payload.audit as Array<Record<string, unknown>>)[0].detail = '   ';
      },
    },
    {
      label: 'invalid audit timestamp',
      apply: (payload) => {
        (payload.audit as Array<Record<string, unknown>>)[0].at = 'not-a-date';
      },
    },
    {
      label: 'blank command ID',
      apply: (payload) => {
        (payload.commandIds as string[]).push('\u202f');
      },
    },
    {
      label: 'blank command receipt values',
      apply: (payload) => {
        const commandId = (payload.commandIds as string[])[0];
        payload.commandReceipts = {
          [commandId]: { actorKey: '\u205f', fingerprint: '\u1680' },
        };
      },
    },
  ];

  for (const corruption of corruptions) {
    await (await flowDatabase()).prepare('DELETE FROM consulting_flows').run();
    const flow = await fixture();
    await replaceStoredFlow(flow.caseId, (payload) => {
      corruption.apply(payload);
      return payload;
    });
    await assert.rejects(
      stateWithConsultingFlows(await readPortalState()),
      (error) => error instanceof FlowError && error.status === 503,
      corruption.label,
    );
  }
});

void test('FLOW command denies a partner suspended while the request body is read', async () => {
  const flow = await fixture();
  const req = request(
    flow.caseId,
    { type: 'confirm_analysis', reportId: flow.reports[0].id },
    flow.revision,
    undefined,
    partner.email,
  );
  const stream = req.body!,
    getReader = stream.getReader.bind(stream);
  Object.defineProperty(stream, 'getReader', {
    value: () => {
      const reader = getReader(),
        read = reader.read.bind(reader);
      let once = true;
      reader.read = async () => {
        if (once) {
          once = false;
          await suspend();
        }
        return read();
      };
      return reader;
    },
  });
  assert.equal((await POST(req, context(flow.caseId))).status, 403);
  assert.deepEqual(await readFlow(flow.caseId), flow);
});

void test('FLOW commit rejects a suspension immediately before D1 writes', async () => {
  const flow = await fixture(),
    db = await flowDatabase(),
    prepare = db.prepare.bind(db);
  let once = true;
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, key) {
        if (key === 'bind')
          return (...values: unknown[]) => wrap(target.bind(...values));
        if (key === 'run')
          return async () => {
            if (once) {
              once = false;
              await suspend();
            }
            return target.run();
          };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  db.prepare = (sql: string) =>
    sql.startsWith('UPDATE consulting_flows SET')
      ? wrap(prepare(sql))
      : prepare(sql);
  try {
    assert.ok(
      [403, 409].includes(
        (
          await POST(
            request(
              flow.caseId,
              { type: 'confirm_analysis', reportId: flow.reports[0].id },
              flow.revision,
              undefined,
              partner.email,
            ),
            context(flow.caseId),
          )
        ).status,
      ),
    );
  } finally {
    db.prepare = prepare;
  }
  assert.deepEqual(await readFlow(flow.caseId), flow);
});

void test('FLOW duplicate keys reject changed command contents and another actor', async () => {
  await readDuplicateRequestSummary();
  await (
    await flowDatabase()
  )
    .prepare('DELETE FROM portal_duplicate_request_stats')
    .run();
  const flow = await fixture(),
    commandId = `flow-safety-${++sequence}`;
  const command = { type: 'confirm_analysis', reportId: flow.reports[0].id };
  assert.equal(
    (
      await POST(
        request(flow.caseId, command, flow.revision, commandId),
        context(flow.caseId),
      )
    ).status,
    200,
  );
  const saved = await readFlow(flow.caseId);
  assert.equal(
    (
      await POST(
        request(
          flow.caseId,
          { type: 'save_report', stage: 1, body },
          flow.revision,
          commandId,
        ),
        context(flow.caseId),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await POST(
        request(flow.caseId, command, flow.revision, commandId, partner.email),
        context(flow.caseId),
      )
    ).status,
    403,
  );
  const exactRetry = await POST(
    request(flow.caseId, command, flow.revision, commandId),
    context(flow.caseId),
  );
  assert.equal(exactRetry.status, 200);
  assert.equal(
    ((await exactRetry.json()) as { duplicate?: boolean }).duplicate,
    true,
  );
  await flushWaitUntil();
  const summary = await readDuplicateRequestSummary();
  assert.equal(summary.totalSafeRetries, 1);
  assert.equal(summary.totalRequestKeyConflicts, 2);
  assert.deepEqual(await readFlow(flow.caseId), saved);
});

void test('FLOW report retry validates file bytes and body but accepts an identical lost response retry', async () => {
  const flow = await fixture(),
    commandId = `flow-safety-${++sequence}`;
  const command = { type: 'save_report', stage: 1, body, fileConsent: true };
  const file = (type = 'text/html') =>
    new File(['SYNTHETIC_REPORT'], 'report.txt', { type });
  assert.equal(
    (
      await POST(
        request(
          flow.caseId,
          command,
          flow.revision,
          commandId,
          adminEmail,
          file(),
        ),
        context(flow.caseId),
      )
    ).status,
    200,
  );
  const saved = await readFlow(flow.caseId);
  assert.equal(saved?.files[0].contentType, 'text/plain');
  assert.deepEqual(
    Object.keys(saved?.commandReceipts?.[commandId] ?? {}).sort(),
    ['actorKey', 'fingerprint'],
  );
  assert.equal(
    (
      await POST(
        request(
          flow.caseId,
          { ...command, body: body + '수정' },
          flow.revision,
          commandId,
          adminEmail,
          file(),
        ),
        context(flow.caseId),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await POST(
        request(
          flow.caseId,
          command,
          flow.revision,
          commandId,
          adminEmail,
          new File(['CHANGED_REPORT'], 'report.txt', { type: 'text/plain' }),
        ),
        context(flow.caseId),
      )
    ).status,
    409,
  );
  const retry = await POST(
    request(
      flow.caseId,
      command,
      flow.revision,
      commandId,
      adminEmail,
      file('application/x-alternate-text'),
    ),
    context(flow.caseId),
  );
  assert.equal(retry.status, 200);
  assert.equal(
    ((await retry.json()) as { duplicate: boolean }).duplicate,
    true,
  );
  assert.deepEqual(await readFlow(flow.caseId), saved);
});

void test('FLOW retry accepts a matching receipt saved before MIME normalization', async () => {
  const flow = await fixture();
  const commandId = `flow-safety-${++sequence}`;
  const command = {
    type: 'save_report',
    stage: 1,
    body,
    fileConsent: true,
  } as const;
  const file = new File(['SYNTHETIC_LEGACY_RECEIPT'], 'legacy.txt', {
    type: 'text/html',
  });
  const user: PortalUser = {
    id: adminEmail,
    email: adminEmail,
    displayName: '가상 대표',
    role: 'admin',
    memberId: null,
    memberName: null,
    permissions: null,
  };
  const receipt = await flowCommandReceipt(user, { command, file });
  assert.ok(receipt.legacyFingerprints?.length);
  const previousReleaseFlow = structuredClone(flow);
  previousReleaseFlow.commandIds.push(commandId);
  previousReleaseFlow.commandReceipts = {
    ...previousReleaseFlow.commandReceipts,
    [commandId]: {
      actorKey: receipt.actorKey,
      fingerprint: receipt.legacyFingerprints[0],
    },
  };
  assert.equal(
    isFlowCommandRetry(previousReleaseFlow, commandId, receipt),
    true,
  );
});

void test('FLOW receipt normalizes NFC/NFD filenames and resumes a raw NFD receipt', async () => {
  const flow = await fixture();
  const commandId = `flow-safety-${++sequence}`;
  const command = {
    type: 'save_report',
    stage: 1,
    body,
    fileConsent: true,
  } as const;
  const user: PortalUser = {
    id: adminEmail,
    email: adminEmail,
    displayName: '가상 대표',
    role: 'admin',
    memberId: null,
    memberName: null,
    permissions: null,
  };
  const nfcName = '분석자료.txt'.normalize('NFC');
  const nfdReceipt = await flowCommandReceipt(user, {
    command,
    file: new File(['SYNTHETIC_UNICODE_RECEIPT'], nfcName.normalize('NFD'), {
      type: 'text/plain',
    }),
  });
  const nfcReceipt = await flowCommandReceipt(user, {
    command,
    file: new File(['SYNTHETIC_UNICODE_RECEIPT'], nfcName, {
      type: 'text/plain',
    }),
  });
  assert.equal(nfdReceipt.fingerprint, nfcReceipt.fingerprint);
  const rawNfdFingerprint = nfdReceipt.legacyFingerprints?.find((fingerprint) =>
    nfcReceipt.legacyFingerprints?.includes(fingerprint),
  );
  assert.ok(rawNfdFingerprint);
  const previousReleaseFlow = structuredClone(flow);
  previousReleaseFlow.commandIds.push(commandId);
  previousReleaseFlow.commandReceipts = {
    ...previousReleaseFlow.commandReceipts,
    [commandId]: {
      actorKey: nfcReceipt.actorKey,
      fingerprint: rawNfdFingerprint,
    },
  };
  assert.equal(
    isFlowCommandRetry(previousReleaseFlow, commandId, nfcReceipt),
    true,
  );
});

void test('FLOW browser retry key follows canonical names and bytes, not file timestamps', async () => {
  const command = {
    type: 'save_report',
    stage: 1,
    body,
    fileConsent: true,
  } as const;
  const nfcName = '재시도자료.txt'.normalize('NFC');
  const first = new File(['SAME_BYTES'], nfcName.normalize('NFD'), {
    type: 'text/html',
    lastModified: 100,
  });
  const reselected = new File(['SAME_BYTES'], nfcName, {
    type: 'application/x-alternate-text',
    lastModified: 200,
  });
  assert.equal(
    await flowCommandRetryKey(command, first),
    await flowCommandRetryKey(command, reselected),
  );
  assert.notEqual(
    await flowCommandRetryKey(
      command,
      new File(['AAAA'], nfcName, { lastModified: 300 }),
    ),
    await flowCommandRetryKey(
      command,
      new File(['BBBB'], nfcName, { lastModified: 300 }),
    ),
  );
});

void test('FLOW attachment download rechecks suspension after R2 resolves', async () => {
  const flow = await fixture();
  const response = await POST(
    request(
      flow.caseId,
      { type: 'save_report', stage: 1, body, fileConsent: true },
      flow.revision,
      undefined,
      adminEmail,
      new File(['SYNTHETIC_ORIGINAL'], 'report.txt', { type: 'text/plain' }),
    ),
    context(flow.caseId),
  );
  assert.equal(response.status, 200);
  const saved = (await readFlow(flow.caseId))!,
    file = saved.files[0],
    bucket = flowBucket(),
    get = bucket.get.bind(bucket);
  bucket.get = async (...args: Parameters<R2Bucket['get']>) => {
    const object = await get(...args);
    await suspend();
    return object;
  };
  try {
    assert.equal(
      (
        await download(
          request(flow.caseId, undefined, 0, undefined, partner.email),
          { params: Promise.resolve({ caseId: flow.caseId, fileId: file.id }) },
        )
      ).status,
      403,
    );
  } finally {
    bucket.get = get;
  }
  assert.ok(await bucket.get(file.key));
  assert.deepEqual(await readFlow(flow.caseId), saved);
});

void test('FLOW attachment download rejects an R2 body whose size differs from stored metadata', async () => {
  const { saved, file } = await fixtureWithAttachment(),
    bucket = flowBucket();
  await bucket.put(file.key, 'BAD');
  const response = await download(request(saved.caseId, undefined), {
    params: Promise.resolve({ caseId: saved.caseId, fileId: file.id }),
  });
  assert.equal(response.status, 409, await response.clone().text());
  assert.match(
    ((await response.json()) as { error: string }).error,
    /보관 상태/,
  );
  assert.deepEqual(await readFlow(saved.caseId), saved);
  assert.equal((await bucket.head(file.key))?.size, 3);
});

void test('FLOW attachment download rejects a stored size change committed while R2 resolves', async () => {
  const { saved, file } = await fixtureWithAttachment(),
    bucket = flowBucket(),
    get = bucket.get.bind(bucket);
  bucket.get = async (...args: Parameters<R2Bucket['get']>) => {
    const object = await get(...args);
    const current = (await readFlow(saved.caseId))!,
      changed = structuredClone(current);
    changed.files[0].size += 1;
    changed.revision += 1;
    changed.updatedAt = new Date().toISOString();
    await commitFlow(current, changed);
    return object;
  };
  try {
    const response = await download(request(saved.caseId, undefined), {
      params: Promise.resolve({ caseId: saved.caseId, fileId: file.id }),
    });
    assert.equal(response.status, 409, await response.clone().text());
  } finally {
    bucket.get = get;
  }
  assert.equal((await readFlow(saved.caseId))!.files[0].size, file.size + 1);
  assert.equal((await bucket.head(file.key))?.size, file.size);
});

void test('all representative-only FLOW commands refuse partners without mutation or network calls', async () => {
  const flow = await fixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('No external calls permitted');
  };
  try {
    for (const type of [
      'import_intake_source',
      'save_source',
      'exclude_source',
      'set_ai_policy',
      'queue_report1',
      'save_report',
      'retry_job',
      'confirm_solutions',
      'request_document',
      'review_document',
      'confirm_payment',
      'start_aftercare',
    ]) {
      const response = await POST(
        request(flow.caseId, { type }, flow.revision, undefined, partner.email),
        context(flow.caseId),
      );
      assert.equal(
        response.status,
        403,
        `${type}: ${await response.clone().text()}`,
      );
    }
    for (const email of [
      'other-flow@example.invalid',
      'unknown-flow@example.invalid',
    ])
      assert.equal(
        (
          await GET(
            request(flow.caseId, undefined, 0, undefined, email),
            context(flow.caseId),
          )
        ).status,
        403,
      );
    assert.deepEqual(await readFlow(flow.caseId), flow);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
