import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { env } from 'cloudflare:workers';
import {
  postgresRuntimeFixture,
  postgresTestOrigin as origin,
} from './supabase-runtime-fixture';
import { supabaseStorageHttpFixture } from './supabase-storage-http-fixture';
import { createSupabaseStorageBucket } from '../lib/supabase-storage-bucket';
import { createSupabaseStorageManifest } from '../lib/supabase-storage-manifest';
import {
  describeCompanyTransfer,
  describeFlowTransfer,
} from '../lib/file-transfer-contract';
import {
  directCompanyUpload,
  parseSupabaseTransferGrant,
} from '../lib/file-transfer-client.supabase';
import { hashPassword } from '../lib/password-crypto';
import { PORTAL_OWNER_EMAIL } from '../lib/member-email';
import { provisionStandaloneAdmin } from '../lib/standalone-admin-store';
import { flushWaitUntil } from './runtime-mock.mjs';
import type { ConsultingFlow } from '../lib/consulting-flow';

const { createSupabaseTransferHandler } =
  await import('../lib/supabase-file-transfer');
const { loginPassword } = await import('../lib/password-handlers');
const { writePortalState, readPortalState, mutatePortalState } =
  await import('../lib/portal-state');
const { GET: download } = await import('../app/api/files/[id]/route');
const { GET: flowDownload } =
  await import('../app/api/consulting-flow/[caseId]/files/[fileId]/route');
const { GET: getFlow, POST: postFlow } =
  await import('../app/api/consulting-flow/[caseId]/route');
const { serverRequestGate } =
  await import('../lib/platform-server-gate.supabase');
const member = {
  id: 'transfer-partner',
  name: '가상담당',
  email: 'transfer@example.invalid',
  status: '활성',
  permissions: {
    ownCases: true,
    fileUpload: true,
    collaborationApply: true,
    sharedSchedule: true,
    quoteContract: true,
  },
};
const caseId = 'case-draft-native-transfer';
const sha = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex');
async function status(response: Response, code: number) {
  assert.equal(response.status, code, await response.clone().text());
  return response;
}
type Result = {
  id: string;
  expiresAt: number;
  uploads: Record<
    string,
    {
      path: string;
      url: string;
      method: 'PUT';
      headers: { 'content-type': string };
    }
  >;
  file: { id: string };
  flow: { revision: number; files: { id: string }[] };
};
async function body(response: Response, code = 200) {
  return (await (await status(response, code)).json()) as Result;
}
function companyForm(
  bytes = new TextEncoder().encode('Synthetic transfer bytes\n'),
) {
  const form = new FormData();
  form.set(
    'file',
    new File([Uint8Array.from(bytes)], 'synthetic.txt', { type: 'text/plain' }),
  );
  for (const [key, value] of Object.entries({
    company: '가상기업',
    title: '합성 전송자료',
    category: '기타자료',
    consent: 'confirmed',
    caseId,
  }))
    form.set(key, value);
  return form;
}
async function setup(t: TestContext) {
  const f = await postgresRuntimeFixture(t, { flowRoot: true });
  const transport = supabaseStorageHttpFixture();
  const runtime = env as unknown as { AI_SOURCE_FILES: R2Bucket };
  const oldBucket = runtime.AI_SOURCE_FILES;
  runtime.AI_SOURCE_FILES = createSupabaseStorageBucket(
    transport.storage,
    createSupabaseStorageManifest(f.db),
  );
  t.after(async () => {
    await flushWaitUntil();
    runtime.AI_SOURCE_FILES = oldBucket;
  });
  const state = {
    version: 1,
    consultationNumber: 0,
    members: [member],
    cases: [
      {
        id: caseId,
        company: '가상기업',
        trainee: member.name,
        partnerMemberId: member.id,
        service: '정책자금',
      },
    ],
    companyDocuments: [],
    timeline: [],
    tasks: [],
    schedule: [],
  };
  await writePortalState(state);
  const password = 'Synthetic direct transfer password!';
  await provisionStandaloneAdmin(f.db, {
    email: PORTAL_OWNER_EMAIL,
    password,
    deployment: 'remote',
  });
  await f.db
    .prepare('INSERT INTO portal_password_accounts VALUES (?1,?2,?3,?4,?5,?5)')
    .bind(
      member.id,
      member.email,
      hashPassword(password),
      'transfer-credential',
      new Date().toISOString(),
    )
    .run();
  const request = (value: unknown, cookie = '') =>
    new Request(origin + '/api/blob-transfers', {
      method: 'POST',
      headers: { origin, cookie, 'content-type': 'application/json' },
      body: JSON.stringify(value),
    });
  const login = async (email = member.email) =>
    (
      await status(await loginPassword(request({ email, password })), 200)
    ).headers
      .get('set-cookie')!
      .split(';')[0];
  const partnerCookie = await login(),
    adminCookie = await login(PORTAL_OWNER_EMAIL);
  const handler = createSupabaseTransferHandler(
    f.db,
    { appOrigin: origin },
    transport.storage,
  );
  const send = (value: unknown, cookie = partnerCookie) =>
    handler(request(value, cookie));
  const prepare = async (
    form = companyForm(),
    key = sha(randomUUID()),
    cookie = partnerCookie,
  ) =>
    body(
      await send(
        { action: 'prepare', intent: await describeCompanyTransfer(form, key) },
        cookie,
      ),
    );
  const stage = async (grant: Result, form: FormData) => {
    for (const [slot, value] of form)
      if (value instanceof File) {
        const upload = grant.uploads[slot];
        await status(
          await transport.browserUpload(upload.url, {
            method: upload.method,
            headers: upload.headers,
            body: value,
            credentials: 'omit',
            cache: 'no-store',
            redirect: 'error',
            referrerPolicy: 'no-referrer',
          }),
          200,
        );
      }
  };
  const finish = (id: string, cookie = partnerCookie) =>
    send({ action: 'finish', id }, cookie);
  const count = (table: string) =>
    f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<number>('n');
  return {
    ...f,
    transport,
    handler,
    request,
    send,
    prepare,
    stage,
    finish,
    count,
    login,
    partnerCookie,
    adminCookie,
    state,
  };
}

