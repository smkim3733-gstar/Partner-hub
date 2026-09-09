import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  postgresRuntimeFixture,
  postgresTestOrigin as origin,
} from './supabase-runtime-fixture';
import {
  manualFlowCommand,
  manualFlowScenario,
} from './supabase-flow-manual-fixture';
import {
  newConsultingFlow,
  type ConsultingFlow,
  type FlowActor,
} from '../lib/consulting-flow';
import { claimFlowJob, finishFlowJob } from '../lib/consulting-flow-jobs';
import { hasProjectedConsultingFlowStructure } from '../lib/consulting-flow-shape';
import { PORTAL_OWNER_EMAIL } from '../lib/member-email';
import { provisionStandaloneAdmin } from '../lib/standalone-admin-store';

const { commitFlow, readFlow, stateWithConsultingFlows, flowDatabase } =
  await import('../lib/consulting-flow-store');
const { writePortalState, readPortalState, mutatePortalState } =
  await import('../lib/portal-state');
const { loginPassword, registerPassword } =
  await import('../lib/password-handlers');
const { GET, POST } = await import('../app/api/consulting-flow/[caseId]/route');
const { GET: download } =
  await import('../app/api/consulting-flow/[caseId]/files/[fileId]/route');
const admin: FlowActor = {
  id: 'synthetic-admin',
  role: 'admin',
  name: '김성민 대표',
};
const stamp = '2026-09-09T12:10:00.000Z';
const lease = '2026-09-09T12:11:00.000Z';
const end = '2026-09-09T12:12:00.000Z';
const raw = JSON.stringify;
const source =
  '합성 자료이며 실제 회사 자료와 외부 AI 호출을 사용하지 않습니다. '.repeat(
    12,
  );
type Fixture = Awaited<ReturnType<typeof postgresRuntimeFixture>>;
function rootWrite(f: Fixture, after: ConsultingFlow) {
  return f.db
    .prepare(
      'UPDATE consulting_flows SET revision=?1,payload=?2,updated_at=?3 WHERE case_id=?4',
    )
    .bind(after.revision, raw(after), after.updatedAt, after.caseId)
    .run();
}
function empty(caseId = 'native-flow') {
  return newConsultingFlow(caseId, '가상기업', 'synthetic-partner', '가상담당');
}
async function advance(
  flow: ConsultingFlow,
  command: Record<string, unknown>,
  id: string,
  now = stamp,
) {
  const transition = manualFlowCommand(
    flow,
    command as Parameters<typeof manualFlowCommand>[1],
    admin,
    id,
    now,
  );
  await commitFlow(transition.previous, transition.proposed);
  return transition.proposed;
}
const evidence = {
  instructionVersion: 'synthetic-v1',
  requestedModel: 'synthetic-model',
  providerRequestId: 'req_synthetic',
  providerModel: 'synthetic-model',
  providerMessageId: 'msg_synthetic',
  inputTokens: 10,
  outputTokens: 20,
  observedAt: end,
};

void test('native FLOW root executes the full 21-command application workflow with final file ledgers and redacted projection', async (t) => {
  const f = await postgresRuntimeFixture(t, { flowRoot: true });
  await f.engine.exec('SET ROLE service_role');
  const { transitions, flow } = await manualFlowScenario(f.engine);
  for (const { previous, proposed, command } of transitions) {
    const oldIds = new Set(previous.files.map((file) => file.id));
    const bindings = new Map(
      proposed.files
        .filter((file) => !oldIds.has(file.id))
        .map((file) => [
          file.id,
          {
            etag: `etag-${file.id}`,
            sha256: 'a'.repeat(64),
            contentType: file.contentType,
          },
        ]),
    );
    try {
      await commitFlow(
        previous,
        proposed,
        undefined,
        bindings.size ? bindings : undefined,
      );
    } catch (error) {
      assert.fail(
        `${command.type}: ${String(error)}; ${String(f.lastQueryError())}`,
      );
    }
    assert.deepEqual(
      await readFlow(flow.caseId),
      JSON.parse(raw(proposed)),
      command.type,
    );
  }
  const projected = await f.db
    .prepare(
      'SELECT partner_hub.flow_dashboard_payload(payload::json) AS payload FROM consulting_flows',
    )
    .first<string>('payload');
  assert.ok(projected);
  assert.equal(
    hasProjectedConsultingFlowStructure(JSON.parse(projected)),
    true,
  );
  for (const hidden of [
    '"body"',
    '"transcript"',
    '"files"',
    '"sourceText"',
    '"commandReceipts"',
    '"audit"',
    '"jobs"',
    'consulting-flow/',
  ])
    assert.equal(projected.includes(hidden), false, hidden);
  assert.equal(
    await f.db
      .prepare('SELECT count(*) AS n FROM consulting_flow_file_owners')
      .first('n'),
    flow.files.length,
  );
  assert.equal(await flowDatabase(), f.db);
});

