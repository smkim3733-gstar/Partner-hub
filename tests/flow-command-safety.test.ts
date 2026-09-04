import test from 'node:test';
import assert from 'node:assert/strict';
import { POST, GET } from '../app/api/consulting-flow/[caseId]/route';
import { POST as run } from '../app/api/consulting-flow/[caseId]/run/route';
import { env } from 'cloudflare:workers';
import { GET as download } from '../app/api/consulting-flow/[caseId]/files/[fileId]/route';
import {
  applyFlowCommand,
  newConsultingFlow,
  type ConsultingFlow,
} from '../lib/consulting-flow';
import {
  commitFlow,
  readFlow,
  flowBucket,
  flowDatabase,
} from '../lib/consulting-flow-store';
import { readPortalState, writePortalState } from '../lib/portal-state';
import { readDuplicateRequestSummary } from '../lib/duplicate-request-metrics';
import { flushWaitUntil } from './runtime-mock.mjs';
import {
  flowCommandReceipt,
  isFlowCommandRetry,
} from '../lib/flow-command-receipt';
import type { PortalUser } from '../lib/portal-auth';

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

void test('FLOW duplicate payment requests persist one payment and accept an exact retry', async () => {
  const flow = await fixture(),
    signed = structuredClone(flow);
  signed.revision++;
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
async function suspend() {
  const state = (await readPortalState()) as {
    members: Array<{ status: string }>;
  };
  state.members[0].status = '정지';
  await writePortalState(state);
}

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