void test('Supabase browser upload exceeds Vercel body limit using real PostgreSQL, HTTP storage adapter and original file receipts', async (t) => {
  const f = await setup(t);
  const bytes = new TextEncoder().encode(
    'synthetic original\n'.repeat(300_000),
  );
  assert.ok(bytes.length > 4.5 * 1024 * 1024);
  const form = companyForm(bytes),
    key = sha('large-browser-file');
  const controls: unknown[] = [];
  let lastId = '';
  t.mock.method(
    globalThis,
    'fetch',
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith('https:'))
        return f.transport.browserUpload(input, init);
      assert.equal(url, '/api/blob-transfers');
      assert.equal(init?.credentials, 'same-origin');
      assert.equal(typeof init?.body, 'string');
      assert.ok(
        (init!.body as string).length < 16384,
        'Vercel receives JSON, not file bytes',
      );
      const value = JSON.parse(init!.body as string);
      controls.push(value);
      const response = await f.send(value);
      if (value.action === 'prepare')
        lastId = ((await response.clone().json()) as Result).id;
      return response;
    },
  );
  const saved = await body(await directCompanyUpload(form, key), 201);
  assert.equal(controls.length, 2);
  assert.equal(await f.count('supabase_file_transfers'), 1);
  assert.equal(await f.count('company_file_objects'), 1);
  assert.equal(await f.count('storage_object_heads'), 1);
  assert.equal(await f.count('storage_object_versions'), 1);
  assert.equal(
    f.transport.objects.size,
    2,
    'staging and immutable final object are separate',
  );
  const retry = await body(await f.finish(lastId), 201);
  assert.equal(retry.file.id, saved.file.id);
  assert.equal(await f.count('storage_object_versions'), 1);
  const request = new Request(`${origin}/api/files/${saved.file.id}`, {
    headers: { cookie: f.partnerCookie },
  });
  assert.equal(
    serverRequestGate(request),
    null,
    'authorized download streams through existing route',
  );
  const response = await status(
    await download(request, { params: Promise.resolve({ id: saved.file.id }) }),
    200,
  );
  assert.equal(
    response.headers.get('cache-control'),
    'private, no-store, max-age=0',
  );
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  const multipart = new Request(`${origin}/api/files`, {
    method: 'POST',
    headers: { origin },
    body: form,
  });
  assert.equal(serverRequestGate(multipart)?.status, 400);
  const rows = await f.db
    .prepare('SELECT * FROM supabase_file_transfers')
    .all<Record<string, unknown>>();
  assert.doesNotMatch(
    JSON.stringify(rows.results),
    /header\.payload\.signature|sb_secret_|token=/,
  );
  assert.notEqual(rows.results[0].session_hash, f.partnerCookie.split('=')[1]);
  const smallForm = companyForm();
  const nearDeadline = await f.prepare(smallForm, sha('near-deadline'));
  await f.stage(nearDeadline, smallForm);
  const clock = t.mock.method(
    Date,
    'now',
    () => nearDeadline.expiresAt - 30_000,
  );
  await status(await f.finish(nearDeadline.id), 201);
  clock.mock.restore();
});