void test('native root rejects forged receipts, hidden business rewrites and malformed direct inserts', async (t) => {
  const f = await postgresRuntimeFixture(t, { flowRoot: true });
  const before = await advance(
    empty(),
    { type: 'save_source', sourceText: source, privacyMasked: true },
    'initial-command',
  );
  const next = manualFlowCommand(
    before,
    { type: 'queue_report1' },
    admin,
    'queue-command',
    stamp,
  ).proposed;
  for (const edit of [
    (s: ConsultingFlow) => {
      s.commandReceipts!['queue-command'].actorKey = 'admin:forged';
    },
    (s: ConsultingFlow) => {
      s.commandReceipts!['queue-command'].actor = 'forged';
      s.audit.at(-1)!.actor = 'forged';
    },
    (s: ConsultingFlow) => {
      s.commandReceipts!['queue-command'].fingerprint = 'A'.repeat(64);
    },
    (s: ConsultingFlow) => {
      s.commandReceipts!['queue-command'].actorKey = 'member:other';
    },
  ]) {
    const forged = structuredClone(next);
    edit(forged);
    await assert.rejects(rootWrite(f, forged), /OPERATION_FAILED/);
    assert.deepEqual(await readFlow(before.caseId), before);
  }
  const hidden = structuredClone(before);
  hidden.revision++;
  hidden.ai.sourceText = 'uncommanded overwrite';
  await assert.rejects(rootWrite(f, hidden), /OPERATION_FAILED/);
  const seed = empty('forged-seed');
  seed.ai.enabled = true;
  await assert.rejects(
    f.db
      .prepare('INSERT INTO consulting_flows VALUES (?1,?2,?3,?4,?5)')
      .bind(
        seed.caseId,
        seed.partnerId,
        seed.revision,
        raw(seed),
        seed.updatedAt,
      )
      .run(),
    /OPERATION_FAILED/,
  );
  const stranded = empty('stranded-baseline');
  await assert.rejects(
    f.db
      .prepare('INSERT INTO consulting_flows VALUES (?1,?2,?3,?4,?5)')
      .bind(stranded.caseId, stranded.partnerId, 0, raw(stranded), '')
      .run(),
    /OPERATION_FAILED/,
  );
  assert.equal(await readFlow(stranded.caseId), null);
});

void test('native root binds AI claim, result report, audit and immutable history without a provider request', async (t) => {
  const f = await postgresRuntimeFixture(t, { flowRoot: true });
  let flow = await advance(
    empty(),
    { type: 'save_source', sourceText: source, privacyMasked: true },
    'source-command',
  );
  flow = await advance(
    flow,
    {
      type: 'set_ai_policy',
      enabled: true,
      thirdPartyConsent: true,
      privacyMasked: true,
      costConsent: true,
    },
    'enable-command',
  );
  flow = await advance(flow, { type: 'queue_report1' }, 'queue-command');
  const claimed = claimFlowJob(flow, flow.jobs[0].id, lease);
  await commitFlow(flow, claimed);
  const complete = finishFlowJob(claimed, claimed.jobs[0].id, lease, end, {
    body: source,
    evidence,
  });
  for (const edit of [
    (s: ConsultingFlow) => {
      s.company = 'forged company';
    },
    (s: ConsultingFlow) => {
      s.reports.at(-1)!.title = 'forged title';
    },
    (s: ConsultingFlow) => {
      s.reports.at(-1)!.createdBy = 'forged author';
    },
    (s: ConsultingFlow) => {
      s.reports.at(-1)!.version++;
    },
    (s: ConsultingFlow) => {
      s.audit.at(-1)!.detail = 'forged detail';
    },
    (s: ConsultingFlow) => {
      s.analysis.adminAt = end;
    },
    (s: ConsultingFlow) => {
      s.jobs[0].evidence!.observedAt = '2026-09-09T12:13:00.000Z';
    },
  ]) {
    const forged = structuredClone(complete);
    edit(forged);
    await assert.rejects(rootWrite(f, forged), /OPERATION_FAILED/);
  }
  const failed = finishFlowJob(claimed, claimed.jobs[0].id, lease, end, {
    error: 'synthetic provider failure',
    failureEvidence: {
      instructionVersion: 'synthetic-v1',
      requestedModel: 'synthetic-model',
      httpStatus: 503,
      observedAt: end,
    },
  });
  await commitFlow(claimed, failed);
  assert.deepEqual(await readFlow(failed.caseId), JSON.parse(raw(failed)));
  const retried = await advance(
    failed,
    { type: 'retry_job', jobId: failed.jobs[0].id, costConsent: true },
    'retry-command',
    '2026-09-09T12:13:00.000Z',
  );
  const reclaimed = claimFlowJob(
    retried,
    retried.jobs[0].id,
    '2026-09-09T12:14:00.000Z',
  );
  await commitFlow(retried, reclaimed);
  const later = '2026-09-09T12:15:00.000Z';
  const completed = finishFlowJob(
    reclaimed,
    reclaimed.jobs[0].id,
    reclaimed.jobs[0].startedAt!,
    later,
    { body: source, evidence: { ...evidence, observedAt: later } },
  );
  await commitFlow(reclaimed, completed);
  assert.deepEqual(
    await readFlow(completed.caseId),
    JSON.parse(raw(completed)),
  );
  assert.equal(completed.jobs[0].failureEvidenceHistory?.length, 1);
});

