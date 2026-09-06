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
  reportLabels,
  type ConsultingFlow,
} from '../lib/consulting-flow';
import {
  commitFlow,
  readFlow,
  flowBucket,
  flowDatabase,
  flowFileObjectBinding,
  stateWithConsultingFlows,
} from '../lib/consulting-flow-store';
import { readPortalState, writePortalState } from '../lib/portal-state';
import { readDuplicateRequestSummary } from '../lib/duplicate-request-metrics';
import { flushWaitUntil } from './runtime-mock.mjs';
import {
  FLOW_ADMIN_COMMAND_ACTOR_KEY,
  FLOW_ADMIN_COMMAND_ACTOR_NAME,
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
import { flowFileStorageKey } from '../lib/consulting-flow-file-policy';
import { claimFlowJob, finishFlowJob } from '../lib/consulting-flow-jobs';
import {
  consultingFlowFileMetadataBackfillSql,
  consultingFlowFileOwnersBackfillSql,
  consultingFlowsCommandInsertScopeTriggerSql,
  consultingFlowsSetAiPolicyJobsTriggerSql,
} from '../db/schema';
import { deleteFlowFileLedgerFixture } from './flow-file-ledger-fixture';
import {
  deleteConsultingFlowFixture,
  mutateConsultingFlowFixture,
} from './flow-root-fixture';

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
async function storeFlowFileBinding(
  file: ConsultingFlow['files'][number],
  body: Parameters<R2Bucket['put']>[1],
) {
  const object = await flowBucket().put(file.key, body, {
    httpMetadata: { contentType: file.contentType },
  });
  return new Map([[file.id, flowFileObjectBinding(file, object)]]);
}

function addSyntheticCommandReceipt(flow: ConsultingFlow, commandId: string) {
  const audit = flow.audit.find(
    (entry) => entry.id === commandId && entry.action !== 'ai_result',
  );
  assert.ok(audit);
  audit.actor = FLOW_ADMIN_COMMAND_ACTOR_NAME;
  flow.commandReceipts = {
    ...flow.commandReceipts,
    [commandId]: {
      actorKey: FLOW_ADMIN_COMMAND_ACTOR_KEY,
      fingerprint: 'a'.repeat(64),
      actor: audit.actor,
      action: audit.action,
    },
  };
}

function addSyntheticAiReport(
  flow: ConsultingFlow,
  job: ConsultingFlow['jobs'][number],
  at: string,
) {
  const report = {
    id: `${job.id}-result`,
    stage: job.stage,
    version:
      flow.reports.filter((existing) => existing.stage === job.stage).length +
      1,
    title: reportLabels[job.stage],
    body,
    ...(job.stage === 4
      ? {
          sourceReportId: job.sourceReportId,
          sourceRecordingId: job.sourceRecordingId,
        }
      : {}),
    createdAt: at,
    createdBy: 'Claude · 대표 검토 전',
    origin: 'ai' as const,
  };
  flow.reports.push(report);
  job.reportId = report.id;
  if (job.stage === 1) flow.analysis = { reportId: report.id };
  return report;
}

async function queuedReportFixture(withSourceFile: boolean) {
  const source = 'SYNTHETIC INTERNAL SOURCE FOR LOCAL REGRESSION ONLY';
  let flow = await fixture();
  const sourceAt = new Date(Date.parse(flow.updatedAt) + 1).toISOString();
  const sourceCommandId = `queued-source-${++sequence}`;
  const sourceFile = withSourceFile
    ? {
        id: `queued-source-file-${++sequence}`,
        purpose: 'source' as const,
        name: 'source.txt',
        contentType: 'text/plain',
        size: source.length,
        key: flowFileStorageKey(`queued-source-file-${sequence}`),
        createdAt: sourceAt,
      }
    : undefined;
  const sourced = applyFlowCommand(
    flow,
    { type: 'save_source', sourceText: source, privacyMasked: true },
    { id: adminEmail, role: 'admin', name: FLOW_ADMIN_COMMAND_ACTOR_NAME },
    { commandId: sourceCommandId, now: sourceAt, upload: sourceFile },
  );
  addSyntheticCommandReceipt(sourced, sourceCommandId);
  await commitFlow(
    flow,
    sourced,
    undefined,
    sourceFile ? await storeFlowFileBinding(sourceFile, source) : undefined,
  );
  flow = sourced;
  const policyCommandId = `queued-policy-${++sequence}`;
  const policy = applyFlowCommand(
    flow,
    {
      type: 'set_ai_policy',
      enabled: true,
      thirdPartyConsent: true,
      privacyMasked: true,
      costConsent: true,
    },
    { id: adminEmail, role: 'admin', name: FLOW_ADMIN_COMMAND_ACTOR_NAME },
    {
      commandId: policyCommandId,
      now: new Date(Date.parse(flow.updatedAt) + 1).toISOString(),
    },
  );
  addSyntheticCommandReceipt(policy, policyCommandId);
  await commitFlow(flow, policy);
  flow = policy;
  const queueCommandId = `queued-report-${++sequence}`;
  const queued = applyFlowCommand(
    flow,
    { type: 'queue_report1' },
    { id: adminEmail, role: 'admin', name: FLOW_ADMIN_COMMAND_ACTOR_NAME },
    {
      commandId: queueCommandId,
      now: new Date(Date.parse(flow.updatedAt) + 1).toISOString(),
    },
  );
  addSyntheticCommandReceipt(queued, queueCommandId);
  await commitFlow(flow, queued);
  return queued;
}

async function transcriptJobFixture(failed = false) {
  const stored = await fixture();
  const prepared = structuredClone(stored);
  const at = stored.updatedAt;
  const startsAt = new Date(Date.parse(at) - 120_000).toISOString();
  const endsAt = new Date(Date.parse(at) - 60_000).toISOString();
  const meetingId = `transcript-meeting-${++sequence}`;
  const recordingId = `transcript-recording-${++sequence}`;
  const targetJobId = `transcript-target-job-${++sequence}`;
  prepared.ai = {
    ...prepared.ai,
    enabled: true,
    approvedAt: at,
    approvedBy: adminEmail,
  };
  prepared.meetings.push({
    id: meetingId,
    kind: 'first',
    startsAt,
    endsAt,
    attendance: 'both',
    location: '가상 상담실',
    status: 'completed',
    note: '',
    createdBy: adminEmail,
    completedAt: at,
  });
  prepared.recordings.push({
    id: recordingId,
    meetingId,
    transcript: '',
    consentAt: at,
    createdAt: at,
  });
  const targetJob: ConsultingFlow['jobs'][number] = {
    id: targetJobId,
    stage: 4,
    sourceRecordingId: recordingId,
    sourceReportId: prepared.reports.at(-1)!.id,
    status: failed ? 'failed' : 'blocked',
    reason: failed ? '가상 공급자 오류' : '보조 음성의 전사문이 필요합니다.',
    createdAt: failed ? startsAt : at,
    ...(failed
      ? {
          startedAt: endsAt,
          failureEvidence: {
            auditId: `${targetJobId}-${at}`,
            instructionVersion: 'synthetic-flow-instruction-v1',
            requestedModel: 'claude-synthetic-model',
            httpStatus: 429,
            observedAt: at,
            providerRequestId: 'req_transcript_job_failure',
          },
          failureEvidenceHistory: [
            {
              auditId: `${targetJobId}-${endsAt}`,
              instructionVersion: 'synthetic-flow-instruction-v1',
              requestedModel: 'claude-synthetic-model',
              httpStatus: 503,
              observedAt: endsAt,
              providerRequestId: 'req_transcript_job_history',
            },
          ],
        }
      : {}),
  };
  prepared.jobs.push(
    {
      id: `transcript-unrelated-job-${++sequence}`,
      stage: 1,
      status: 'blocked',
      reason: '기존 독립 작업 보류',
      createdAt: at,
    },
    targetJob,
  );
  if (failed)
    prepared.audit.push(
      {
        id: `${targetJobId}-${endsAt}`,
        at: endsAt,
        actor: '보고서 자동생성',
        action: 'ai_result',
        detail: '4차 심화분석보고서 실패 · 과거 가상 공급자 오류',
      },
      {
        id: `${targetJobId}-${at}`,
        at,
        actor: '보고서 자동생성',
        action: 'ai_result',
        detail: '4차 심화분석보고서 실패 · 가상 공급자 오류',
      },
    );
  const db = await flowDatabase();
  await mutateConsultingFlowFixture(
    db,
    'UPDATE consulting_flows SET payload = ?1 WHERE case_id = ?2',
    [JSON.stringify(prepared), prepared.caseId],
  );
  return (await readFlow(prepared.caseId))!;
}

void test('FLOW stops a queued model request when the caller is suspended during source preparation', async () => {
  const queued = await queuedReportFixture(true);
  const bucket = flowBucket(),
    get = bucket.get.bind(bucket),
    runtime = env as unknown as Record<string, unknown>;
  const previousKey = runtime.ANTHROPIC_API_KEY,
    fetch = globalThis.fetch;
  let calls = 0;
  runtime.ANTHROPIC_API_KEY = 'SYNTHETIC_NOT_A_REAL_KEY';
  globalThis.fetch = async () => {
    calls++;
    return Response.json(
      {
        id: 'msg_suspended_flow',
        type: 'message',
        role: 'assistant',
        model: 'claude-synthetic-response-model',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: body + '[분석 끝]' }],
        usage: { input_tokens: 10, output_tokens: 20 },
      },
      { headers: { 'request-id': 'req_suspended_flow' } },
    );
  };
  bucket.get = async (...args: Parameters<R2Bucket['get']>) => {
    const object = await get(...args);
    await suspend();
    return object;
  };
  try {
    await run(
      request(queued.caseId, {}, 0, undefined, partner.email),
      context(queued.caseId),
    );
    assert.equal(calls, 0);
    const stored = (await readFlow(queued.caseId))!;
    assert.equal(stored.reports.length, queued.reports.length);
    assert.notEqual(stored.jobs.at(-1)?.status, 'complete');
  } finally {
    bucket.get = get;
    globalThis.fetch = fetch;
    if (previousKey === undefined) delete runtime.ANTHROPIC_API_KEY;
    else runtime.ANTHROPIC_API_KEY = previousKey;
  }
});