void test('Supabase transfer rejects forged scopes, missing or corrupt staging bytes and never publishes unknown writes', async (t) => {
  const f = await setup(t),
    form = companyForm();
  const intent = await describeCompanyTransfer(form, sha('guarded-file'));
  await status(await f.send({ action: 'prepare', intent }, ''), 401);
  const cross = f.request({ action: 'prepare', intent }, f.partnerCookie);
  cross.headers.set('origin', 'https://other.invalid');
  await status(await f.handler(cross), 403);
  await status(
    await f.send({
      action: 'prepare',
      intent: { ...intent, fields: { ...intent.fields, consent: 'no' } },
    }),
    403,
  );
  await status(
    await f.send({ action: 'prepare', intent, url: 'https://other.invalid' }),
    400,
  );
  assert.equal(await f.count('supabase_file_transfers'), 0);
  const grant = await f.prepare(form, intent.requestKey);
  assert.ok(!JSON.stringify(grant).includes(f.transport.config.secretKey));
  await status(await f.finish(grant.id, f.adminCookie), 403);
  await status(await f.finish(grant.id), 409);
  await status(
    await f.send({ action: 'finish', id: grant.id, path: 'victim' }),
    400,
  );
  await status(
    await f.send({
      type: 'blob.upload-completed',
      payload: { url: 'https://other.invalid' },
    }),
    400,
  );
  await f.stage(grant, form);
  const object = f.transport.objects.get(grant.uploads.file.path)!;
  object[0] ^= 1;
  await status(await f.finish(grant.id), 503);
  assert.equal(await f.count('company_file_objects'), 0);
  assert.equal(await f.count('storage_object_heads'), 0);
  object[0] ^= 1;
  f.transport.corruptRead();
  await status(await f.finish(grant.id), 503);
  f.transport.corruptRead(false);
  const saved = await body(await f.finish(grant.id), 201);
  assert.ok(saved.file.id);
  await assert.rejects(
    f.db
      .prepare('UPDATE supabase_file_transfers SET user_id = ?1 WHERE id = ?2')
      .bind('other', grant.id)
      .run(),
  );
  await assert.rejects(
    f.db
      .prepare('DELETE FROM supabase_file_transfers WHERE id = ?1')
      .bind(grant.id)
      .run(),
  );
  for (const role of ['anon', 'authenticated']) {
    await f.engine.exec(`SET ROLE ${role}`);
    await assert.rejects(
      f.engine.exec('SELECT * FROM partner_hub.supabase_file_transfers'),
      /permission denied/,
    );
    await f.engine.exec('RESET ROLE');
  }
  f.transport.failSign();
  const response = await status(
    await f.send({ action: 'prepare', intent }),
    503,
  );
  assert.ok(!(await response.text()).includes(f.transport.config.secretKey));
  assert.equal(await f.count('company_file_objects'), 1);
});