void test('native root final file guard rolls back missing ledgers and exact portal CAS remains atomic', async (t) => {
  const f = await postgresRuntimeFixture(t, { flowRoot: true });
  const before = await advance(
    empty(),
    { type: 'save_source', sourceText: source, privacyMasked: true },
    'source-command',
  );
  const file = {
    id: 'native-file',
    key: 'consulting-flow/native-file',
    name: 'synthetic.txt',
    contentType: 'text/plain',
    size: 100,
    createdAt: stamp,
    purpose: 'source',
  };
  const next = manualFlowCommand(
    before,
    { type: 'save_source', sourceText: source, privacyMasked: true },
    admin,
    'file-command',
    stamp,
    file,
  ).proposed;
  await assert.rejects(rootWrite(f, next), /OPERATION_FAILED/);
  assert.deepEqual(await readFlow(before.caseId), before);
  const emptyPortal = {
    version: 1,
    consultationNumber: 0,
    members: [],
    timeline: [],
    tasks: [],
    schedule: [],
    cases: [],
    companyDocuments: [],
  };
  await writePortalState(emptyPortal);
  const portal = await f.db
    .prepare("SELECT payload FROM portal_state WHERE id='keve-partner-hub'")
    .first<string>('payload');
  assert.ok(portal);
  const command = manualFlowCommand(
    before,
    { type: 'queue_report1' },
    admin,
    'cas-command',
    stamp,
  );
  await assert.rejects(commitFlow(before, command.proposed, `${portal} `), {
    status: 409,
  });
  assert.deepEqual(await readFlow(before.caseId), before);
  await commitFlow(before, command.proposed, portal);
  await assert.rejects(commitFlow(before, command.proposed, portal), {
    status: 409,
  });
  assert.deepEqual(
    await readFlow(before.caseId),
    JSON.parse(raw(command.proposed)),
  );
  await f.engine.exec('SET ROLE service_role');
  await assert.rejects(
    f.engine.exec('DELETE FROM partner_hub.consulting_flows'),
    /permission denied/,
  );
  await assert.rejects(
    f.engine.exec('TRUNCATE partner_hub.consulting_flows'),
    /permission denied/,
  );
  await f.engine.exec(
    'RESET ROLE; ALTER TABLE partner_hub.consulting_flows DISABLE TRIGGER consulting_flows_file_commit',
  );
  await assert.rejects(flowDatabase(), /OPERATION_FAILED/);
});

function request(path: string, body?: unknown, cookie = '') {
  return new Request(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      origin,
      ...(cookie ? { cookie } : {}),
      ...(body instanceof FormData
        ? {}
        : { 'content-type': 'application/json' }),
    },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : raw(body),
  });
}
async function status(response: Response, code: number) {
  assert.equal(response.status, code, await response.clone().text());
  return response;
}