void test('FLOW rejects a decorated oversized AI result without leaving the job processing', async () => {
  const queued = await queuedReportFixture(false);

  const runtime = env as unknown as Record<string, unknown>;
  const previousKey = runtime.ANTHROPIC_API_KEY;
  const previousFetch = globalThis.fetch;
  let calls = 0;
  runtime.ANTHROPIC_API_KEY = 'SYNTHETIC_NOT_A_REAL_KEY';
  globalThis.fetch = async () => {
    calls++;
    return Response.json(
      {
        id: 'msg_flow_report_limit',
        type: 'message',
        role: 'assistant',
        model: 'claude-synthetic-response-model',
        stop_reason: 'end_turn',
        content: [
          {
            type: 'text',
            text: `${'가'.repeat(79990)}\n[분석 끝]`,
          },
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
      },
      { headers: { 'request-id': 'req_oversized_flow' } },
    );
  };
  try {
    const response = await run(
      request(queued.caseId, {}, 0, undefined, adminEmail),
      context(queued.caseId),
    );
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(calls, 1);
    const stored = (await readFlow(queued.caseId))!;
    assert.equal(stored.jobs.at(-1)?.status, 'failed');
    assert.equal(stored.reports.length, queued.reports.length);
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
    key: flowFileStorageKey('synthetic-signed'),
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
  await commitFlow(
    flow,
    signed,
    undefined,
    await storeFlowFileBinding(signed.files[0], new Uint8Array([1])),
  );
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
  const commandId = `fixture-${++sequence}`;
  const flow = applyFlowCommand(
    initial,
    { type: 'save_report', stage: 1, body },
    { id: adminEmail, role: 'admin', name: FLOW_ADMIN_COMMAND_ACTOR_NAME },
    { commandId, now: new Date().toISOString() },
  );
  addSyntheticCommandReceipt(flow, commandId);
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
  await mutateConsultingFlowFixture(
    db,
    'UPDATE consulting_flows SET payload = ?1 WHERE case_id = ?2',
    [JSON.stringify(transform(JSON.parse(row.payload))), caseId],
  );
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
  await mutateConsultingFlowFixture(
    db,
    'UPDATE consulting_flows SET payload = ?1 WHERE case_id = ?2',
    ['{malformed', flow.caseId],
  );
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

void test('FLOW root identity and durable row reject direct D1 rewrite or deletion', async () => {
  const flow = await fixture();
  const db = await flowDatabase();
  for (const [field, value] of [
    ['case_id', `${flow.caseId}-changed`],
    ['partner_id', `${flow.partnerId}-changed`],
  ] as const) {
    await assert.rejects(
      db
        .prepare(`UPDATE consulting_flows SET ${field} = ?1 WHERE case_id = ?2`)
        .bind(value, flow.caseId)
        .run(),
      /flow identity is immutable/,
    );
  }
  await assert.rejects(
    db
      .prepare('DELETE FROM consulting_flows WHERE case_id = ?1')
      .bind(flow.caseId)
      .run(),
    /flow root is durable/,
  );
  assert.deepEqual(await readFlow(flow.caseId), flow);
});

void test('FLOW root insert and revision transition require an atomic D1 envelope', async () => {
  const flow = await fixture();
  const db = await flowDatabase();
  const stored = await db
    .prepare(
      'SELECT revision, payload, updated_at FROM consulting_flows WHERE case_id = ?1',
    )
    .bind(flow.caseId)
    .first<{ revision: number; payload: string; updated_at: string }>();
  assert.ok(stored);

  await assert.rejects(
    db
      .prepare('UPDATE consulting_flows SET payload = ?1 WHERE case_id = ?2')
      .bind(stored.payload, flow.caseId)
      .run(),
    /transition envelope is invalid/,
  );
  await assert.rejects(
    db
      .prepare(
        'UPDATE consulting_flows SET revision = ?1, payload = ?2, updated_at = ?3 WHERE case_id = ?4',
      )
      .bind(stored.revision + 2, stored.payload, stored.updated_at, flow.caseId)
      .run(),
    /transition envelope is invalid/,
  );

  const invalid = newConsultingFlow(
    `flow-invalid-insert-${++sequence}`,
    '가상기업',
    partner.id,
    partner.name,
  );
  await assert.rejects(
    db
      .prepare(
        `INSERT INTO consulting_flows
          (case_id, partner_id, revision, payload, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(
        invalid.caseId,
        invalid.partnerId,
        1,
        JSON.stringify(invalid),
        new Date().toISOString(),
      )
      .run(),
    /insert envelope is invalid/,
  );
  assert.deepEqual(
    await db
      .prepare(
        'SELECT revision, payload, updated_at FROM consulting_flows WHERE case_id = ?1',
      )
      .bind(flow.caseId)
      .first(),
    stored,
  );
  assert.equal(await readFlow(invalid.caseId), null);
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

void test('FLOW commit preserves AI history and changes exactly one internal job target', async () => {
  const initial = await fixture();
  const timestamp = (offset: number) =>
    new Date(Date.parse(initial.updatedAt) + offset).toISOString();
  const queuedAt = timestamp(1);
  const failureQueuedAt = timestamp(2);
  const successStartedAt = timestamp(3);
  const failureStartedAt = timestamp(4);
  const successAt = timestamp(5);
  const historyAt = timestamp(6);
  const retryAt = timestamp(7);
  const restartedAt = timestamp(8);
  const failureAt = timestamp(9);
  const nextAt = timestamp(10);
  const successCreationAuditId = `immutable-success-creation-${++sequence}`;
  const failureCreationAuditId = `immutable-failure-creation-${++sequence}`;
  const successJobId = `${successCreationAuditId}-job`;
  const failureJobId = `${failureCreationAuditId}-job`;
  const successAuditId = `${successJobId}-${successAt}`;
  const failureAuditId = `${failureJobId}-${failureAt}`;
  const historyAuditId = `${failureJobId}-${historyAt}`;
  const successQueued = structuredClone(initial);
  successQueued.revision++;
  successQueued.updatedAt = queuedAt;
  successQueued.jobs.push({
    id: successJobId,
    stage: 1,
    status: 'queued',
    reason: '',
    createdAt: queuedAt,
  });
  successQueued.audit.push({
    id: successCreationAuditId,
    at: queuedAt,
    actor: FLOW_ADMIN_COMMAND_ACTOR_NAME,
    action: 'queue_report1',
    detail: '1차 분석보고서 생성 요청',
  });
  successQueued.commandIds.push(successCreationAuditId);
  addSyntheticCommandReceipt(successQueued, successCreationAuditId);
  await commitFlow(initial, successQueued);
  const queued = structuredClone(successQueued);
  queued.revision++;
  queued.updatedAt = failureQueuedAt;
  queued.jobs.push({
    id: failureJobId,
    stage: 1,
    status: 'queued',
    reason: '',
    createdAt: failureQueuedAt,
  });
  queued.audit.push({
    id: failureCreationAuditId,
    at: failureQueuedAt,
    actor: '가상 대표',
    action: 'queue_report1',
    detail: '1차 분석보고서 생성 요청',
  });
  queued.commandIds.push(failureCreationAuditId);
  addSyntheticCommandReceipt(queued, failureCreationAuditId);
  await commitFlow(successQueued, queued);
  const successProcessing = structuredClone(queued);
  successProcessing.revision++;
  successProcessing.updatedAt = successStartedAt;
  const claimedSuccessJob = successProcessing.jobs.find(
    (job) => job.id === successJobId,
  )!;
  claimedSuccessJob.status = 'processing';
  claimedSuccessJob.startedAt = successStartedAt;
  await commitFlow(queued, successProcessing);
  const processing = structuredClone(successProcessing);
  processing.revision++;
  processing.updatedAt = failureStartedAt;
  const claimedFailureJob = processing.jobs.find(
    (job) => job.id === failureJobId,
  )!;
  claimedFailureJob.status = 'processing';
  claimedFailureJob.startedAt = failureStartedAt;
  await commitFlow(successProcessing, processing);
  const collapsedRetry = structuredClone(processing);
  collapsedRetry.revision++;
  collapsedRetry.updatedAt = historyAt;
  for (const job of collapsedRetry.jobs.slice(-2)) {
    job.status = 'queued';
    job.startedAt = undefined;
  }
  collapsedRetry.audit.push({
    id: `collapsed-retry-audit-${++sequence}`,
    at: historyAt,
    actor: '가상 대표',
    action: 'retry_job',
    detail: '한 감사로 두 작업을 재시도한 손상 fixture',
  });
  await assert.rejects(
    commitFlow(processing, collapsedRetry),
    (error) => error instanceof FlowError && error.status === 503,
  );
  const db = await flowDatabase();
  await assert.rejects(
    db
      .prepare(
        `UPDATE consulting_flows
        SET revision = ?1, payload = ?2, updated_at = ?3
        WHERE case_id = ?4 AND revision = ?5`,
      )
      .bind(
        collapsedRetry.revision,
        JSON.stringify(collapsedRetry),
        collapsedRetry.updatedAt,
        processing.caseId,
        processing.revision,
      )
      .run(),
    /(?:job transition audit|non-command scope|non-command job target) is invalid/,
  );
  const successful = structuredClone(processing);
  successful.revision++;
  successful.updatedAt = successAt;
  const successJob = successful.jobs.find((job) => job.id === successJobId)!;
  successJob.status = 'complete';
  successJob.completedAt = successAt;
  addSyntheticAiReport(successful, successJob, successAt);
  successJob.evidence = {
    auditId: successAuditId,
    instructionVersion: 'synthetic-flow-instruction-v1',
    requestedModel: 'claude-requested-test-model',
    providerRequestId: 'req_immutable_success',
    providerModel: 'claude-resolved-test-model',
    providerMessageId: 'msg_immutable_success',
    inputTokens: 10,
    outputTokens: 20,
    observedAt: successAt,
  };
  successful.audit.push({
    id: successAuditId,
    at: successAt,
    actor: '보고서 자동생성',
    action: 'ai_result',
    detail: '1차 정밀진단보고서 자동 저장 · 담당 파트너 공유',
  });
  await commitFlow(processing, successful);
  const firstResult = structuredClone(successful);
  firstResult.revision++;
  firstResult.updatedAt = historyAt;
  const failedJob = firstResult.jobs.find((job) => job.id === failureJobId)!;
  failedJob.status = 'failed';
  failedJob.reason = '과거 가상 공급자 오류';
  failedJob.failureEvidence = {
    auditId: historyAuditId,
    instructionVersion: 'synthetic-flow-instruction-v1',
    requestedModel: 'claude-requested-test-model',
    httpStatus: 503,
    observedAt: historyAt,
    providerRequestId: 'req_immutable_history',
  };
  firstResult.audit.push({
    id: historyAuditId,
    at: historyAt,
    actor: '보고서 자동생성',
    action: 'ai_result',
    detail: '1차 정밀진단보고서 실패 · 과거 가상 공급자 오류',
  });
  await commitFlow(successful, firstResult);
  const retry = structuredClone(firstResult);
  retry.revision++;
  retry.updatedAt = retryAt;
  const retryJob = retry.jobs.find((job) => job.id === failureJobId)!;
  retryJob.status = 'queued';
  retryJob.reason = '';
  retryJob.startedAt = undefined;
  retryJob.failureEvidenceHistory = [retryJob.failureEvidence!];
  retryJob.failureEvidence = undefined;
  const retryCommandId = `retry-audit-${++sequence}`;
  retry.audit.push({
    id: retryCommandId,
    at: retryAt,
    actor: '가상 대표',
    action: 'retry_job',
    detail: '대표 확인 후 AI 생성 재시도',
  });
  retry.commandIds.push(retryCommandId);
  addSyntheticCommandReceipt(retry, retryCommandId);
  await commitFlow(firstResult, retry);
  const restarted = structuredClone(retry);
  restarted.revision++;
  restarted.updatedAt = restartedAt;
  const restartedJob = restarted.jobs.find((job) => job.id === failureJobId)!;
  restartedJob.status = 'processing';
  restartedJob.startedAt = restartedAt;
  await commitFlow(retry, restarted);
  const failedAgain = structuredClone(restarted);
  failedAgain.revision++;
  failedAgain.updatedAt = failureAt;
  const failedAgainJob = failedAgain.jobs.find(
    (job) => job.id === failureJobId,
  )!;
  failedAgainJob.status = 'failed';
  failedAgainJob.reason = '가상 공급자 오류';
  failedAgainJob.failureEvidence = {
    auditId: failureAuditId,
    instructionVersion: 'synthetic-flow-instruction-v1',
    requestedModel: 'claude-requested-test-model',
    httpStatus: 429,
    observedAt: failureAt,
    providerRequestId: 'req_immutable_failure',
  };
  failedAgain.audit.push({
    id: failureAuditId,
    at: failureAt,
    actor: '보고서 자동생성',
    action: 'ai_result',
    detail: '1차 정밀진단보고서 실패 · 가상 공급자 오류',
  });
  await commitFlow(restarted, failedAgain);
  const stored = (await readFlow(initial.caseId))!;
  const mutations: Array<(flow: ConsultingFlow) => void> = [
    (flow) => {
      flow.jobs.find(
        (job) => job.id === successJobId,
      )!.evidence!.providerModel = 'claude-mutated-test-model';
    },
    (flow) => {
      flow.jobs.find(
        (job) => job.id === failureJobId,
      )!.failureEvidence!.httpStatus = 500;
    },
    (flow) => {
      flow.jobs.find(
        (job) => job.id === failureJobId,
      )!.failureEvidenceHistory![0].providerRequestId = 'req_mutated_history';
    },
    (flow) => {
      flow.audit.find((entry) => entry.id === successAuditId)!.detail =
        '변조된 완료 감사기록';
    },
    (flow) => {
      flow.jobs = flow.jobs.filter((job) => job.id !== successJobId);
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(stored);
    changed.revision++;
    changed.updatedAt = nextAt;
    mutate(changed);
    await assert.rejects(
      commitFlow(stored, changed),
      (error) => error instanceof FlowError && error.status === 503,
    );
    assert.deepEqual(await readFlow(stored.caseId), stored);
  }
});

void test('FLOW commit requires a new AI job to start without terminal evidence', async () => {
  const initial = await fixture();
  const changed = structuredClone(initial);
  const at = new Date(Date.parse(initial.updatedAt) + 1).toISOString();
  const jobId = `invented-complete-job-${++sequence}`;
  const auditId = `${jobId}-${at}`;
  changed.revision++;
  changed.updatedAt = at;
  changed.jobs.push({
    id: jobId,
    stage: 1,
    status: 'complete',
    reason: '',
    createdAt: at,
    startedAt: at,
    completedAt: at,
    reportId: changed.reports[0].id,
    evidence: {
      auditId,
      instructionVersion: 'synthetic-flow-instruction-v1',
      requestedModel: 'claude-requested-test-model',
      providerRequestId: 'req_invented_success',
      providerModel: 'claude-resolved-test-model',
      providerMessageId: 'msg_invented_success',
      inputTokens: 10,
      outputTokens: 20,
      observedAt: at,
    },
  });
  changed.audit.push({
    id: auditId,
    at,
    actor: '보고서 자동생성',
    action: 'ai_result',
    detail: '1차 정밀진단보고서 자동 저장 · 담당 파트너 공유',
  });
  await assert.rejects(
    commitFlow(initial, changed),
    (error) => error instanceof FlowError && error.status === 503,
  );
  assert.deepEqual(await readFlow(initial.caseId), initial);
});

void test('FLOW native D1 keeps existing audit records append-only', async () => {
  const flow = await fixture();
  const changed = structuredClone(flow);
  changed.revision++;
  changed.updatedAt = new Date(Date.parse(flow.updatedAt) + 1).toISOString();
  changed.audit[0].detail = '구조상 정상인 변조 감사기록';
  const db = await flowDatabase();
  await assert.rejects(
    db
      .prepare(
        `UPDATE consulting_flows
        SET revision = ?1, payload = ?2, updated_at = ?3
        WHERE case_id = ?4 AND revision = ?5`,
      )
      .bind(
        changed.revision,
        JSON.stringify(changed),
        changed.updatedAt,
        flow.caseId,
        flow.revision,
      )
      .run(),
    /audit is append-only/,
  );
  assert.deepEqual(await readFlow(flow.caseId), flow);
});

void test('FLOW native D1 rejects terminal AI evidence on the first root insert', async () => {
  const initial = newConsultingFlow(
    `flow-native-insert-job-${++sequence}`,
    '가상기업',
    partner.id,
    partner.name,
  );
  const at = new Date().toISOString();
  const insertedCommandId = `native-insert-${++sequence}`;
  const inserted = applyFlowCommand(
    initial,
    { type: 'save_report', stage: 1, body },
    { id: adminEmail, role: 'admin', name: FLOW_ADMIN_COMMAND_ACTOR_NAME },
    { commandId: insertedCommandId, now: at },
  );
  addSyntheticCommandReceipt(inserted, insertedCommandId);
  const jobId = `native-insert-terminal-${++sequence}`;
  const auditId = `${jobId}-${at}`;
  inserted.jobs.push({
    id: jobId,
    stage: 1,
    status: 'complete',
    reason: '',
    createdAt: at,
    startedAt: at,
    completedAt: at,
    reportId: inserted.reports[0].id,
    evidence: {
      auditId,
      instructionVersion: 'synthetic-flow-instruction-v1',
      requestedModel: 'claude-requested-test-model',
      providerRequestId: 'req_native_insert_terminal',
      providerModel: 'claude-resolved-test-model',
      providerMessageId: 'msg_native_insert_terminal',
      inputTokens: 10,
      outputTokens: 20,
      observedAt: at,
    },
  });
  inserted.audit.push({
    id: auditId,
    at,
    actor: '보고서 자동생성',
    action: 'ai_result',
    detail: '1차 정밀진단보고서 자동 저장 · 담당 파트너 공유',
  });
  const db = await flowDatabase();
  await db
    .prepare(
      'DROP TRIGGER IF EXISTS consulting_flows_command_insert_scope_guard',
    )
    .run();
  try {
    await assert.rejects(
      db
        .prepare(
          `INSERT INTO consulting_flows
          (case_id, partner_id, revision, payload, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5)`,
        )
        .bind(
          inserted.caseId,
          inserted.partnerId,
          inserted.revision,
          JSON.stringify(inserted),
          inserted.updatedAt,
        )
        .run(),
      /(?:initial job(?: origin)?|initial audit cardinality) is invalid/,
    );
  } finally {
    await db.prepare(consultingFlowsCommandInsertScopeTriggerSql).run();
  }
  assert.equal(await readFlow(initial.caseId), null);
  const queuedInitial = newConsultingFlow(
    `flow-native-insert-queued-${++sequence}`,
    '가상기업',
    partner.id,
    partner.name,
  );
  const queued = structuredClone(queuedInitial);
  queued.revision++;
  queued.updatedAt = new Date(Date.parse(at) + 1).toISOString();
  const queuedAuditId = `native-insert-queued-${++sequence}`;
  queued.jobs.push({
    id: `${queuedAuditId}-job`,
    stage: 1,
    status: 'queued',
    reason: '',
    createdAt: queued.updatedAt,
  });
  queued.audit.push({
    id: queuedAuditId,
    at: queued.updatedAt,
    actor: '가상 대표',
    action: 'queue_report1',
    detail: '1차 분석보고서 생성 요청',
  });
  queued.commandIds.push(queuedAuditId);
  addSyntheticCommandReceipt(queued, queuedAuditId);
  const staleQueued = structuredClone(queued);
  staleQueued.jobs[0].createdAt = new Date(
    Date.parse(queued.updatedAt) - 1,
  ).toISOString();
  await assert.rejects(
    db
      .prepare(
        `INSERT INTO consulting_flows
          (case_id, partner_id, revision, payload, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(
        staleQueued.caseId,
        staleQueued.partnerId,
        staleQueued.revision,
        JSON.stringify(staleQueued),
        staleQueued.updatedAt,
      )
      .run(),
    /initial job origin is invalid/,
  );
  const mismatchedQueued = structuredClone(queued);
  mismatchedQueued.jobs[0].id = `native-insert-mismatched-${++sequence}-job`;
  mismatchedQueued.commandIds[0] = mismatchedQueued.jobs[0].id.slice(0, -4);
  await assert.rejects(
    db
      .prepare(
        `INSERT INTO consulting_flows
          (case_id, partner_id, revision, payload, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(
        mismatchedQueued.caseId,
        mismatchedQueued.partnerId,
        mismatchedQueued.revision,
        JSON.stringify(mismatchedQueued),
        mismatchedQueued.updatedAt,
      )
      .run(),
    /(?:(?:initial job audit identity|initial command evidence) is|initial command semantics are) invalid/,
  );
  const extraQueuedAudit = structuredClone(queued);
  extraQueuedAudit.audit.push({
    id: `native-insert-unbound-audit-${++sequence}`,
    at: extraQueuedAudit.updatedAt,
    actor: '가상 실행기',
    action: 'system_note',
    detail: '최초 명령에 결속되지 않은 여분 감사기록',
  });
  await assert.rejects(
    db
      .prepare(
        `INSERT INTO consulting_flows
          (case_id, partner_id, revision, payload, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(
        extraQueuedAudit.caseId,
        extraQueuedAudit.partnerId,
        extraQueuedAudit.revision,
        JSON.stringify(extraQueuedAudit),
        extraQueuedAudit.updatedAt,
      )
      .run(),
    /initial audit cardinality is invalid/,
  );
  await db
    .prepare(
      `INSERT INTO consulting_flows
        (case_id, partner_id, revision, payload, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(
      queued.caseId,
      queued.partnerId,
      queued.revision,
      JSON.stringify(queued),
      queued.updatedAt,
    )
    .run();
  assert.deepEqual(await readFlow(queued.caseId), queued);
  await deleteConsultingFlowFixture(db, queued.caseId);
});

void test('FLOW new AI jobs bind creation time, stage source and audit', async () => {
  const initial = await fixture();
  const at = new Date(Date.parse(initial.updatedAt) + 2).toISOString();
  const auditId = `creation-origin-${++sequence}`;
  const jobId = `${auditId}-job`;
  const valid = structuredClone(initial);
  valid.revision++;
  valid.updatedAt = at;
  valid.jobs.push({
    id: jobId,
    stage: 1,
    status: 'queued',
    reason: '',
    createdAt: at,
  });
  valid.audit.push({
    id: auditId,
    at,
    actor: '가상 대표',
    action: 'queue_report1',
    detail: '1차 분석보고서 생성 요청',
  });
  valid.commandIds.push(auditId);
  addSyntheticCommandReceipt(valid, auditId);
  const invalid = [
    (flow: ConsultingFlow) => {
      flow.jobs.at(-1)!.createdAt = initial.updatedAt;
    },
    (flow: ConsultingFlow) => {
      flow.jobs.at(-1)!.sourceReportId = initial.reports[0].id;
    },
    (flow: ConsultingFlow) => {
      flow.audit.pop();
    },
    (flow: ConsultingFlow) => {
      flow.audit.push({
        id: `unbound-command-audit-${++sequence}`,
        at: flow.updatedAt,
        actor: '가상 실행기',
        action: 'system_note',
        detail: '사용자 명령에 결속되지 않은 여분 감사기록',
      });
    },
  ];
  const db = await flowDatabase();
  for (const mutate of invalid) {
    const changed = structuredClone(valid);
    mutate(changed);
    await assert.rejects(
      commitFlow(initial, changed),
      (error) => error instanceof FlowError && error.status === 503,
    );
    await assert.rejects(
      db
        .prepare(
          `UPDATE consulting_flows
          SET revision = ?1, payload = ?2, updated_at = ?3
          WHERE case_id = ?4 AND revision = ?5`,
        )
        .bind(
          changed.revision,
          JSON.stringify(changed),
          changed.updatedAt,
          initial.caseId,
          initial.revision,
        )
        .run(),
      /(?:(?:job creation (?:origin|audit identity)|new command evidence|audit cardinality) is|command semantics are) invalid/,
    );
    assert.deepEqual(await readFlow(initial.caseId), initial);
  }
  await commitFlow(initial, valid);
  assert.deepEqual(await readFlow(valid.caseId), valid);
});

void test('FLOW new AI job ID binds to one exact creation audit ID', async () => {
  const initial = await fixture();
  const at = new Date(Date.parse(initial.updatedAt) + 2).toISOString();
  const auditId = `creation-identity-${++sequence}`;
  const valid = structuredClone(initial);
  valid.revision++;
  valid.updatedAt = at;
  valid.jobs.push({
    id: `${auditId}-job`,
    stage: 1,
    status: 'queued',
    reason: '',
    createdAt: at,
  });
  valid.audit.push({
    id: auditId,
    at,
    actor: '가상 대표',
    action: 'queue_report1',
    detail: '1차 분석보고서 생성 요청',
  });
  valid.commandIds.push(auditId);
  addSyntheticCommandReceipt(valid, auditId);
  const mismatched = structuredClone(valid);
  mismatched.jobs.at(-1)!.id = `substituted-creation-${++sequence}-job`;
  mismatched.commandIds[mismatched.commandIds.length - 1] = mismatched.jobs
    .at(-1)!
    .id.slice(0, -4);
  await assert.rejects(
    commitFlow(initial, mismatched),
    (error) => error instanceof FlowError && error.status === 503,
  );
  const db = await flowDatabase();
  await assert.rejects(
    db
      .prepare(
        `UPDATE consulting_flows
        SET revision = ?1, payload = ?2, updated_at = ?3
        WHERE case_id = ?4 AND revision = ?5`,
      )
      .bind(
        mismatched.revision,
        JSON.stringify(mismatched),
        mismatched.updatedAt,
        initial.caseId,
        initial.revision,
      )
      .run(),
    /(?:(?:job creation audit identity|new command evidence|command receipt origin) is|command semantics are) invalid/,
  );
  assert.deepEqual(await readFlow(initial.caseId), initial);
  const missingCommand = structuredClone(valid);
  missingCommand.commandIds.pop();
  await assert.rejects(
    commitFlow(initial, missingCommand),
    (error) => error instanceof FlowError && error.status === 503,
  );
  await assert.rejects(
    db
      .prepare(
        `UPDATE consulting_flows
        SET revision = ?1, payload = ?2, updated_at = ?3
        WHERE case_id = ?4 AND revision = ?5`,
      )
      .bind(
        missingCommand.revision,
        JSON.stringify(missingCommand),
        missingCommand.updatedAt,
        initial.caseId,
        initial.revision,
      )
      .run(),
    /(?:job creation command identity|command receipt origin|non-command job target) is invalid/,
  );
  assert.deepEqual(await readFlow(initial.caseId), initial);
  await commitFlow(initial, valid);
  assert.deepEqual(await readFlow(valid.caseId), valid);
});

void test('FLOW command IDs and receipts remain append-only', async () => {
  const initial = newConsultingFlow(
    `flow-command-history-${++sequence}`,
    '가상기업',
    partner.id,
    partner.name,
  );
  const commandId = `command-history-${++sequence}`;
  const saved = applyFlowCommand(
    initial,
    { type: 'save_report', stage: 1, body },
    { id: adminEmail, role: 'admin', name: FLOW_ADMIN_COMMAND_ACTOR_NAME },
    { commandId, now: new Date().toISOString() },
  );
  saved.commandReceipts = {
    [commandId]: {
      actorKey: FLOW_ADMIN_COMMAND_ACTOR_KEY,
      fingerprint: 'b'.repeat(64),
      actor: FLOW_ADMIN_COMMAND_ACTOR_NAME,
      action: 'save_report',
    },
  };
  await commitFlow(initial, saved);
  const invalid = [
    (flow: ConsultingFlow) => {
      flow.commandIds[0] = `replaced-command-${++sequence}`;
    },
    (flow: ConsultingFlow) => {
      flow.commandReceipts![commandId].fingerprint =
        'mutated-command-history-fingerprint';
    },
    (flow: ConsultingFlow) => {
      delete flow.commandReceipts![commandId];
    },
  ];
  const db = await flowDatabase();
  for (const mutate of invalid) {
    const changed = structuredClone(saved);
    changed.revision++;
    changed.updatedAt = new Date(
      Date.parse(saved.updatedAt) + changed.revision,
    ).toISOString();
    mutate(changed);
    await assert.rejects(
      commitFlow(saved, changed),
      (error) => error instanceof FlowError && error.status === 503,
    );
    await assert.rejects(
      db
        .prepare(
          `UPDATE consulting_flows
          SET revision = ?1, payload = ?2, updated_at = ?3
          WHERE case_id = ?4 AND revision = ?5`,
        )
        .bind(
          changed.revision,
          JSON.stringify(changed),
          changed.updatedAt,
          saved.caseId,
          saved.revision,
        )
        .run(),
      /command history is immutable/,
    );
    assert.deepEqual(
      await readFlow(saved.caseId),
      JSON.parse(JSON.stringify(saved)),
    );
  }
});

void test('FLOW new command IDs require one audit and immutable receipt', async () => {
  const initial = await fixture();
  const commandId = `new-command-evidence-${++sequence}`;
  const valid = applyFlowCommand(
    initial,
    { type: 'set_ai_policy', enabled: false },
    { id: adminEmail, role: 'admin', name: '가상 대표' },
    { commandId, now: new Date().toISOString() },
  );
  addSyntheticCommandReceipt(valid, commandId);
  const invalid = [
    (flow: ConsultingFlow) => {
      delete flow.commandReceipts![commandId];
    },
    (flow: ConsultingFlow) => {
      flow.audit.pop();
    },
  ];
  const db = await flowDatabase();
  for (const mutate of invalid) {
    const changed = structuredClone(valid);
    mutate(changed);
    await assert.rejects(
      commitFlow(initial, changed),
      (error) => error instanceof FlowError && error.status === 503,
    );
    await assert.rejects(
      db
        .prepare(
          `UPDATE consulting_flows
          SET revision = ?1, payload = ?2, updated_at = ?3
          WHERE case_id = ?4 AND revision = ?5`,
        )
        .bind(
          changed.revision,
          JSON.stringify(changed),
          changed.updatedAt,
          initial.caseId,
          initial.revision,
        )
        .run(),
      /(?:(?:new command evidence|audit cardinality) is|command semantics are) invalid/,
    );
    assert.deepEqual(await readFlow(initial.caseId), initial);
  }
  const auditOnly = structuredClone(initial);
  auditOnly.revision++;
  auditOnly.updatedAt = new Date(
    Date.parse(initial.updatedAt) + 1,
  ).toISOString();
  auditOnly.audit.push({
    id: `unbound-audit-only-${++sequence}`,
    at: auditOnly.updatedAt,
    actor: '가상 실행기',
    action: 'system_note',
    detail: '명령이나 AI 결과가 없는 여분 감사기록',
  });
  await assert.rejects(
    commitFlow(initial, auditOnly),
    (error) => error instanceof FlowError && error.status === 503,
  );
  await assert.rejects(
    db
      .prepare(
        `UPDATE consulting_flows
        SET revision = ?1, payload = ?2, updated_at = ?3
        WHERE case_id = ?4 AND revision = ?5`,
      )
      .bind(
        auditOnly.revision,
        JSON.stringify(auditOnly),
        auditOnly.updatedAt,
        initial.caseId,
        initial.revision,
      )
      .run(),
    /audit cardinality is invalid/,
  );
  await commitFlow(initial, valid);
  assert.deepEqual(
    await readFlow(valid.caseId),
    JSON.parse(JSON.stringify(valid)),
  );
});

void test('FLOW permits at most one new user command per revision', async () => {
  const appendSecondCommand = (flow: ConsultingFlow, commandId: string) => {
    flow.commandIds.push(commandId);
    flow.audit.push({
      id: commandId,
      at: flow.updatedAt,
      actor: FLOW_ADMIN_COMMAND_ACTOR_NAME,
      action: 'set_ai_policy',
      detail: '한 revision 복합 명령 차단 검사',
    });
    addSyntheticCommandReceipt(flow, commandId);
  };
  const db = await flowDatabase();
  const initial = newConsultingFlow(
    `flow-initial-command-cardinality-${++sequence}`,
    '가상기업',
    partner.id,
    partner.name,
  );
  const initialCommandId = `initial-command-a-${++sequence}`;
  const initialCompound = applyFlowCommand(
    initial,
    {
      type: 'set_ai_policy',
      enabled: true,
      thirdPartyConsent: true,
      privacyMasked: true,
      costConsent: true,
    },
    { id: adminEmail, role: 'admin', name: FLOW_ADMIN_COMMAND_ACTOR_NAME },
    { commandId: initialCommandId, now: new Date().toISOString() },
  );
  addSyntheticCommandReceipt(initialCompound, initialCommandId);
  appendSecondCommand(initialCompound, `initial-command-b-${++sequence}`);
  await assert.rejects(
    commitFlow(initial, initialCompound),
    (error) => error instanceof FlowError && error.status === 503,
  );
  await assert.rejects(
    db
      .prepare(
        `INSERT INTO consulting_flows
          (case_id, partner_id, revision, payload, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(
        initialCompound.caseId,
        initialCompound.partnerId,
        initialCompound.revision,
        JSON.stringify(initialCompound),
        initialCompound.updatedAt,
      )
      .run(),
    /initial command cardinality is invalid/,
  );

  const stored = await fixture();
  const updateCommandId = `update-command-a-${++sequence}`;
  const updateCompound = applyFlowCommand(
    stored,
    { type: 'set_ai_policy', enabled: false },
    { id: adminEmail, role: 'admin', name: FLOW_ADMIN_COMMAND_ACTOR_NAME },
    { commandId: updateCommandId, now: new Date().toISOString() },
  );
  addSyntheticCommandReceipt(updateCompound, updateCommandId);
  appendSecondCommand(updateCompound, `update-command-b-${++sequence}`);
  await assert.rejects(
    commitFlow(stored, updateCompound),
    (error) => error instanceof FlowError && error.status === 503,
  );
  await assert.rejects(
    db
      .prepare(
        `UPDATE consulting_flows
        SET revision = ?1, payload = ?2, updated_at = ?3
        WHERE case_id = ?4 AND revision = ?5`,
      )
      .bind(
        updateCompound.revision,
        JSON.stringify(updateCompound),
        updateCompound.updatedAt,
        stored.caseId,
        stored.revision,
      )
      .run(),
    /command cardinality is invalid/,
  );
  assert.deepEqual(await readFlow(stored.caseId), stored);
});

void test('FLOW separates user commands from internal AI transitions', async () => {
  const queued = await queuedReportFixture(false);
  const commandId = `commanded-ai-claim-${++sequence}`;
  const at = new Date(Date.parse(queued.updatedAt) + 1).toISOString();
  const commandOnly = applyFlowCommand(
    queued,
    {
      type: 'set_ai_policy',
      enabled: true,
      thirdPartyConsent: true,
      privacyMasked: true,
      costConsent: true,
    },
    { id: adminEmail, role: 'admin', name: FLOW_ADMIN_COMMAND_ACTOR_NAME },
    { commandId, now: at },
  );
  addSyntheticCommandReceipt(commandOnly, commandId);
  const commandedClaim = structuredClone(commandOnly);
  const claimed = commandedClaim.jobs.find(
    (job) => job.id !== `${commandId}-job` && job.status === 'queued',
  );
  assert.ok(claimed);
  claimed.status = 'processing';
  claimed.startedAt = at;
  await assert.rejects(
    commitFlow(queued, commandedClaim),
    (error) => error instanceof FlowError && error.status === 503,
  );
  const db = await flowDatabase();
  await db
    .prepare('DROP TRIGGER IF EXISTS consulting_flows_set_ai_policy_jobs_guard')
    .run();
  try {
    await assert.rejects(
      db
        .prepare(
          `UPDATE consulting_flows
          SET revision = ?1, payload = ?2, updated_at = ?3
          WHERE case_id = ?4 AND revision = ?5`,
        )
        .bind(
          commandedClaim.revision,
          JSON.stringify(commandedClaim),
          commandedClaim.updatedAt,
          queued.caseId,
          queued.revision,
        )
        .run(),
      /command AI transition is invalid/,
    );
  } finally {
    await db.prepare(consultingFlowsSetAiPolicyJobsTriggerSql).run();
  }
  await commitFlow(queued, commandOnly);
  assert.deepEqual(
    await readFlow(queued.caseId),
    JSON.parse(JSON.stringify(commandOnly)),
  );
});

void test('FLOW AI policy commands bind exact existing job effects', async () => {
  const db = await flowDatabase();
  const queued = await queuedReportFixture(false);
  const disableId = `policy-disable-jobs-${++sequence}`;
  const disableAt = new Date(Date.parse(queued.updatedAt) + 1).toISOString();
  const disabled = applyFlowCommand(
    queued,
    { type: 'set_ai_policy', enabled: false },
    { id: adminEmail, role: 'admin', name: FLOW_ADMIN_COMMAND_ACTOR_NAME },
    { commandId: disableId, now: disableAt },
  );
  addSyntheticCommandReceipt(disabled, disableId);
  const forgedDisable = structuredClone(disabled);
  const forgedBlocked = forgedDisable.jobs.find(
    (job) => job.status === 'blocked',
  );
  assert.ok(forgedBlocked);
  forgedBlocked.reason = '위조된 정책 보류 사유';
  await assert.rejects(
    commitFlow(queued, forgedDisable),
    (error) => error instanceof FlowError && error.status === 503,
  );
  await assert.rejects(
    db
      .prepare(
        `UPDATE consulting_flows
        SET revision = ?1, payload = ?2, updated_at = ?3
        WHERE case_id = ?4 AND revision = ?5`,
      )
      .bind(
        forgedDisable.revision,
        JSON.stringify(forgedDisable),
        forgedDisable.updatedAt,
        queued.caseId,
        queued.revision,
      )
      .run(),
    /set AI policy jobs are invalid/,
  );
  await commitFlow(queued, disabled);

  const secondQueued = await queuedReportFixture(false);
  const enableId = `policy-enable-jobs-${++sequence}`;
  const enableAt = new Date(
    Date.parse(secondQueued.updatedAt) + 1,
  ).toISOString();
  const enabled = applyFlowCommand(
    secondQueued,
    {
      type: 'set_ai_policy',
      enabled: true,
      thirdPartyConsent: true,
      privacyMasked: true,
      costConsent: true,
    },
    { id: adminEmail, role: 'admin', name: FLOW_ADMIN_COMMAND_ACTOR_NAME },
    { commandId: enableId, now: enableAt },
  );
  addSyntheticCommandReceipt(enabled, enableId);
  const forgedEnable = structuredClone(enabled);
  const forgedQueued = forgedEnable.jobs.find((job) => job.status === 'queued');
  assert.ok(forgedQueued);
  forgedQueued.status = 'blocked';
  forgedQueued.reason = '대표가 자동생성을 중지했습니다.';
  await assert.rejects(
    commitFlow(secondQueued, forgedEnable),
    (error) => error instanceof FlowError && error.status === 503,
  );
  await assert.rejects(
    db
      .prepare(
        `UPDATE consulting_flows
        SET revision = ?1, payload = ?2, updated_at = ?3
        WHERE case_id = ?4 AND revision = ?5`,
      )
      .bind(
        forgedEnable.revision,
        JSON.stringify(forgedEnable),
        forgedEnable.updatedAt,
        secondQueued.caseId,
        secondQueued.revision,
      )
      .run(),
    /set AI policy jobs are invalid/,
  );
  await commitFlow(secondQueued, enabled);
  assert.deepEqual(
    await readFlow(secondQueued.caseId),
    JSON.parse(JSON.stringify(enabled)),
  );
});

void test('FLOW transcript commands bind the exact target job effect', async () => {
  const stored = await transcriptJobFixture();
  const commandId = `transcript-job-effect-${++sequence}`;
  const at = new Date(Date.parse(stored.updatedAt) + 1).toISOString();
  const changed = applyFlowCommand(
    stored,
    {
      type: 'save_transcript',
      recordingId: stored.recordings.at(-1)!.id,
      transcript: `${body} 확인된 보완 전사문`,
      transcriptReviewed: true,
      recordingConsent: true,
      privacyMasked: true,
    },
    { id: adminEmail, role: 'admin', name: FLOW_ADMIN_COMMAND_ACTOR_NAME },
    { commandId, now: at },
  );
  addSyntheticCommandReceipt(changed, commandId);
  const target = changed.jobs.at(-1)!;
  assert.equal(target.status, 'queued');
  assert.equal(target.reason, '');
  const forged = structuredClone(changed);
  forged.jobs.at(-2)!.reason = '전사문 명령에 섞은 독립 작업 사유 변조';
  await assert.rejects(
    commitFlow(stored, forged),
    (error) => error instanceof FlowError && error.status === 503,
  );
  const db = await flowDatabase();
  await assert.rejects(
    db
      .prepare(
        `UPDATE consulting_flows
        SET revision = ?1, payload = ?2, updated_at = ?3
        WHERE case_id = ?4 AND revision = ?5`,
      )
      .bind(
        forged.revision,
        JSON.stringify(forged),
        forged.updatedAt,
        stored.caseId,
        stored.revision,
      )
      .run(),
    /save transcript jobs are invalid/,
  );
  await commitFlow(stored, changed);
  assert.deepEqual(
    await readFlow(stored.caseId),
    JSON.parse(JSON.stringify(changed)),
  );

  const failedStored = await transcriptJobFixture(true);
  const failureEvidence = failedStored.jobs.at(-1)!.failureEvidence!;
  const failureHistory = failedStored.jobs.at(-1)!.failureEvidenceHistory!;
  const retryId = `transcript-failure-retry-${++sequence}`;
  const corrected = applyFlowCommand(
    failedStored,
    {
      type: 'save_transcript',
      recordingId: failedStored.recordings.at(-1)!.id,
      transcript: `${body} 실패 후 확인된 보완 전사문`,
      transcriptReviewed: true,
      recordingConsent: true,
      privacyMasked: true,
    },
    { id: adminEmail, role: 'admin', name: FLOW_ADMIN_COMMAND_ACTOR_NAME },
    {
      commandId: retryId,
      now: new Date(Date.parse(failedStored.updatedAt) + 1).toISOString(),
    },
  );
  addSyntheticCommandReceipt(corrected, retryId);
  assert.equal(corrected.jobs.at(-1)!.status, 'queued');
  assert.equal(corrected.jobs.at(-1)!.failureEvidence, undefined);
  assert.deepEqual(corrected.jobs.at(-1)!.failureEvidenceHistory, [
    ...failureHistory,
    failureEvidence,
  ]);
  await commitFlow(failedStored, corrected);
});

void test('FLOW command receipts originate only with same-revision commands', async () => {
  const initial = await fixture();
  const legacyCommandId = `legacy-command-without-receipt-${++sequence}`;
  const saved = applyFlowCommand(
    initial,
    { type: 'set_ai_policy', enabled: false },
    { id: adminEmail, role: 'admin', name: '가상 대표' },
    {
      commandId: legacyCommandId,
      now: new Date(Date.parse(initial.updatedAt) + 1).toISOString(),
    },
  );
  addSyntheticCommandReceipt(saved, legacyCommandId);
  await commitFlow(initial, saved);
  const legacy = structuredClone(saved);
  delete legacy.commandReceipts![legacyCommandId];
  const db = await flowDatabase();
  await mutateConsultingFlowFixture(
    db,
    'UPDATE consulting_flows SET payload = ?1 WHERE case_id = ?2',
    [JSON.stringify(legacy), legacy.caseId],
  );
  assert.deepEqual(await readFlow(legacy.caseId), legacy);

  const nextCommandId = `new-command-with-receipt-${++sequence}`;
  const changed = applyFlowCommand(
    legacy,
    { type: 'set_ai_policy', enabled: false },
    { id: adminEmail, role: 'admin', name: '가상 대표' },
    {
      commandId: nextCommandId,
      now: new Date(Date.parse(legacy.updatedAt) + 1).toISOString(),
    },
  );
  addSyntheticCommandReceipt(changed, nextCommandId);
  changed.commandReceipts![legacyCommandId] = {
    actorKey: FLOW_ADMIN_COMMAND_ACTOR_KEY,
    fingerprint: 'forged-late-legacy-command-receipt',
  };
  await assert.rejects(
    commitFlow(legacy, changed),
    (error) => error instanceof FlowError && error.status === 503,
  );
  await assert.rejects(
    db
      .prepare(
        `UPDATE consulting_flows
        SET revision = ?1, payload = ?2, updated_at = ?3
        WHERE case_id = ?4 AND revision = ?5`,
      )
      .bind(
        changed.revision,
        JSON.stringify(changed),
        changed.updatedAt,
        legacy.caseId,
        legacy.revision,
      )
      .run(),
    /command receipt origin is invalid/,
  );
  assert.deepEqual(await readFlow(legacy.caseId), legacy);
});

void test('FLOW command receipt semantics match and preserve their audit', async () => {
  const initial = await fixture();
  const commandId = `command-semantic-${++sequence}`;
  const valid = applyFlowCommand(
    initial,
    { type: 'set_ai_policy', enabled: false },
    { id: adminEmail, role: 'admin', name: '가상 대표' },
    {
      commandId,
      now: new Date(Date.parse(initial.updatedAt) + 1).toISOString(),
    },
  );
  addSyntheticCommandReceipt(valid, commandId);
  const db = await flowDatabase();
  for (const mutate of [
    (flow: ConsultingFlow) => {
      flow.commandReceipts![commandId].actor = '위조 행위자';
    },
    (flow: ConsultingFlow) => {
      flow.commandReceipts![commandId].action = 'save_report';
    },
  ]) {
    const changed = structuredClone(valid);
    mutate(changed);
    await assert.rejects(
      commitFlow(initial, changed),
      (error) => error instanceof FlowError && error.status === 503,
    );
    await assert.rejects(
      db
        .prepare(
          `UPDATE consulting_flows
          SET revision = ?1, payload = ?2, updated_at = ?3
          WHERE case_id = ?4 AND revision = ?5`,
        )
        .bind(
          changed.revision,
          JSON.stringify(changed),
          changed.updatedAt,
          initial.caseId,
          initial.revision,
        )
        .run(),
      /(?:new admin command display is|command (?:semantics are|effect is|scope is|target is)) invalid/,
    );
    assert.deepEqual(await readFlow(initial.caseId), initial);
  }
  await commitFlow(initial, valid);
  for (const mutate of [
    (flow: ConsultingFlow) => {
      flow.commandReceipts![commandId].actor = '사후 위조 행위자';
    },
    (flow: ConsultingFlow) => {
      flow.commandReceipts![commandId].action = 'confirm_analysis';
    },
  ]) {
    const changed = structuredClone(valid);
    changed.revision++;
    changed.updatedAt = new Date(
      Date.parse(valid.updatedAt) + changed.revision,
    ).toISOString();
    mutate(changed);
    await assert.rejects(
      commitFlow(valid, changed),
      (error) => error instanceof FlowError && error.status === 503,
    );
    await assert.rejects(
      db
        .prepare(
          `UPDATE consulting_flows
          SET revision = ?1, payload = ?2, updated_at = ?3
          WHERE case_id = ?4 AND revision = ?5`,
        )
        .bind(
          changed.revision,
          JSON.stringify(changed),
          changed.updatedAt,
          valid.caseId,
          valid.revision,
        )
        .run(),
      /command semantics are invalid/,
    );
    assert.deepEqual(
      await readFlow(valid.caseId),
      JSON.parse(JSON.stringify(valid)),
    );
  }
});

void test('FLOW command actions require their declared business-state effect', async () => {
  const initial = await fixture();
  const commandId = `command-effect-${++sequence}`;
  const valid = applyFlowCommand(
    initial,
    { type: 'set_ai_policy', enabled: false },
    { id: adminEmail, role: 'admin', name: FLOW_ADMIN_COMMAND_ACTOR_NAME },
    {
      commandId,
      now: new Date(Date.parse(initial.updatedAt) + 1).toISOString(),
    },
  );
  addSyntheticCommandReceipt(valid, commandId);
  const db = await flowDatabase();
  for (const action of ['start_aftercare', 'unsupported_action']) {
    const forged = structuredClone(valid);
    forged.commandReceipts![commandId].action = action;
    forged.audit.at(-1)!.action = action;
    await assert.rejects(
      commitFlow(initial, forged),
      (error) => error instanceof FlowError && error.status === 503,
    );
    await assert.rejects(
      db
        .prepare(
          `UPDATE consulting_flows
          SET revision = ?1, payload = ?2, updated_at = ?3
          WHERE case_id = ?4 AND revision = ?5`,
        )
        .bind(
          forged.revision,
          JSON.stringify(forged),
          forged.updatedAt,
          initial.caseId,
          initial.revision,
        )
        .run(),
      /command (?:effect|scope) is invalid/,
    );
    assert.deepEqual(await readFlow(initial.caseId), initial);
  }
});

void test('FLOW initial command actions require their declared business-state effect', async () => {
  const initial = newConsultingFlow(
    `initial-command-effect-${++sequence}`,
    '가상기업',
    partner.id,
    partner.name,
  );
  const commandId = `initial-command-effect-${++sequence}`;
  const forged = applyFlowCommand(
    initial,
    { type: 'save_report', stage: 1, body },
    { id: adminEmail, role: 'admin', name: FLOW_ADMIN_COMMAND_ACTOR_NAME },
    { commandId, now: new Date().toISOString() },
  );
  addSyntheticCommandReceipt(forged, commandId);
  forged.commandReceipts![commandId].action = 'confirm_payment';
  forged.audit.at(-1)!.action = 'confirm_payment';
  await assert.rejects(
    commitFlow(initial, forged),
    (error) => error instanceof FlowError && error.status === 503,
  );
  const db = await flowDatabase();
  await assert.rejects(
    db
      .prepare(
        `INSERT INTO consulting_flows
          (case_id, partner_id, revision, payload, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(
        forged.caseId,
        forged.partnerId,
        forged.revision,
        JSON.stringify(forged),
        forged.updatedAt,
      )
      .run(),
    /initial command (?:effect|scope) is invalid/,
  );
  assert.equal(await readFlow(initial.caseId), null);
});

void test('FLOW commands cannot change state outside their declared scope', async () => {
  const initial = await fixture();
  const commandId = `command-scope-${++sequence}`;
  const forged = applyFlowCommand(
    initial,
    { type: 'set_ai_policy', enabled: false },
    { id: adminEmail, role: 'admin', name: FLOW_ADMIN_COMMAND_ACTOR_NAME },
    {
      commandId,
      now: new Date(Date.parse(initial.updatedAt) + 1).toISOString(),
    },
  );
  addSyntheticCommandReceipt(forged, commandId);
  forged.partnerName = '위조 담당자';
  await assert.rejects(
    commitFlow(initial, forged),
    (error) => error instanceof FlowError && error.status === 503,
  );
  const db = await flowDatabase();
  await assert.rejects(
    db
      .prepare(
        `UPDATE consulting_flows
        SET revision = ?1, payload = ?2, updated_at = ?3
        WHERE case_id = ?4 AND revision = ?5`,
      )
      .bind(
        forged.revision,
        JSON.stringify(forged),
        forged.updatedAt,
        initial.caseId,
        initial.revision,
      )
      .run(),
    /command scope is invalid/,
  );
  assert.deepEqual(await readFlow(initial.caseId), initial);
});

void test('FLOW initial commands cannot preload state outside their declared scope', async () => {
  const initial = newConsultingFlow(
    `initial-command-scope-${++sequence}`,
    '가상기업',
    partner.id,
    partner.name,
  );
  const commandId = `initial-command-scope-${++sequence}`;
  const forged = applyFlowCommand(
    initial,
    { type: 'save_report', stage: 1, body },
    { id: adminEmail, role: 'admin', name: FLOW_ADMIN_COMMAND_ACTOR_NAME },
    { commandId, now: new Date().toISOString() },
  );
  addSyntheticCommandReceipt(forged, commandId);
  forged.aftercare = {
    at: forged.updatedAt,
    summary: '가상 범위 밖 상태',
    nextDate: forged.updatedAt.slice(0, 10),
    owner: '가상 담당자',
  };
  await assert.rejects(
    commitFlow(initial, forged),
    (error) => error instanceof FlowError && error.status === 503,
  );
  const db = await flowDatabase();
  await assert.rejects(
    db
      .prepare(
        `INSERT INTO consulting_flows
          (case_id, partner_id, revision, payload, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(
        forged.caseId,
        forged.partnerId,
        forged.revision,
        JSON.stringify(forged),
        forged.updatedAt,
      )
      .run(),
    /initial command scope is invalid/,
  );
  assert.equal(await readFlow(initial.caseId), null);
});

void test('FLOW append commands add exactly one command-bound target', async () => {
  const initial = await fixture();
  const commandId = `command-target-append-${++sequence}`;
  const forged = applyFlowCommand(
    initial,
    {
      type: 'request_document',
      title: '가상 추가서류',
      required: true,
      channel: '이메일',
      recipient: '가상 담당자',
      dueDate: '',
    },
    { id: adminEmail, role: 'admin', name: FLOW_ADMIN_COMMAND_ACTOR_NAME },
    {
      commandId,
      now: new Date(Date.parse(initial.updatedAt) + 1).toISOString(),
    },
  );
  addSyntheticCommandReceipt(forged, commandId);
  forged.requests.push({
    ...structuredClone(forged.requests.at(-1)!),
    id: `${commandId}-hidden-request`,
    title: '같은 명령에 숨긴 추가 요청',
  });
  await assert.rejects(
    commitFlow(initial, forged),
    (error) => error instanceof FlowError && error.status === 503,
  );
  const db = await flowDatabase();
  await assert.rejects(
    db
      .prepare(
        `UPDATE consulting_flows
        SET revision = ?1, payload = ?2, updated_at = ?3
        WHERE case_id = ?4 AND revision = ?5`,
      )
      .bind(
        forged.revision,
        JSON.stringify(forged),
        forged.updatedAt,
        initial.caseId,
        initial.revision,
      )
      .run(),
    /command target is invalid/,
  );
  assert.deepEqual(await readFlow(initial.caseId), initial);
});

void test('FLOW target updates cannot alter another item or immutable fields', async () => {
  let saved = await fixture();
  for (const suffix of ['first', 'second']) {
    const commandId = `command-target-request-${suffix}-${++sequence}`;
    const next = applyFlowCommand(
      saved,
      {
        type: 'request_document',
        title: `가상 ${suffix} 서류`,
        required: true,
        channel: '이메일',
        recipient: '가상 담당자',
        dueDate: '',
      },
      { id: adminEmail, role: 'admin', name: FLOW_ADMIN_COMMAND_ACTOR_NAME },
      {
        commandId,
        now: new Date(Date.parse(saved.updatedAt) + 1).toISOString(),
      },
    );
    addSyntheticCommandReceipt(next, commandId);
    await commitFlow(saved, next);
    saved = next;
  }
  const commandId = `command-target-sent-${++sequence}`;
  const forged = applyFlowCommand(
    saved,
    {
      type: 'mark_request_sent',
      requestId: saved.requests[0].id,
      sentConfirmed: true,
    },
    { id: adminEmail, role: 'admin', name: FLOW_ADMIN_COMMAND_ACTOR_NAME },
    {
      commandId,
      now: new Date(Date.parse(saved.updatedAt) + 1).toISOString(),
    },
  );
  addSyntheticCommandReceipt(forged, commandId);
  forged.requests[1].title = '명령 대상이 아닌 요청 제목 변조';
  await assert.rejects(
    commitFlow(saved, forged),
    (error) => error instanceof FlowError && error.status === 503,
  );
  const db = await flowDatabase();
  await assert.rejects(
    db
      .prepare(
        `UPDATE consulting_flows
        SET revision = ?1, payload = ?2, updated_at = ?3
        WHERE case_id = ?4 AND revision = ?5`,
      )
      .bind(
        forged.revision,
        JSON.stringify(forged),
        forged.updatedAt,
        saved.caseId,
        saved.revision,
      )
      .run(),
    /command target is invalid/,
  );
  assert.deepEqual(await readFlow(saved.caseId), saved);
});

void test('FLOW initial append commands cannot preload extra targets', async () => {
  const initial = newConsultingFlow(
    `initial-command-target-${++sequence}`,
    '가상기업',
    partner.id,
    partner.name,
  );
  const commandId = `initial-command-target-${++sequence}`;
  const forged = applyFlowCommand(
    initial,
    { type: 'save_report', stage: 1, body },
    { id: adminEmail, role: 'admin', name: FLOW_ADMIN_COMMAND_ACTOR_NAME },
    { commandId, now: new Date().toISOString() },
  );
  addSyntheticCommandReceipt(forged, commandId);
  forged.reports.push({
    ...structuredClone(forged.reports[0]),
    id: `${commandId}-hidden-report`,
    version: 2,
  });
  await assert.rejects(
    commitFlow(initial, forged),
    (error) => error instanceof FlowError && error.status === 503,
  );
  const db = await flowDatabase();
  await assert.rejects(
    db
      .prepare(
        `INSERT INTO consulting_flows
          (case_id, partner_id, revision, payload, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(
        forged.caseId,
        forged.partnerId,
        forged.revision,
        JSON.stringify(forged),
        forged.updatedAt,
      )
      .run(),
    /initial command target is invalid/,
  );
  assert.equal(await readFlow(initial.caseId), null);
});

void test('FLOW AI job transitions cannot change unrelated business state', async () => {
  const queued = await queuedReportFixture(false);
  const job = queued.jobs.at(-1)!;
  const claimed = claimFlowJob(
    queued,
    job.id,
    new Date(Date.parse(queued.updatedAt) + 1).toISOString(),
  );
  const forged = structuredClone(claimed);
  forged.requests.push({
    id: `hidden-transition-request-${++sequence}`,
    title: 'AI 전이에 숨긴 가상 서류요청',
    required: true,
    channel: '이메일',
    recipient: '가상 담당자',
    dueDate: '',
    status: 'requested',
    note: '',
    createdAt: claimed.updatedAt,
  });
  await assert.rejects(
    commitFlow(queued, forged),
    (error) => error instanceof FlowError && error.status === 503,
  );
  const db = await flowDatabase();
  await assert.rejects(
    db
      .prepare(
        `UPDATE consulting_flows
        SET revision = ?1, payload = ?2, updated_at = ?3
        WHERE case_id = ?4 AND revision = ?5`,
      )
      .bind(
        forged.revision,
        JSON.stringify(forged),
        forged.updatedAt,
        queued.caseId,
        queued.revision,
      )
      .run(),
    /non-command scope is invalid/,
  );
  assert.deepEqual(
    await readFlow(queued.caseId),
    JSON.parse(JSON.stringify(queued)),
  );
});

void test('FLOW AI completion binds one exact report and preserves report history', async () => {
  const queued = await queuedReportFixture(false);
  const job = queued.jobs.at(-1)!;
  const claimed = claimFlowJob(
    queued,
    job.id,
    new Date(Date.parse(queued.updatedAt) + 1).toISOString(),
  );
  await commitFlow(queued, claimed);
  const completedAt = new Date(Date.parse(claimed.updatedAt) + 1).toISOString();
  const completed = finishFlowJob(
    claimed,
    job.id,
    claimed.updatedAt,
    completedAt,
    {
      body,
      evidence: {
        instructionVersion: 'synthetic-flow-instruction-v1',
        requestedModel: 'claude-requested-test-model',
        providerRequestId: 'req_bound_result_report',
        providerModel: 'claude-resolved-test-model',
        providerMessageId: 'msg_bound_result_report',
        inputTokens: 10,
        outputTokens: 20,
        observedAt: completedAt,
      },
    },
  );
  const corruptions: Array<{
    name: string;
    apply: (flow: ConsultingFlow) => void;
  }> = [
    {
      name: 'existing report mutation',
      apply(flow) {
        flow.reports[0].title = 'AI 완료에 숨긴 기존 보고서 변조';
      },
    },
    {
      name: 'extra report append',
      apply(flow) {
        flow.reports.push({
          ...structuredClone(flow.reports.at(-1)!),
          id: `hidden-ai-result-${++sequence}`,
        });
      },
    },
    {
      name: 'wrong result identity',
      apply(flow) {
        flow.reports.at(-1)!.id = `wrong-ai-result-${++sequence}`;
      },
    },
  ];
  const db = await flowDatabase();
  for (const corruption of corruptions) {
    const forged = structuredClone(completed);
    corruption.apply(forged);
    await assert.rejects(
      commitFlow(claimed, forged),
      (error) => error instanceof FlowError && error.status === 503,
      `application accepted ${corruption.name}`,
    );
    await assert.rejects(
      db
        .prepare(
          `UPDATE consulting_flows
          SET revision = ?1, payload = ?2, updated_at = ?3
          WHERE case_id = ?4 AND revision = ?5`,
        )
        .bind(
          forged.revision,
          JSON.stringify(forged),
          forged.updatedAt,
          claimed.caseId,
          claimed.revision,
        )
        .run(),
      /AI result report is invalid/,
      `D1 accepted ${corruption.name}`,
    );
  }
  await commitFlow(claimed, completed);
  assert.deepEqual(
    await readFlow(completed.caseId),
    JSON.parse(JSON.stringify(completed)),
  );
});

void test('FLOW AI completion cannot attach an unsupported result file', async () => {
  const queued = await queuedReportFixture(false);
  const job = queued.jobs.at(-1)!;
  const claimed = claimFlowJob(
    queued,
    job.id,
    new Date(Date.parse(queued.updatedAt) + 1).toISOString(),
  );
  await commitFlow(queued, claimed);
  const completedAt = new Date(Date.parse(claimed.updatedAt) + 1).toISOString();
  const completed = finishFlowJob(
    claimed,
    job.id,
    claimed.updatedAt,
    completedAt,
    {
      body,
      evidence: {
        instructionVersion: 'synthetic-flow-instruction-v1',
        requestedModel: 'claude-requested-test-model',
        providerRequestId: 'req_no_result_file',
        providerModel: 'claude-resolved-test-model',
        providerMessageId: 'msg_no_result_file',
        inputTokens: 10,
        outputTokens: 20,
        observedAt: completedAt,
      },
    },
  );
  const forged = structuredClone(completed);
  const fileId = `hidden-ai-result-file-${++sequence}`;
  forged.files.push({
    id: fileId,
    name: 'ai-result.pdf',
    contentType: 'application/pdf',
    size: 1,
    key: flowFileStorageKey(fileId),
    createdAt: completedAt,
    purpose: 'report',
  });
  forged.reports.at(-1)!.fileId = fileId;
  await assert.rejects(
    commitFlow(claimed, forged),
    (error) => error instanceof FlowError && error.status === 503,
  );
  const db = await flowDatabase();
  await assert.rejects(
    db
      .prepare(
        `UPDATE consulting_flows
        SET revision = ?1, payload = ?2, updated_at = ?3
        WHERE case_id = ?4 AND revision = ?5`,
      )
      .bind(
        forged.revision,
        JSON.stringify(forged),
        forged.updatedAt,
        claimed.caseId,
        claimed.revision,
      )
      .run(),
    /AI result file is invalid/,
  );
  assert.deepEqual(
    await readFlow(claimed.caseId),
    JSON.parse(JSON.stringify(claimed)),
  );
});

void test('FLOW AI result audit detail binds to stage, status and reason', async () => {
  const queued = await queuedReportFixture(false);
  const job = queued.jobs.at(-1)!;
  const claimed = claimFlowJob(
    queued,
    job.id,
    new Date(Date.parse(queued.updatedAt) + 1).toISOString(),
  );
  await commitFlow(queued, claimed);
  const failedAt = new Date(Date.parse(claimed.updatedAt) + 1).toISOString();
  const failed = finishFlowJob(claimed, job.id, claimed.updatedAt, failedAt, {
    error: '가상 공급자 시간 초과',
    failureEvidence: {
      instructionVersion: 'synthetic-flow-instruction-v1',
      requestedModel: 'claude-requested-test-model',
      httpStatus: 504,
      observedAt: failedAt,
      providerRequestId: 'req_bound_result_audit',
    },
  });
  const forged = structuredClone(failed);
  forged.audit.at(-1)!.detail = '성공으로 위장한 AI 결과 감사기록';
  await assert.rejects(
    commitFlow(claimed, forged),
    (error) => error instanceof FlowError && error.status === 503,
  );
  const db = await flowDatabase();
  await assert.rejects(
    db
      .prepare(
        `UPDATE consulting_flows
        SET revision = ?1, payload = ?2, updated_at = ?3
        WHERE case_id = ?4 AND revision = ?5`,
      )
      .bind(
        forged.revision,
        JSON.stringify(forged),
        forged.updatedAt,
        claimed.caseId,
        claimed.revision,
      )
      .run(),
    /AI result audit detail is invalid/,
  );
  await commitFlow(claimed, failed);
  assert.deepEqual(
    await readFlow(failed.caseId),
    JSON.parse(JSON.stringify(failed)),
  );
});

void test('FLOW new command receipts require canonical identity fields', async () => {
  const initial = await fixture();
  const commandId = `command-receipt-identity-${++sequence}`;
  const valid = applyFlowCommand(
    initial,
    { type: 'set_ai_policy', enabled: false },
    { id: adminEmail, role: 'admin', name: '가상 대표' },
    {
      commandId,
      now: new Date(Date.parse(initial.updatedAt) + 1).toISOString(),
    },
  );
  addSyntheticCommandReceipt(valid, commandId);
  const db = await flowDatabase();
  for (const mutate of [
    (flow: ConsultingFlow) => {
      flow.commandReceipts![commandId].fingerprint = 'A'.repeat(64);
    },
    (flow: ConsultingFlow) => {
      flow.commandReceipts![commandId].actorKey = `operator:${adminEmail}`;
    },
  ]) {
    const changed = structuredClone(valid);
    mutate(changed);
    await assert.rejects(
      commitFlow(initial, changed),
      (error) => error instanceof FlowError && error.status === 503,
    );
    await assert.rejects(
      db
        .prepare(
          `UPDATE consulting_flows
          SET revision = ?1, payload = ?2, updated_at = ?3
          WHERE case_id = ?4 AND revision = ?5`,
        )
        .bind(
          changed.revision,
          JSON.stringify(changed),
          changed.updatedAt,
          initial.caseId,
          initial.revision,
        )
        .run(),
      /new command receipt identity is invalid/,
    );
    assert.deepEqual(await readFlow(initial.caseId), initial);
  }
  await commitFlow(initial, valid);
  assert.deepEqual(
    await readFlow(valid.caseId),
    JSON.parse(JSON.stringify(valid)),
  );
});

void test('FLOW member command actors bind to the assigned partner', async () => {
  const initial = await fixture();
  const commandId = `member-command-actor-${++sequence}`;
  const valid = applyFlowCommand(
    initial,
    { type: 'confirm_analysis', reportId: initial.analysis.reportId },
    { id: partner.id, role: 'partner', name: partner.name },
    {
      commandId,
      now: new Date(Date.parse(initial.updatedAt) + 1).toISOString(),
    },
  );
  valid.commandReceipts = {
    ...valid.commandReceipts,
    [commandId]: {
      actorKey: `member:${partner.id}`,
      fingerprint: '1'.repeat(64),
      actor: partner.name,
      action: 'confirm_analysis',
    },
  };
  const db = await flowDatabase();
  for (const mutate of [
    (flow: ConsultingFlow) => {
      flow.commandReceipts![commandId].actorKey = 'member:another-partner';
    },
    (flow: ConsultingFlow) => {
      flow.commandReceipts![commandId].actor = '다른 담당자';
      flow.audit.at(-1)!.actor = '다른 담당자';
    },
  ]) {
    const changed = structuredClone(valid);
    mutate(changed);
    await assert.rejects(
      commitFlow(initial, changed),
      (error) => error instanceof FlowError && error.status === 503,
    );
    await assert.rejects(
      db
        .prepare(
          `UPDATE consulting_flows
          SET revision = ?1, payload = ?2, updated_at = ?3
          WHERE case_id = ?4 AND revision = ?5`,
        )
        .bind(
          changed.revision,
          JSON.stringify(changed),
          changed.updatedAt,
          initial.caseId,
          initial.revision,
        )
        .run(),
      /new member command actor is invalid/,
    );
    assert.deepEqual(await readFlow(initial.caseId), initial);
  }
  await commitFlow(initial, valid);
  assert.deepEqual(
    await readFlow(valid.caseId),
    JSON.parse(JSON.stringify(valid)),
  );
});

void test('FLOW admin command actors use one stable primary identity', async () => {
  const initial = await fixture();
  const commandId = `admin-command-actor-${++sequence}`;
  const command = { type: 'set_ai_policy', enabled: false } as const;
  const user: PortalUser = {
    id: 'stable-owner-subject',
    email: adminEmail,
    displayName: FLOW_ADMIN_COMMAND_ACTOR_NAME,
    role: 'admin',
    memberId: null,
    memberName: null,
    permissions: null,
  };
  assert.equal(
    (await flowCommandReceipt(user, { command })).actorKey,
    FLOW_ADMIN_COMMAND_ACTOR_KEY,
  );
  const valid = applyFlowCommand(
    initial,
    command,
    { id: user.id, role: 'admin', name: user.displayName },
    {
      commandId,
      now: new Date(Date.parse(initial.updatedAt) + 1).toISOString(),
    },
  );
  valid.commandReceipts = {
    ...valid.commandReceipts,
    [commandId]: {
      actorKey: FLOW_ADMIN_COMMAND_ACTOR_KEY,
      fingerprint: '2'.repeat(64),
      actor: user.displayName,
      action: 'set_ai_policy',
    },
  };
  const changed = structuredClone(valid);
  changed.commandReceipts![commandId].actorKey = `admin:${adminEmail}`;
  await assert.rejects(
    commitFlow(initial, changed),
    (error) => error instanceof FlowError && error.status === 503,
  );
  const db = await flowDatabase();
  await assert.rejects(
    db
      .prepare(
        `UPDATE consulting_flows
        SET revision = ?1, payload = ?2, updated_at = ?3
        WHERE case_id = ?4 AND revision = ?5`,
      )
      .bind(
        changed.revision,
        JSON.stringify(changed),
        changed.updatedAt,
        initial.caseId,
        initial.revision,
      )
      .run(),
    /new admin command actor is invalid/,
  );
  assert.deepEqual(await readFlow(initial.caseId), initial);
  await commitFlow(initial, valid);
  assert.deepEqual(
    await readFlow(valid.caseId),
    JSON.parse(JSON.stringify(valid)),
  );
});

void test('FLOW admin command display binds to the representative role', async () => {
  const initial = await fixture();
  const commandId = `admin-command-display-${++sequence}`;
  const valid = applyFlowCommand(
    initial,
    { type: 'set_ai_policy', enabled: false },
    {
      id: 'stable-owner-subject',
      role: 'admin',
      name: FLOW_ADMIN_COMMAND_ACTOR_NAME,
    },
    {
      commandId,
      now: new Date(Date.parse(initial.updatedAt) + 1).toISOString(),
    },
  );
  valid.commandReceipts = {
    ...valid.commandReceipts,
    [commandId]: {
      actorKey: FLOW_ADMIN_COMMAND_ACTOR_KEY,
      fingerprint: '3'.repeat(64),
      actor: FLOW_ADMIN_COMMAND_ACTOR_NAME,
      action: 'set_ai_policy',
    },
  };
  const changed = structuredClone(valid);
  changed.commandReceipts![commandId].actor = '위조 관리자';
  changed.audit.at(-1)!.actor = '위조 관리자';
  await assert.rejects(
    commitFlow(initial, changed),
    (error) => error instanceof FlowError && error.status === 503,
  );
  const db = await flowDatabase();
  await assert.rejects(
    db
      .prepare(
        `UPDATE consulting_flows
        SET revision = ?1, payload = ?2, updated_at = ?3
        WHERE case_id = ?4 AND revision = ?5`,
      )
      .bind(
        changed.revision,
        JSON.stringify(changed),
        changed.updatedAt,
        initial.caseId,
        initial.revision,
      )
      .run(),
    /new admin command display is invalid/,
  );
  assert.deepEqual(await readFlow(initial.caseId), initial);
  await commitFlow(initial, valid);
  assert.deepEqual(
    await readFlow(valid.caseId),
    JSON.parse(JSON.stringify(valid)),
  );
});

void test('FLOW commit and native D1 enforce the AI job lifecycle', async () => {
  const initial = await fixture();
  const timestamp = (offset: number) =>
    new Date(Date.parse(initial.updatedAt) + offset).toISOString();
  const queued = structuredClone(initial);
  const creationAuditId = `lifecycle-job-creation-${++sequence}`;
  const jobId = `${creationAuditId}-job`;
  queued.revision++;
  queued.updatedAt = timestamp(1);
  queued.jobs.push({
    id: jobId,
    stage: 1,
    status: 'queued',
    reason: '',
    createdAt: queued.updatedAt,
  });
  queued.audit.push({
    id: creationAuditId,
    at: queued.updatedAt,
    actor: '가상 대표',
    action: 'queue_report1',
    detail: '1차 분석보고서 생성 요청',
  });
  queued.commandIds.push(creationAuditId);
  addSyntheticCommandReceipt(queued, creationAuditId);
  await commitFlow(initial, queued);
  const invalidChanges: Array<{
    pattern: RegExp;
    apply: (flow: ConsultingFlow) => void;
  }> = [
    {
      pattern: /job identity is immutable/,
      apply(flow) {
        flow.jobs.at(-1)!.stage = 4;
      },
    },
    {
      pattern:
        /(?:job (?:status|lifecycle)|non-command job) transition is invalid/,
      apply(flow) {
        const job = flow.jobs.at(-1)!;
        job.status = 'complete';
        job.startedAt = timestamp(2);
        job.completedAt = timestamp(3);
        job.reportId = flow.reports[0].id;
      },
    },
    {
      pattern: /job lifecycle transition is invalid/,
      apply(flow) {
        flow.jobs.at(-1)!.reason = '구조상 정상인 대기 사유 변조';
      },
    },
  ];
  const db = await flowDatabase();
  for (const change of invalidChanges) {
    const changed = structuredClone(queued);
    changed.revision++;
    changed.updatedAt = timestamp(3);
    change.apply(changed);
    await assert.rejects(
      commitFlow(queued, changed),
      (error) => error instanceof FlowError && error.status === 503,
    );
    await assert.rejects(
      db
        .prepare(
          `UPDATE consulting_flows
          SET revision = ?1, payload = ?2, updated_at = ?3
          WHERE case_id = ?4 AND revision = ?5`,
        )
        .bind(
          changed.revision,
          JSON.stringify(changed),
          changed.updatedAt,
          queued.caseId,
          queued.revision,
        )
        .run(),
      change.pattern,
    );
    assert.deepEqual(await readFlow(queued.caseId), queued);
  }
  const staleClaim = structuredClone(queued);
  staleClaim.revision++;
  staleClaim.updatedAt = timestamp(4);
  staleClaim.jobs.at(-1)!.status = 'processing';
  staleClaim.jobs.at(-1)!.startedAt = timestamp(3);
  await assert.rejects(
    commitFlow(queued, staleClaim),
    (error) => error instanceof FlowError && error.status === 503,
  );
  await assert.rejects(
    db
      .prepare(
        `UPDATE consulting_flows
        SET revision = ?1, payload = ?2, updated_at = ?3
        WHERE case_id = ?4 AND revision = ?5`,
      )
      .bind(
        staleClaim.revision,
        JSON.stringify(staleClaim),
        staleClaim.updatedAt,
        queued.caseId,
        queued.revision,
      )
      .run(),
    /job transition timestamp is invalid/,
  );
  const processing = structuredClone(queued);
  processing.revision++;
  processing.updatedAt = timestamp(4);
  processing.jobs.at(-1)!.status = 'processing';
  processing.jobs.at(-1)!.startedAt = timestamp(4);
  const auditedClaim = structuredClone(processing);
  auditedClaim.audit.push({
    id: `unexpected-claim-audit-${++sequence}`,
    at: auditedClaim.updatedAt,
    actor: '가상 실행기',
    action: 'system_note',
    detail: 'AI 작업 청구에 끼워 넣은 여분 감사기록',
  });
  await assert.rejects(
    commitFlow(queued, auditedClaim),
    (error) => error instanceof FlowError && error.status === 503,
  );
  await assert.rejects(
    db
      .prepare(
        `UPDATE consulting_flows
        SET revision = ?1, payload = ?2, updated_at = ?3
        WHERE case_id = ?4 AND revision = ?5`,
      )
      .bind(
        auditedClaim.revision,
        JSON.stringify(auditedClaim),
        auditedClaim.updatedAt,
        queued.caseId,
        queued.revision,
      )
      .run(),
    /(?:non-command )?audit cardinality is invalid/,
  );
  await commitFlow(queued, processing);
  const changedLease = structuredClone(processing);
  changedLease.revision++;
  changedLease.updatedAt = timestamp(5);
  changedLease.jobs.at(-1)!.startedAt = timestamp(5);
  await assert.rejects(
    commitFlow(processing, changedLease),
    (error) => error instanceof FlowError && error.status === 503,
  );
  assert.deepEqual(await readFlow(processing.caseId), processing);
  const unauditedRetry = structuredClone(processing);
  unauditedRetry.revision++;
  unauditedRetry.updatedAt = timestamp(6);
  unauditedRetry.jobs.at(-1)!.status = 'queued';
  unauditedRetry.jobs.at(-1)!.startedAt = undefined;
  await assert.rejects(
    commitFlow(processing, unauditedRetry),
    (error) => error instanceof FlowError && error.status === 503,
  );
  await assert.rejects(
    db
      .prepare(
        `UPDATE consulting_flows
        SET revision = ?1, payload = ?2, updated_at = ?3
        WHERE case_id = ?4 AND revision = ?5`,
      )
      .bind(
        unauditedRetry.revision,
        JSON.stringify(unauditedRetry),
        unauditedRetry.updatedAt,
        processing.caseId,
        processing.revision,
      )
      .run(),
    /(?:job transition audit|non-command job transition) is invalid/,
  );
  const commandlessRetry = structuredClone(processing);
  commandlessRetry.revision++;
  commandlessRetry.updatedAt = timestamp(6);
  commandlessRetry.jobs.at(-1)!.status = 'queued';
  commandlessRetry.jobs.at(-1)!.startedAt = undefined;
  commandlessRetry.audit.push({
    id: `commandless-retry-${++sequence}`,
    at: commandlessRetry.updatedAt,
    actor: FLOW_ADMIN_COMMAND_ACTOR_NAME,
    action: 'retry_job',
    detail: '명령 원장 없이 만든 가상 재시도',
  });
  await assert.rejects(
    commitFlow(processing, commandlessRetry),
    (error) => error instanceof FlowError && error.status === 503,
  );
  await assert.rejects(
    db
      .prepare(
        `UPDATE consulting_flows
        SET revision = ?1, payload = ?2, updated_at = ?3
        WHERE case_id = ?4 AND revision = ?5`,
      )
      .bind(
        commandlessRetry.revision,
        JSON.stringify(commandlessRetry),
        commandlessRetry.updatedAt,
        processing.caseId,
        processing.revision,
      )
      .run(),
    /(?:non-command job transition|audit cardinality) is invalid/,
  );
  const unauditedFailure = structuredClone(processing);
  unauditedFailure.revision++;
  unauditedFailure.updatedAt = timestamp(6);
  unauditedFailure.jobs.at(-1)!.status = 'failed';
  unauditedFailure.jobs.at(-1)!.reason = '가상 공급자 오류';
  await assert.rejects(
    commitFlow(processing, unauditedFailure),
    (error) => error instanceof FlowError && error.status === 503,
  );
  await assert.rejects(
    db
      .prepare(
        `UPDATE consulting_flows
        SET revision = ?1, payload = ?2, updated_at = ?3
        WHERE case_id = ?4 AND revision = ?5`,
      )
      .bind(
        unauditedFailure.revision,
        JSON.stringify(unauditedFailure),
        unauditedFailure.updatedAt,
        processing.caseId,
        processing.revision,
      )
      .run(),
    /(?:job transition audit|(?:non-command )?audit cardinality) is invalid/,
  );
  const completionAt = timestamp(7);
  const completionAuditId = `${jobId}-${completionAt}`;
  const completed = structuredClone(processing);
  completed.revision++;
  completed.updatedAt = completionAt;
  const completedJob = completed.jobs.at(-1)!;
  completedJob.status = 'complete';
  completedJob.completedAt = completionAt;
  addSyntheticAiReport(completed, completedJob, completionAt);
  completedJob.evidence = {
    auditId: completionAuditId,
    instructionVersion: 'synthetic-flow-instruction-v1',
    requestedModel: 'claude-requested-test-model',
    providerRequestId: 'req_lifecycle_completion',
    providerModel: 'claude-resolved-test-model',
    providerMessageId: 'msg_lifecycle_completion',
    inputTokens: 10,
    outputTokens: 20,
    observedAt: timestamp(6),
  };
  completed.audit.push({
    id: completionAuditId,
    at: completionAt,
    actor: '보고서 자동생성',
    action: 'ai_result',
    detail: '1차 정밀진단보고서 자동 저장 · 담당 파트너 공유',
  });
  const extraCompletionAudit = structuredClone(completed);
  extraCompletionAudit.audit.push({
    id: `unexpected-completion-audit-${++sequence}`,
    at: completionAt,
    actor: '가상 실행기',
    action: 'system_note',
    detail: 'AI 완료 전이에 끼워 넣은 여분 감사기록',
  });
  await assert.rejects(
    commitFlow(processing, extraCompletionAudit),
    (error) => error instanceof FlowError && error.status === 503,
  );
  await assert.rejects(
    db
      .prepare(
        `UPDATE consulting_flows
        SET revision = ?1, payload = ?2, updated_at = ?3
        WHERE case_id = ?4 AND revision = ?5`,
      )
      .bind(
        extraCompletionAudit.revision,
        JSON.stringify(extraCompletionAudit),
        extraCompletionAudit.updatedAt,
        processing.caseId,
        processing.revision,
      )
      .run(),
    /(?:non-command )?audit cardinality is invalid/,
  );
  const staleCompletion = structuredClone(completed);
  const staleCompletionAt = timestamp(6);
  const staleCompletionAuditId = `${jobId}-${staleCompletionAt}`;
  staleCompletion.jobs.at(-1)!.completedAt = staleCompletionAt;
  staleCompletion.jobs.at(-1)!.evidence!.auditId = staleCompletionAuditId;
  staleCompletion.audit.at(-1)!.id = staleCompletionAuditId;
  staleCompletion.audit.at(-1)!.at = staleCompletionAt;
  await assert.rejects(
    commitFlow(processing, staleCompletion),
    (error) => error instanceof FlowError && error.status === 503,
  );
  await assert.rejects(
    db
      .prepare(
        `UPDATE consulting_flows
        SET revision = ?1, payload = ?2, updated_at = ?3
        WHERE case_id = ?4 AND revision = ?5`,
      )
      .bind(
        staleCompletion.revision,
        JSON.stringify(staleCompletion),
        staleCompletion.updatedAt,
        processing.caseId,
        processing.revision,
      )
      .run(),
    /job transition (?:timestamp|audit) is invalid/,
  );
  await commitFlow(processing, completed);
  assert.deepEqual(await readFlow(completed.caseId), completed);
});

void test('FLOW rejects a D1 updated timestamp that differs from its payload', async () => {
  const flow = await fixture();
  const db = await flowDatabase();
  await mutateConsultingFlowFixture(
    db,
    'UPDATE consulting_flows SET updated_at = ?1 WHERE case_id = ?2',
    ['2020-01-01T00:00:00.000Z', flow.caseId],
  );
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
            key: flowFileStorageKey('corrupt-file'),
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
            key: flowFileStorageKey('status-file'),
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
    await deleteConsultingFlowFixture(await flowDatabase());
    const flow = await fixture();
    await replaceStoredFlow(flow.caseId, (payload) => {
      (payload.files as Array<Record<string, unknown>>).push({
        id: `invalid-file-${index}`,
        name: corruption.name,
        contentType: corruption.contentType,
        size: corruption.size,
        key: flowFileStorageKey(`invalid-file-${index}`),
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
    await deleteConsultingFlowFixture(await flowDatabase());
    const flow = await fixture();
    await replaceStoredFlow(flow.caseId, (payload) => {
      (payload.files as Array<Record<string, unknown>>).push({
        id: `invalid-file-format-${index}`,
        name: corruption.name,
        contentType: corruption.contentType,
        size: 1,
        key: flowFileStorageKey(`invalid-file-format-${index}`),
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

void test('FLOW rejects stored filenames outside the canonical upload boundary before detail, dashboard and download', async () => {
  const unsafeNames = [
    'folder/report.txt',
    ' report.txt',
    'e\u0301-report.txt',
    'report\u0000.txt',
    `${'a'.repeat(181)}.txt`,
  ];
  for (const [index, name] of unsafeNames.entries()) {
    await deleteConsultingFlowFixture(await flowDatabase());
    const flow = await fixture();
    const fileId = `unsafe-name-file-${++sequence}`;
    const key = flowFileStorageKey(fileId);
    await flowBucket().put(key, 'SYNTHETIC_UNSAFE_NAME_OBJECT');
    await replaceStoredFlow(flow.caseId, (payload) => {
      (payload.files as Array<Record<string, unknown>>).push({
        id: fileId,
        name,
        contentType: 'text/plain',
        size: 'SYNTHETIC_UNSAFE_NAME_OBJECT'.length,
        key,
        createdAt: payload.updatedAt,
        purpose: 'report',
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
    const response = await download(request(flow.caseId, undefined), {
      params: Promise.resolve({ caseId: flow.caseId, fileId }),
    });
    assert.equal(response.status, 503, await response.clone().text());
    assert.ok(
      await flowBucket().head(key),
      `unsafe name ${index} preserves R2`,
    );
  }
});

void test('FLOW rejects a file ID and key copied from another case before detail, dashboard and download', async () => {
  await deleteConsultingFlowFixture(await flowDatabase());
  const source = await fixtureWithAttachment();
  const target = await fixture();
  const copied = structuredClone(target);
  copied.revision++;
  copied.updatedAt = new Date().toISOString();
  copied.files.push({ ...source.file });
  await assert.rejects(
    commitFlow(target, copied),
    (error) => error instanceof FlowError && error.status === 503,
  );
  assert.deepEqual(await readFlow(target.caseId), target);
  await replaceStoredFlow(target.caseId, (payload) => {
    (payload.files as Array<Record<string, unknown>>).push({ ...source.file });
    return payload;
  });
  const db = await flowDatabase();
  await deleteFlowFileLedgerFixture(
    db,
    'consulting_flow_file_owners',
    source.file.id,
  );
  await db.prepare(consultingFlowFileOwnersBackfillSql).run();
  assert.equal(
    await db
      .prepare(
        'SELECT file_id FROM consulting_flow_file_owners WHERE file_id = ?1',
      )
      .bind(source.file.id)
      .first(),
    null,
  );
  await assert.rejects(
    readFlow(target.caseId),
    (error) => error instanceof FlowError && error.status === 503,
  );
  await assert.rejects(
    stateWithConsultingFlows(await readPortalState()),
    (error) => error instanceof FlowError && error.status === 503,
  );
  const response = await download(request(target.caseId, undefined), {
    params: Promise.resolve({ caseId: target.caseId, fileId: source.file.id }),
  });
  assert.equal(response.status, 503, await response.clone().text());
  assert.equal(
    await (await flowBucket().get(source.file.key))?.text(),
    'SYNTHETIC_ORIGINAL',
  );
});

void test('FLOW rejects valid-looking metadata drift for an existing owned file', async () => {
  const mutations: Array<{
    name: string;
    apply: (file: Record<string, unknown>) => void;
  }> = [
    {
      name: 'renamed file and matching MIME',
      apply: (file) => {
        file.name = 'renamed-report.md';
        file.contentType = 'text/markdown';
      },
    },
    {
      name: 'changed size',
      apply: (file) => {
        file.size = Number(file.size) + 1;
      },
    },
    {
      name: 'changed creation time',
      apply: (file) => {
        file.createdAt = '2026-09-05T03:00:00.000Z';
      },
    },
    {
      name: 'changed valid purpose',
      apply: (file) => {
        file.purpose = 'transcript';
      },
    },
    {
      name: 'added intake provenance',
      apply: (file) => {
        file.intakeFileId = 'different-intake-file';
      },
    },
  ];
  for (const mutation of mutations) {
    await deleteConsultingFlowFixture(await flowDatabase());
    const { saved, file } = await fixtureWithAttachment();
    const changed = structuredClone(saved);
    changed.revision++;
    changed.updatedAt = new Date().toISOString();
    const changedFile = changed.files.find((item) => item.id === file.id);
    assert.ok(changedFile);
    mutation.apply(changedFile as unknown as Record<string, unknown>);
    await assert.rejects(
      commitFlow(saved, changed),
      (error) => error instanceof FlowError && error.status === 503,
      `${mutation.name} before write`,
    );
    assert.deepEqual(await readFlow(saved.caseId), saved);
    await replaceStoredFlow(saved.caseId, (payload) => {
      const stored = (payload.files as Array<Record<string, unknown>>).find(
        (item) => item.id === file.id,
      );
      assert.ok(stored);
      mutation.apply(stored);
      return payload;
    });
    await assert.rejects(
      readFlow(saved.caseId),
      (error) => error instanceof FlowError && error.status === 503,
      mutation.name,
    );
  }
});

void test('FLOW metadata backfill restores every authoritative field for a clean existing file', async () => {
  await deleteConsultingFlowFixture(await flowDatabase());
  const { saved, file } = await fixtureWithAttachment();
  const db = await flowDatabase();
  await deleteFlowFileLedgerFixture(
    db,
    'consulting_flow_file_metadata',
    file.id,
  );
  await deleteFlowFileLedgerFixture(db, 'consulting_flow_file_owners', file.id);
  await assert.rejects(
    readFlow(saved.caseId),
    (error) => error instanceof FlowError && error.status === 503,
  );
  await db.prepare(consultingFlowFileOwnersBackfillSql).run();
  await db.prepare(consultingFlowFileMetadataBackfillSql).run();
  const owner = await db
    .prepare(
      `SELECT case_id, storage_key, original_name, content_type, size_bytes,
          created_at, purpose, intake_file_id, intake_source_hash,
          source_reviewed_at, source_reviewed_by
        FROM consulting_flow_file_owners owner
        JOIN consulting_flow_file_metadata metadata USING (file_id)
        WHERE owner.file_id = ?1`,
    )
    .bind(file.id)
    .first<Record<string, unknown>>();
  assert.ok(owner);
  assert.deepEqual(
    { ...owner },
    {
      case_id: saved.caseId,
      storage_key: file.key,
      original_name: file.name,
      content_type: file.contentType,
      size_bytes: file.size,
      created_at: file.createdAt,
      purpose: file.purpose,
      intake_file_id: null,
      intake_source_hash: null,
      source_reviewed_at: null,
      source_reviewed_by: null,
    },
  );
  assert.deepEqual(await readFlow(saved.caseId), saved);
});

void test('FLOW requires an R2 write binding and fails closed when its integrity row disappears', async () => {
  await deleteConsultingFlowFixture(await flowDatabase());
  const flow = await fixture();
  const missingBinding = structuredClone(flow);
  const now = new Date().toISOString();
  missingBinding.revision++;
  missingBinding.updatedAt = now;
  missingBinding.files.push({
    id: `unbound-${++sequence}`,
    name: 'unbound.txt',
    contentType: 'text/plain',
    size: 1,
    key: flowFileStorageKey(`unbound-${sequence}`),
    createdAt: now,
    purpose: 'source',
  });
  await assert.rejects(
    commitFlow(flow, missingBinding),
    (error) => error instanceof FlowError && error.status === 503,
  );
  assert.deepEqual(await readFlow(flow.caseId), flow);

  const { saved, file } = await fixtureWithAttachment();
  const db = await flowDatabase();
  const stored = await db
    .prepare(
      `SELECT validation_mode, r2_etag, r2_content_type
      FROM consulting_flow_file_object_integrity WHERE file_id = ?1`,
    )
    .bind(file.id)
    .first<{
      validation_mode: string;
      r2_etag: string | null;
      r2_content_type: string;
    }>();
  assert.deepEqual(
    { ...stored },
    {
      validation_mode: 'etag',
      r2_etag: (await flowBucket().head(file.key))?.etag,
      r2_content_type: file.contentType,
    },
  );
  await deleteFlowFileLedgerFixture(
    db,
    'consulting_flow_file_object_integrity',
    file.id,
  );
  await assert.rejects(
    readFlow(saved.caseId),
    (error) => error instanceof FlowError && error.status === 503,
  );
  assert.equal(
    (
      await download(request(saved.caseId, undefined), {
        params: Promise.resolve({ caseId: saved.caseId, fileId: file.id }),
      })
    ).status,
    503,
  );
  assert.equal(
    await db
      .prepare(
        'SELECT 1 FROM consulting_flow_file_object_integrity WHERE file_id = ?1',
      )
      .bind(file.id)
      .first(),
    null,
  );
});

void test('FLOW source archival advances the authoritative purpose in the same commit', async () => {
  await deleteConsultingFlowFixture(await flowDatabase());
  const flow = await fixture();
  const withSource = structuredClone(flow);
  const now = new Date().toISOString();
  const fileId = `archive-source-${++sequence}`;
  withSource.revision++;
  withSource.updatedAt = now;
  withSource.files.push({
    id: fileId,
    name: 'archive-source.txt',
    contentType: 'text/plain',
    size: 12,
    key: flowFileStorageKey(fileId),
    createdAt: now,
    purpose: 'source',
  });
  await commitFlow(
    flow,
    withSource,
    undefined,
    await storeFlowFileBinding(
      withSource.files.at(-1)!,
      new Uint8Array(withSource.files.at(-1)!.size),
    ),
  );
  const current = (await readFlow(flow.caseId))!;
  const archiveCommandId = `archive-${++sequence}`;
  const archived = applyFlowCommand(
    current,
    { type: 'exclude_source', fileId },
    { id: adminEmail, role: 'admin', name: '가상 대표' },
    { commandId: archiveCommandId, now: new Date().toISOString() },
  );
  addSyntheticCommandReceipt(archived, archiveCommandId);
  await commitFlow(current, archived);
  assert.equal(
    (
      await (
        await flowDatabase()
      )
        .prepare(
          'SELECT purpose FROM consulting_flow_file_metadata WHERE file_id = ?1',
        )
        .bind(fileId)
        .first<{ purpose: string }>()
    )?.purpose,
    'source_archived',
  );
  assert.equal(
    (await readFlow(flow.caseId))?.files.at(-1)?.purpose,
    'source_archived',
  );
  const db = await flowDatabase();
  await assert.rejects(
    db
      .prepare(
        'UPDATE consulting_flow_file_owners SET case_id = ?1 WHERE file_id = ?2',
      )
      .bind('other-case', fileId)
      .run(),
    /owner is immutable/,
  );
  await assert.rejects(
    db
      .prepare('DELETE FROM consulting_flow_file_owners WHERE file_id = ?1')
      .bind(fileId)
      .run(),
    /owner is durable/,
  );
  await assert.rejects(
    db
      .prepare(
        'UPDATE consulting_flow_file_metadata SET original_name = ?1 WHERE file_id = ?2',
      )
      .bind('tampered.txt', fileId)
      .run(),
    /metadata transition is invalid/,
  );
  await assert.rejects(
    db
      .prepare(
        "UPDATE consulting_flow_file_metadata SET purpose = 'source' WHERE file_id = ?1",
      )
      .bind(fileId)
      .run(),
    /metadata transition is invalid/,
  );
  await assert.rejects(
    db
      .prepare('DELETE FROM consulting_flow_file_metadata WHERE file_id = ?1')
      .bind(fileId)
      .run(),
    /metadata is durable/,
  );
  await assert.rejects(
    db
      .prepare(
        'UPDATE consulting_flow_file_object_integrity SET r2_content_type = ?1 WHERE file_id = ?2',
      )
      .bind('application/octet-stream', fileId)
      .run(),
    /object integrity is immutable/,
  );
  await assert.rejects(
    db
      .prepare(
        'DELETE FROM consulting_flow_file_object_integrity WHERE file_id = ?1',
      )
      .bind(fileId)
      .run(),
    /object integrity is durable/,
  );
});

void test('FLOW rejects a file key outside its ID-bound R2 namespace before detail, dashboard and download', async () => {
  const flow = await fixture();
  const foreignBytes = 'SYNTHETIC_FOREIGN_PRIVATE_OBJECT';
  const foreignKey = `company-source/foreign-flow-object-${++sequence}`;
  const fileId = `foreign-key-file-${sequence}`;
  await flowBucket().put(foreignKey, foreignBytes);
  await replaceStoredFlow(flow.caseId, (payload) => {
    (payload.files as Array<Record<string, unknown>>).push({
      id: fileId,
      name: 'foreign.txt',
      contentType: 'text/plain',
      size: foreignBytes.length,
      key: foreignKey,
      createdAt: payload.updatedAt,
      purpose: 'report',
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
  const response = await download(request(flow.caseId, undefined), {
    params: Promise.resolve({ caseId: flow.caseId, fileId }),
  });
  assert.equal(response.status, 503, await response.clone().text());
  assert.equal(
    await (await flowBucket().get(foreignKey))?.text(),
    foreignBytes,
  );
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
  await deleteConsultingFlowFixture(await flowDatabase());
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
  await deleteConsultingFlowFixture(await flowDatabase());
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
  await deleteConsultingFlowFixture(await flowDatabase());
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
  await deleteConsultingFlowFixture(await flowDatabase());
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
  await deleteConsultingFlowFixture(await flowDatabase());
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
  await deleteConsultingFlowFixture(await flowDatabase());
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
    await deleteConsultingFlowFixture(await flowDatabase());
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
    (payload) => {
      const reports = payload.reports as Array<Record<string, unknown>>;
      (payload.jobs as Array<Record<string, unknown>>).push({
        id: 'hidden-evidence-job',
        stage: 1,
        status: 'complete',
        reason: '',
        createdAt: payload.updatedAt,
        startedAt: payload.updatedAt,
        completedAt: payload.updatedAt,
        reportId: reports[0].id,
        evidence: {
          auditId: 'hidden-evidence-audit',
          instructionVersion: 'synthetic-flow-instruction-v1',
          requestedModel: 'claude-requested-test-model',
          providerRequestId: 'req_synthetic_flow',
          providerModel: 'claude-resolved-test-model',
          providerMessageId: 'msg_synthetic_flow',
          inputTokens: 10,
          outputTokens: 20,
          observedAt: payload.updatedAt,
          futurePrivateValue: '숨김 공급자 값',
        },
      });
    },
    (payload) => {
      (payload.jobs as Array<Record<string, unknown>>).push({
        id: 'hidden-failure-evidence-job',
        stage: 1,
        status: 'failed',
        reason: '가상 공급자 오류',
        createdAt: payload.updatedAt,
        startedAt: payload.updatedAt,
        failureEvidence: {
          auditId: 'hidden-failure-evidence-audit',
          instructionVersion: 'synthetic-flow-instruction-v1',
          requestedModel: 'claude-requested-test-model',
          httpStatus: 429,
          observedAt: payload.updatedAt,
          providerRequestId: 'req_synthetic_failure',
          futurePrivateValue: '숨김 공급자 오류 값',
        },
      });
    },
    (payload) => {
      (payload.jobs as Array<Record<string, unknown>>).push({
        id: 'hidden-failure-history-job',
        stage: 1,
        status: 'queued',
        reason: '',
        createdAt: payload.updatedAt,
        failureEvidenceHistory: [
          {
            auditId: 'hidden-failure-history-audit',
            instructionVersion: 'synthetic-flow-instruction-v1',
            requestedModel: 'claude-requested-test-model',
            httpStatus: 429,
            observedAt: payload.updatedAt,
            providerRequestId: 'req_synthetic_historical_failure',
            futurePrivateValue: '숨김 과거 오류 값',
          },
        ],
      });
    },
  ];
  for (const corrupt of corruptions) {
    await deleteConsultingFlowFixture(await flowDatabase());
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

void test('FLOW failure evidence requires one exact AI result audit record', async () => {
  const addLinkedFailure = (payload: Record<string, unknown>) => {
    const jobId = 'linked-failure-job';
    const at = payload.updatedAt as string;
    const auditId = `${jobId}-${at}`;
    const job = {
      id: jobId,
      stage: 1,
      status: 'failed',
      reason: '가상 공급자 오류',
      createdAt: at,
      startedAt: at,
      failureEvidence: {
        auditId,
        instructionVersion: 'synthetic-flow-instruction-v1',
        requestedModel: 'claude-requested-test-model',
        httpStatus: 429,
        observedAt: at,
        providerRequestId: 'req_synthetic_failure',
      },
    };
    const audit = {
      id: auditId,
      at,
      actor: '보고서 자동생성',
      action: 'ai_result',
      detail: '1차 정밀진단보고서 실패 · 가상 공급자 오류',
    };
    (payload.jobs as Array<Record<string, unknown>>).push(job);
    (payload.audit as Array<Record<string, unknown>>).push(audit);
    return { job, audit };
  };

  await deleteConsultingFlowFixture(await flowDatabase());
  const validFlow = await fixture();
  await replaceStoredFlow(validFlow.caseId, (payload) => {
    addLinkedFailure(payload);
    return payload;
  });
  assert.ok(await readFlow(validFlow.caseId));
  await stateWithConsultingFlows(await readPortalState());

  const corruptions: Array<
    (job: Record<string, unknown>, audit: Record<string, unknown>) => void
  > = [
    (job) => {
      (job.failureEvidence as Record<string, unknown>).auditId =
        'missing-ai-result-audit';
    },
    (_job, audit) => {
      audit.action = 'not_ai_result';
    },
    (job) => {
      job.failureEvidenceHistory = [
        { ...(job.failureEvidence as Record<string, unknown>) },
      ];
    },
  ];
  for (const corrupt of corruptions) {
    await deleteConsultingFlowFixture(await flowDatabase());
    const flow = await fixture();
    await replaceStoredFlow(flow.caseId, (payload) => {
      const { job, audit } = addLinkedFailure(payload);
      corrupt(job, audit);
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

void test('FLOW success evidence requires its exact completion audit record', async () => {
  const addLinkedSuccess = (payload: Record<string, unknown>) => {
    const jobId = 'linked-success-job';
    const at = payload.updatedAt as string;
    const auditId = `${jobId}-${at}`;
    const reports = payload.reports as Array<Record<string, unknown>>;
    const job = {
      id: jobId,
      stage: 1,
      status: 'complete',
      reason: '',
      createdAt: at,
      startedAt: at,
      completedAt: at,
      reportId: reports[0].id,
      evidence: {
        auditId,
        instructionVersion: 'synthetic-flow-instruction-v1',
        requestedModel: 'claude-requested-test-model',
        providerRequestId: 'req_synthetic_success',
        providerModel: 'claude-resolved-test-model',
        providerMessageId: 'msg_synthetic_success',
        inputTokens: 10,
        outputTokens: 20,
        observedAt: at,
      },
    };
    const audit = {
      id: auditId,
      at,
      actor: '보고서 자동생성',
      action: 'ai_result',
      detail: '1차 정밀진단보고서 자동 저장 · 담당 파트너 공유',
    };
    (payload.jobs as Array<Record<string, unknown>>).push(job);
    (payload.audit as Array<Record<string, unknown>>).push(audit);
    return { job, audit };
  };

  await deleteConsultingFlowFixture(await flowDatabase());
  const validFlow = await fixture();
  await replaceStoredFlow(validFlow.caseId, (payload) => {
    addLinkedSuccess(payload);
    return payload;
  });
  assert.ok(await readFlow(validFlow.caseId));
  await stateWithConsultingFlows(await readPortalState());

  const corruptions: Array<
    (job: Record<string, unknown>, audit: Record<string, unknown>) => void
  > = [
    (job) => {
      (job.evidence as Record<string, unknown>).auditId =
        'missing-success-audit';
    },
    (_job, audit) => {
      audit.actor = '가상 변조 실행자';
    },
    (job) => {
      (job.evidence as Record<string, unknown>).observedAt =
        '2026-12-31T23:59:59.999Z';
    },
  ];
  for (const corrupt of corruptions) {
    await deleteConsultingFlowFixture(await flowDatabase());
    const flow = await fixture();
    await replaceStoredFlow(flow.caseId, (payload) => {
      const { job, audit } = addLinkedSuccess(payload);
      corrupt(job, audit);
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
            key: flowFileStorageKey('duplicate-hidden-file'),
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
    await deleteConsultingFlowFixture(await flowDatabase());
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
      key: flowFileStorageKey('semantic-hidden-file'),
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
    await deleteConsultingFlowFixture(await flowDatabase());
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
    ['action', 'actor', 'actorKey', 'fingerprint'],
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

void test('FLOW attachment download rejects same-size R2 byte or MIME replacement', async () => {
  for (const replacement of [
    { body: 'SYNTHETIC_REPLACED', contentType: 'text/plain' },
    { body: 'SYNTHETIC_ORIGINAL', contentType: 'text/markdown' },
  ]) {
    const { saved, file } = await fixtureWithAttachment(),
      bucket = flowBucket();
    assert.equal(replacement.body.length, file.size);
    await bucket.put(file.key, replacement.body, {
      httpMetadata: { contentType: replacement.contentType },
    });
    const response = await download(request(saved.caseId, undefined), {
      params: Promise.resolve({ caseId: saved.caseId, fileId: file.id }),
    });
    assert.equal(response.status, 409, await response.clone().text());
    assert.deepEqual(await readFlow(saved.caseId), saved);
  }
});

void test('FLOW attachment download rejects stored metadata corruption introduced while R2 resolves', async () => {
  const { saved, file } = await fixtureWithAttachment(),
    bucket = flowBucket(),
    get = bucket.get.bind(bucket);
  bucket.get = async (...args: Parameters<R2Bucket['get']>) => {
    const object = await get(...args);
    await replaceStoredFlow(saved.caseId, (payload) => {
      (payload.files as Array<Record<string, unknown>>)[0].size = file.size + 1;
      return payload;
    });
    return object;
  };
  try {
    const response = await download(request(saved.caseId, undefined), {
      params: Promise.resolve({ caseId: saved.caseId, fileId: file.id }),
    });
    assert.equal(response.status, 503, await response.clone().text());
  } finally {
    bucket.get = get;
  }
  await assert.rejects(
    readFlow(saved.caseId),
    (error) => error instanceof FlowError && error.status === 503,
  );
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