void test('Supabase transfer rechecks account, session and expiry after Storage I/O and preserves abandoned originals', async (t) => {
  const f = await setup(t),
    form = companyForm(),
    grant = await f.prepare(form);
  await f.stage(grant, form);
  const newCookie = await f.login();
  await status(await f.finish(grant.id, newCookie), 403);
  f.transport.onRead(async () => {
    await f.db
      .prepare('DELETE FROM portal_password_sessions WHERE token_hash = ?1')
      .bind(sha(f.partnerCookie.split('=')[1]))
      .run();
  });
  await status(await f.finish(grant.id), 401);
  assert.equal(await f.count('company_file_objects'), 0);
  assert.equal(f.transport.objects.size, 1);
  f.transport.onRead();
  const fresh = await f.prepare(form, sha('fresh-file'), newCookie);
  await f.stage(fresh, form);
  const date = t.mock.method(Date, 'now', () => fresh.expiresAt);
  await status(await f.finish(fresh.id, newCookie), 403);
  date.mock.restore();
  f.transport.onRead(async () => {
    await mutatePortalState((value) => ({
      ...(value as typeof f.state),
      members: [{ ...member, status: '정지' }],
    }));
  });
  await status(await f.finish(fresh.id, newCookie), 403);
  assert.equal(await f.count('company_file_objects'), 0);
  assert.equal(f.transport.objects.size, 2);
});

void test('Supabase FLOW transfer retains real file reservations, revision conflicts, retries and private download', async (t) => {
  const f = await setup(t);
  const context = { params: Promise.resolve({ caseId }) };
  const initial = await body(
    await getFlow(
      new Request(`${origin}/api/consulting-flow/${caseId}`, {
        headers: { cookie: f.adminCookie },
      }),
      context,
    ),
  );
  const form = new FormData();
  form.set(
    'file',
    new File(['Synthetic FLOW source'], 'flow.txt', { type: 'text/plain' }),
  );
  form.set(
    'payload',
    JSON.stringify({
      commandId: 'synthetic-supabase-flow',
      revision: initial.flow.revision,
      command: { type: 'save_source', fileConsent: true, privacyMasked: true },
    }),
  );
  const intent = await describeFlowTransfer(caseId, form);
  const grant = await body(
    await f.send(
      {
        action: 'prepare',
        intent: { ...intent, payload: form.get('payload') },
      },
      f.adminCookie,
    ),
  );
  await f.stage(grant, form);
  const saved = await body(await f.finish(grant.id, f.adminCookie));
  const repeated = await body(await f.finish(grant.id, f.adminCookie));
  assert.equal(repeated.flow.revision, saved.flow.revision);
  assert.equal(await f.count('consulting_flow_file_owners'), 1);
  assert.equal(await f.count('consulting_flow_upload_completions'), 1);
  const id = saved.flow.files[0].id;
  const response = await status(
    await flowDownload(
      new Request(`${origin}/api/consulting-flow/${caseId}/files/${id}`, {
        headers: { cookie: f.partnerCookie },
      }),
      { params: Promise.resolve({ caseId, fileId: id }) },
    ),
    200,
  );
  assert.equal(await response.text(), 'Synthetic FLOW source');
  form.set(
    'payload',
    JSON.stringify({
      commandId: 'synthetic-stale-flow',
      revision: initial.flow.revision,
      command: { type: 'save_source', fileConsent: true, privacyMasked: true },
    }),
  );
  const stale = await describeFlowTransfer(caseId, form);
  await status(
    await f.send(
      { action: 'prepare', intent: { ...stale, payload: form.get('payload') } },
      f.adminCookie,
    ),
    409,
  );
  assert.equal(await f.count('supabase_file_transfers'), 1);
  assert.equal(((await readPortalState()) as typeof f.state).cases.length, 1);
});