void test('native PostgreSQL FLOW HTTP binds standalone sessions, partner assignment, command replay and attachment download', async (t) => {
  const f = await postgresRuntimeFixture(t, { flowRoot: true });
  const base = {
    version: 1,
    consultationNumber: 0,
    membersRevision: 0,
    members: [],
    timeline: [],
    tasks: [],
    schedule: [],
    cases: [],
    companyDocuments: [],
  };
  await writePortalState(base);
  const password = 'Synthetic PostgreSQL FLOW password!';
  await provisionStandaloneAdmin(f.db, {
    email: PORTAL_OWNER_EMAIL,
    password,
    deployment: 'remote',
  });
  const logged = await status(
    await loginPassword(
      request('/api/auth/login', { email: PORTAL_OWNER_EMAIL, password }),
    ),
    200,
  );
  const ownerCookie = logged.headers.get('set-cookie')!.split(';')[0];
  const email = 'native-flow-partner@example.invalid';
  await status(
    await registerPassword(
      request('/api/auth/register', {
        name: '가상담당',
        phone: '010-0000-0000',
        affiliation: '가상',
        email,
        password,
        consent: true,
      }),
    ),
    201,
  );
  type State = {
    members: Array<Record<string, unknown>>;
    cases: Array<Record<string, unknown>>;
  };
  await mutatePortalState((rawState) => {
    const state = rawState as State;
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
          id: 'http-native-flow',
          company: '가상기업',
          trainee: '가상담당',
          partnerMemberId: state.members[0].id,
          stage: '접수',
          consultationCount: 0,
        },
      ],
    };
  });
  const login = await status(
    await loginPassword(request('/api/auth/login', { email, password })),
    200,
  );
  const partnerCookie = login.headers.get('set-cookie')!.split(';')[0];
  const path = '/api/consulting-flow/http-native-flow';
  const context = { params: Promise.resolve({ caseId: 'http-native-flow' }) };
  await status(await GET(request(path), context), 401);
  const forged = new Request(`${origin}${path}`, {
    headers: {
      'oai-authenticated-user-id': 'forged',
      'oai-authenticated-user-email': PORTAL_OWNER_EMAIL,
    },
  });
  await status(await GET(forged, context), 401);
  await status(
    await GET(request(path, undefined, partnerCookie), context),
    200,
  );
  const input = {
    revision: 0,
    commandId: 'http-native-source',
    command: { type: 'save_source', sourceText: source, privacyMasked: true },
  };
  await status(await POST(request(path, input, partnerCookie), context), 403);
  await status(await POST(request(path, input, ownerCookie), context), 200);
  await status(await POST(request(path, input, ownerCookie), context), 200);
  const stored = await readFlow('http-native-flow');
  assert.ok(stored);
  assert.equal(
    stored.commandReceipts!['http-native-source'].actorKey,
    'admin:primary',
  );
  assert.equal(
    stored.commandReceipts!['http-native-source'].actor,
    '김성민 대표',
  );
  const form = new FormData();
  form.set(
    'payload',
    raw({
      revision: stored.revision,
      commandId: 'http-native-upload',
      command: {
        type: 'save_report',
        stage: 1,
        body: source,
        fileConsent: true,
      },
    }),
  );
  form.set(
    'file',
    new File(
      [new TextEncoder().encode('%PDF-1.4\n% synthetic fixture only\n%%EOF')],
      'synthetic.pdf',
      { type: 'application/pdf' },
    ),
  );
  await status(await POST(request(path, form, ownerCookie), context), 200);
  const uploaded = await readFlow(stored.caseId);
  assert.ok(uploaded);
  const attachment = uploaded.files.at(-1)!;
  const downloaded = await status(
    await download(
      request(`${path}/files/${attachment.id}`, undefined, partnerCookie),
      {
        params: Promise.resolve({
          caseId: stored.caseId,
          fileId: attachment.id,
        }),
      },
    ),
    200,
  );
  assert.match(await downloaded.text(), /^%PDF-1.4/);
  assert.equal(
    await f.db
      .prepare(
        'SELECT status FROM consulting_flow_upload_requests WHERE file_id=?1',
      )
      .bind(attachment.id)
      .first('status'),
    'ready',
  );
  await stateWithConsultingFlows(await readPortalState());
  await mutatePortalState((rawState) => ({
    ...(rawState as State),
    members: (rawState as State).members.map((member) => ({
      ...member,
      status: '정지',
    })),
  }));
  await status(
    await GET(request(path, undefined, partnerCookie), context),
    403,
  );
  await status(await GET(request(path, undefined, ownerCookie), context), 200);
});