void test('Supabase staging enforces provider limits and per-user retention quota across new logins', async (t) => {
  const f = await setup(t),
    form = companyForm();
  for (const value of [null, 0, 26 * 1024 * 1024, '26214400']) {
    f.transport.bucket.file_size_limit = value;
    await status(
      await f.send({
        action: 'prepare',
        intent: await describeCompanyTransfer(form, sha('limit')),
      }),
      503,
    );
  }
  f.transport.bucket.file_size_limit = 25 * 1024 * 1024;
  f.transport.bucket.public = true;
  await assert.rejects(
    f.transport.storage.signStagingUpload(
      `partner-hub/staging/v1/${randomUUID()}`,
    ),
  );
  f.transport.bucket.public = false;
  f.transport.bucket.allowed_mime_types = ['*/*'];
  await assert.rejects(
    f.transport.storage.signStagingUpload(
      `partner-hub/staging/v1/${randomUUID()}`,
    ),
  );
  f.transport.bucket.allowed_mime_types = ['application/octet-stream'];
  assert.equal(await f.count('supabase_file_transfers'), 0);
  const base = await f.prepare(form),
    row = await f.db
      .prepare('SELECT * FROM supabase_file_transfers WHERE id = ?1')
      .bind(base.id)
      .first<Record<string, unknown>>();
  assert.ok(row);
  for (let index = 1; index < 20; index++) {
    await f.db
      .prepare(`INSERT INTO supabase_file_transfers (id,user_id,session_hash,intent,payload,file_path,audio_path,created_at,expires_at,retain_until)
      VALUES (?1,?2,?3,?4,NULL,?5,NULL,?6,?7,?8)`)
      .bind(
        randomUUID(),
        row.user_id,
        row.session_hash,
        row.intent,
        `partner-hub/staging/v1/${randomUUID()}`,
        row.created_at,
        row.expires_at,
        row.retain_until,
      )
      .run();
  }
  const signCount = f.transport.calls.filter((call) =>
    call.path.startsWith('/object/upload/sign/'),
  ).length;
  const cookie = await f.login();
  await status(
    await f.send(
      {
        action: 'prepare',
        intent: await describeCompanyTransfer(form, sha('over-quota')),
      },
      cookie,
    ),
    429,
  );
  assert.equal(
    f.transport.calls.filter((call) =>
      call.path.startsWith('/object/upload/sign/'),
    ).length,
    signCount,
  );
  assert.equal(await f.count('supabase_file_transfers'), 20);
});

void test('Supabase browser validates all grant destinations and strips arbitrary credentials before sending any bytes', () => {
  const path = `partner-hub/staging/v1/${randomUUID()}`;
  const upload = {
    path,
    url: `https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/upload/sign/private/${path}?token=h.p.s`,
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
  };
  const good = {
    id: randomUUID(),
    expiresAt: Date.now() + 600_000,
    uploads: { file: upload },
  };
  assert.deepEqual(parseSupabaseTransferGrant(good, ['file']), good);
  for (const url of [
    upload.url.replace('https:', 'http:'),
    upload.url.replace('.supabase.co', '.supabase.co.evil.invalid'),
    `${upload.url}&upsert=true`,
    `${upload.url}#extra`,
    upload.url.replace('/staging/', '/objects/'),
    upload.url.replace('/private/', '/private/../private/'),
    upload.url.replace('?token=', '?other='),
  ])
    assert.throws(() =>
      parseSupabaseTransferGrant(
        { ...good, uploads: { file: { ...upload, url } } },
        ['file'],
      ),
    );
  assert.throws(() =>
    parseSupabaseTransferGrant({ ...good, expiresAt: Date.now() - 1 }, [
      'file',
    ]),
  );
  assert.throws(() => parseSupabaseTransferGrant(good, ['file', 'audio']));
  assert.throws(() =>
    parseSupabaseTransferGrant(
      {
        ...good,
        uploads: {
          file: {
            ...upload,
            headers: { ...upload.headers, authorization: 'service-secret' },
          },
        },
      },
      ['file'],
    ),
  );
  assert.throws(() =>
    parseSupabaseTransferGrant(
      { ...good, uploads: { file: upload, audio: upload } },
      ['file', 'audio'],
    ),
  );
});

void test('Supabase two-slot recording preserves 5MiB text plus 25MiB audio and commits both only after verification', async (t) => {
  const f = await setup(t);
  const context = { params: Promise.resolve({ caseId }) };
  let flow = (
    (await (
      await status(
        await getFlow(
          new Request(`${origin}/api/consulting-flow/${caseId}`, {
            headers: { cookie: f.adminCookie },
          }),
          context,
        ),
        200,
      )
    ).json()) as { flow: ConsultingFlow }
  ).flow;
  const accept = async (response: Response) => {
    flow = (
      (await (await status(response, 200)).json()) as { flow: ConsultingFlow }
    ).flow;
  };
  const command = async (value: object, cookie = f.adminCookie) =>
    accept(
      await postFlow(
        new Request(`${origin}/api/consulting-flow/${caseId}`, {
          method: 'POST',
          headers: { origin, cookie, 'content-type': 'application/json' },
          body: JSON.stringify({
            commandId: randomUUID(),
            revision: flow.revision,
            command: value,
          }),
        }),
        context,
      ),
    );
  const text =
    '합성 상담 자료입니다. 실제 업무 정보나 고객의 개인정보는 포함하지 않습니다. '.repeat(
      100,
    );
  await command({ type: 'save_source', sourceText: text, privacyMasked: true });
  await command({ type: 'save_report', stage: 1, body: text });
  await command({
    type: 'confirm_analysis',
    reportId: flow.reports.at(-1)!.id,
  });
  await command(
    { type: 'confirm_analysis', reportId: flow.reports.at(-1)!.id },
    f.partnerCookie,
  );
  await command({
    type: 'book_meeting',
    kind: 'first',
    attendance: 'both',
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2026-01-01T01:00:00.000Z',
    location: '합성 상담실',
  });
  await command({ type: 'save_report', stage: 2, body: text });
  const prepareFlow = async (form: FormData, cookie = f.adminCookie) =>
    body(
      await f.send(
        {
          action: 'prepare',
          intent: {
            ...(await describeFlowTransfer(caseId, form)),
            payload: form.get('payload'),
          },
        },
        cookie,
      ),
    );
  const report = new FormData();
  report.set(
    'payload',
    JSON.stringify({
      commandId: randomUUID(),
      revision: flow.revision,
      command: { type: 'save_report', stage: 3, fileConsent: true },
    }),
  );
  report.set(
    'file',
    new File(['%PDF-1.7\nsynthetic presentation\n%%EOF'], 'synthetic.pdf', {
      type: 'application/pdf',
    }),
  );
  const reportGrant = await prepareFlow(report);
  await f.stage(reportGrant, report);
  await accept(await f.finish(reportGrant.id, f.adminCookie));
  await command({
    type: 'complete_meeting',
    meetingId: flow.meetings.at(-1)!.id,
  });
  const fileBytes = new Uint8Array(5 * 1024 * 1024).fill(83),
    audioBytes = new Uint8Array(25 * 1024 * 1024);
  audioBytes.set(new TextEncoder().encode('RIFF0000WAVE'));
  const recording = new FormData();
  recording.set(
    'payload',
    JSON.stringify({
      commandId: randomUUID(),
      revision: flow.revision,
      command: {
        type: 'save_recording',
        meetingId: flow.meetings.at(-1)!.id,
        recordingConsent: true,
        privacyMasked: true,
        transcriptReviewed: true,
        transcript: text,
        fileConsent: true,
      },
    }),
  );
  recording.set(
    'file',
    new File([fileBytes], 'synthetic.txt', { type: 'text/plain' }),
  );
  recording.set(
    'audio',
    new File([audioBytes], 'synthetic.wav', { type: 'audio/wav' }),
  );
  const grant = await prepareFlow(recording, f.partnerCookie);
  const partial = new FormData();
  partial.set('file', recording.get('file')!);
  await f.stage(grant, partial);
  const before = flow.revision;
  await status(await f.finish(grant.id), 409);
  assert.equal(
    await f.count('consulting_flow_file_owners'),
    1,
    'missing second slot cannot commit the first',
  );
  const audioForm = new FormData();
  audioForm.set('audio', recording.get('audio')!);
  await f.stage(grant, audioForm);
  assert.notEqual(grant.uploads.file.path, grant.uploads.audio.path);
  await accept(await f.finish(grant.id));
  assert.equal(flow.revision, before + 1);
  assert.equal(await f.count('consulting_flow_file_owners'), 3);
  assert.equal(await f.count('consulting_flow_upload_completions'), 3);
  const repeated = await body(await f.finish(grant.id));
  assert.equal(repeated.flow.revision, flow.revision);
  const fileId = flow.recordings.at(-1)!.audioFileId!;
  const original = await status(
    await flowDownload(
      new Request(`${origin}/api/consulting-flow/${caseId}/files/${fileId}`, {
        headers: { cookie: f.partnerCookie },
      }),
      { params: Promise.resolve({ caseId, fileId }) },
    ),
    200,
  );
  assert.equal(
    sha(new Uint8Array(await original.arrayBuffer())),
    sha(audioBytes),
  );
  assert.equal(await f.count('storage_object_versions'), 3);
});

void test('Supabase signing rechecks session after an in-flight capability response without exposing the unused token', async (t) => {
  const f = await setup(t);
  f.transport.onSign(async () => {
    await f.db
      .prepare('DELETE FROM portal_password_sessions WHERE token_hash = ?1')
      .bind(sha(f.partnerCookie.split('=')[1]))
      .run();
  });
  const result = await status(
    await f.send({
      action: 'prepare',
      intent: await describeCompanyTransfer(companyForm(), sha('revoke-sign')),
    }),
    401,
  );
  assert.doesNotMatch(
    await result.text(),
    /header\.payload\.signature|token=|sb_secret_|staging/,
  );
  assert.equal(
    await f.count('supabase_file_transfers'),
    1,
    'reservation retained beyond provider capability lifetime',
  );
  assert.equal(await f.count('company_file_objects'), 0);
  assert.equal(f.transport.objects.size, 0);
});

void test('Supabase browser never retries an uncertain staging PUT or finish automatically', async (t) => {
  const filePath = `partner-hub/staging/v1/${randomUUID()}`;
  const grant = {
    id: randomUUID(),
    expiresAt: Date.now() + 600_000,
    uploads: {
      file: {
        path: filePath,
        url: `https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/upload/sign/private/${filePath}?token=h.p.s`,
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
      },
    },
  };
  for (const phase of ['PUT', 'finish']) {
    const calls: string[] = [];
    const mocked = t.mock.method(
      globalThis,
      'fetch',
      async (_url: unknown, init?: RequestInit) => {
        const action =
          init?.method === 'PUT'
            ? 'PUT'
            : JSON.parse(init?.body as string).action;
        calls.push(action);
        if (action === phase) throw new Error('synthetic lost response');
        return action === 'prepare'
          ? Response.json(grant)
          : new Response(null, { status: 200 });
      },
    );
    await assert.rejects(
      directCompanyUpload(companyForm(), sha(`unknown-${phase}`)),
      /synthetic lost response/,
    );
    assert.deepEqual(
      calls,
      phase === 'PUT' ? ['prepare', 'PUT'] : ['prepare', 'PUT', 'finish'],
    );
    mocked.mock.restore();
  }
});

void test('Supabase expiry during final physical storage prevents company and FLOW business commits without deleting recoverable bytes', async (t) => {
  const f = await setup(t);
  for (const kind of ['company', 'flow']) {
    let form: FormData, grant: Result;
    const cookie = kind === 'company' ? f.partnerCookie : f.adminCookie;
    if (kind === 'company') {
      form = companyForm();
      grant = await f.prepare(form);
    } else {
      form = new FormData();
      form.set(
        'file',
        new File(['Synthetic pending source'], 'source.txt', {
          type: 'text/plain',
        }),
      );
      form.set(
        'payload',
        JSON.stringify({
          commandId: randomUUID(),
          revision: 0,
          command: {
            type: 'save_source',
            fileConsent: true,
            privacyMasked: true,
          },
        }),
      );
      grant = await body(
        await f.send(
          {
            action: 'prepare',
            intent: {
              ...(await describeFlowTransfer(caseId, form)),
              payload: form.get('payload'),
            },
          },
          cookie,
        ),
      );
    }
    await f.stage(grant, form);
    let expired = false;
    const actualNow = Date.now;
    const clock = t.mock.method(Date, 'now', () =>
      expired ? grant.expiresAt : actualNow(),
    );
    f.transport.onRead(async (path) => {
      if (path.startsWith('partner-hub/objects/')) expired = true;
    });
    await status(await f.finish(grant.id, cookie), 403);
    clock.mock.restore();
    f.transport.onRead();
    assert.equal(
      expired,
      true,
      'deadline reached during final object verification, after initial dispatch checks',
    );
    assert.equal(await f.count('company_file_objects'), 0);
    assert.equal(await f.count('consulting_flows'), 0);
    assert.equal(await f.count('consulting_flow_file_owners'), 0);
  }
  assert.equal(
    f.transport.objects.size,
    4,
    'staging and final objects retained for a safe exact retry',
  );
  assert.equal(await f.count('storage_object_versions'), 2);
});
