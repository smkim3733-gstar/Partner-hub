import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import {
  postgresRuntimeFixture,
  postgresTestOrigin as origin,
} from './supabase-runtime-fixture';
import { objects, flushWaitUntil } from './runtime-mock.mjs';
import { PORTAL_OWNER_EMAIL } from '../lib/member-email';
import { hashPassword } from '../lib/password-crypto';
import { provisionStandaloneAdmin } from '../lib/standalone-admin-store';
import {
  manualFlowScenario,
  manualFlowCommand,
  manualFlowStamp,
} from './supabase-flow-manual-fixture';
import { newConsultingFlow, type FlowFile } from '../lib/consulting-flow';
import type { InventoryPage } from '../lib/file-inventory';
import type { RecoveryPreview } from '../lib/file-recovery';

// Auth-dependent modules must load after the native-auth fixture's loader.
const { GET: list } = await import('../app/api/admin/file-inventory/route');
const { GET: presence } =
  await import('../app/api/admin/file-inventory/[id]/presence/route');
const { GET: preview, POST: recover } =
  await import('../app/api/admin/file-inventory/[id]/recovery/route');
const { GET: getState } = await import('../app/api/state/route');
const { readPortalState, writePortalState, mutatePortalState } =
  await import('../lib/portal-state');
const { loginPassword } = await import('../lib/password-handlers');
const { requirePortalUser } = await import('../lib/portal-auth');
const { companyFileBucket, findCompanyFile } =
  await import('../lib/company-files');
const { storeCompanyUpload } = await import('../lib/company-upload-store');
const { currentFileAccess } = await import('../lib/company-file-access');
const { commitFlow, reserveFlowUploads, readFlow } =
  await import('../lib/consulting-flow-store');
const { checkInventoryPresence } = await import('../lib/file-inventory-store');
const member = {
  id: 'inventory-partner',
  name: '가상담당',
  email: 'inventory@example.invalid',
  status: '활성',
  permissions: {
    ownCases: true,
    fileUpload: true,
    collaborationApply: true,
    sharedSchedule: true,
    quoteContract: true,
  },
};
const caseId = 'case-draft-native-inventory';
const bytes = new TextEncoder().encode(
  '%PDF-1.7\nsynthetic inventory file\n%%EOF',
).buffer;
const sha = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
const context = (id: string) => ({ params: Promise.resolve({ id }) });
type Fixture = Awaited<ReturnType<typeof setup>>;

async function status(response: Response, code: number) {
  assert.equal(response.status, code, await response.clone().text());
  return response;
}
async function setup(t: TestContext) {
  const f = await postgresRuntimeFixture(t, { flowRoot: true });
  objects.clear();
  t.after(() => objects.clear());
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
    companyDocuments: [] as unknown[],
    timeline: [] as unknown[],
    tasks: [],
    schedule: [],
  };
  await writePortalState(state);
  const password = 'Synthetic inventory password!';
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
      'inventory-credential',
      new Date().toISOString(),
    )
    .run();
  const request = (
    path = '/api/admin/file-inventory',
    body?: unknown,
    cookie = '',
  ) =>
    new Request(`${origin}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { origin, cookie, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const login = async (email: string) =>
    (
      await status(
        await loginPassword(
          request('/api/password/login', { email, password }),
        ),
        200,
      )
    ).headers
      .get('set-cookie')!
      .split(';')[0];
  const adminCookie = await login(PORTAL_OWNER_EMAIL),
    partnerCookie = await login(member.email);
  const user = await requirePortalUser(
    request('/', undefined, partnerCookie),
    state,
  );
  const admin = await requirePortalUser(
    request('/', undefined, adminCookie),
    state,
  );
  const bucket = companyFileBucket();
  const upload = (key: string) =>
    storeCompanyUpload(
      f.db,
      bucket,
      user,
      key,
      {
        originalName: 'synthetic.pdf',
        company: '가상기업',
        category: '기타자료',
        title: '합성 재고자료',
        assignedTrainee: member.name,
        partnerMemberId: member.id,
        caseId,
        contentType: 'application/pdf',
        sizeBytes: bytes.byteLength,
      },
      bytes,
      [],
      async () =>
        (await currentFileAccess(request('/', undefined, partnerCookie), user))
          .payload,
    );
  const page = async (query = '') =>
    (await (
      await status(
        await list(
          request(`/api/admin/file-inventory${query}`, undefined, adminCookie),
        ),
        200,
      )
    ).json()) as InventoryPage;
  return {
    ...f,
    state,
    request,
    adminCookie,
    partnerCookie,
    admin,
    bucket,
    upload,
    page,
  };
}

// Deliberate corruption in an isolated, in-memory PostgreSQL engine only.
// Triggers are NOT disabled in source migrations or a remote database.
async function corrupt(
  f: Pick<Fixture, 'engine'>,
  query: string,
  parameters: unknown[] = [],
) {
  await f.engine.transaction(async (tx) => {
    await tx.exec("SET LOCAL session_replication_role = 'replica'");
    await tx.query(query, parameters);
  });
}

void test('native inventory routes require independent admin auth and preserve empty, linked, pending, deleted and proof coverage', async (t) => {
  const f = await setup(t);
  for (const cookie of ['', f.partnerCookie]) {
    const code = cookie ? 403 : 401;
    const request = f.request('/api/admin/file-inventory', undefined, cookie);
    await status(await list(request), code);
    await status(await presence(request, context('unknown')), code);
    await status(await preview(request, context('unknown')), code);
  }
  assert.deepEqual((await f.page()).integrityCoverage, {
    sha256: 0,
    etag: 0,
    metadata: 0,
    unavailable: 0,
  });
  const unlinked = await f.upload('native-unlinked'),
    linked = await f.upload('native-linked');
  await mutatePortalState((value) => ({
    ...(value as typeof f.state),
    companyDocuments: [{ storageFileId: linked.id }],
  }));
  await f.db
    .prepare(
      "INSERT INTO company_file_upload_requests VALUES (?1,?2,?3,?4,?5,'pending')",
    )
    .bind(
      `member:${member.id}`,
      'native-pending',
      'private-request-fingerprint',
      'native-pending-file',
      manualFlowStamp,
    )
    .run();
  const page = await f.page('?status=all');
  assert.equal(
    page.items.find((item) => item.id === unlinked.id)!.status,
    'unlinked',
  );
  assert.equal(
    page.items.find((item) => item.id === linked.id)!.status,
    'linked',
  );
  assert.equal(
    page.items.find((item) => item.id === 'native-pending-file')!.status,
    'pending',
  );
  assert.deepEqual(page.integrityCoverage, {
    sha256: 2,
    etag: 0,
    metadata: 0,
    unavailable: 0,
  });
  assert.equal((await f.page()).items.length, 1);
  assert.deepEqual(
    (await f.page('?status=inconsistent')).integrityCoverage,
    page.integrityCoverage,
  );
  assert.doesNotMatch(
    JSON.stringify(page),
    /private-request-fingerprint|storage_key|company-source\/|token_hash|"etag"\s*:\s*"/,
  );
  const head = await checkInventoryPresence(unlinked.id);
  assert.equal(head.exists, true);
  assert.equal(head.integrityProof, 'sha256');
  assert.equal(head.integrityMatches, true);
  assert.equal(
    (await checkInventoryPresence('native-pending-file')).integrityMode,
    null,
  );
  await f.db
    .prepare(
      "UPDATE company_file_upload_requests SET status='deleted' WHERE file_id=?1",
    )
    .bind(unlinked.id)
    .run();
  assert.equal(
    (await f.page('?status=all')).items.find((item) => item.id === unlinked.id)!
      .status,
    'deleted',
  );
  await f.db
    .prepare('DELETE FROM company_file_objects WHERE id=?1')
    .bind(unlinked.id)
    .run();
  assert.equal(
    (await f.page('?status=all')).items.some((item) => item.id === unlinked.id),
    false,
  );
  assert.equal(objects.size, 2, 'inventory never deletes bytes');
  await status(
    await list(
      f.request(
        '/api/admin/file-inventory?status=bad',
        undefined,
        f.adminCookie,
      ),
    ),
    400,
  );
});

void test('native recovery binds explicit confirmation, stable ownership, exact revisions and atomic document/timeline retry', async (t) => {
  const f = await setup(t);
  const file = await f.upload('native-recovery');
  const path = `/api/admin/file-inventory/${file.id}/recovery`;
  const candidate = (await (
    await status(
      await preview(
        f.request(path, undefined, f.adminCookie),
        context(file.id),
      ),
      200,
    )
  ).json()) as RecoveryPreview;
  const input = {
    ...candidate,
    expectedUserId: f.admin.id,
    requestId: 'native-recovery-request',
    reason: '합성 자료의 기존 접수 연결 복구',
    confirmed: true,
  };
  const send = (body: unknown = input, cookie = f.adminCookie) =>
    recover(f.request(path, body, cookie), context(file.id));
  await status(await send(input, f.partnerCookie), 403);
  await status(await send({ ...input, confirmed: false }), 400);
  await status(await send({ ...input, expectedUserId: 'other-admin' }), 403);
  await status(await send({ ...input, caseId: 'other-case' }), 409);
  await status(await send({ ...input, fileRevision: 'a'.repeat(64) }), 409);
  const crossSite = f.request(path, input, f.adminCookie);
  crossSite.headers.set('origin', 'https://other.example.invalid');
  await status(await recover(crossSite, context(file.id)), 403);
  const before = await readPortalState();
  await f.engine
    .exec(`CREATE FUNCTION partner_hub.synthetic_recovery_fail() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic recovery failure'; END $$;
    CREATE TRIGGER synthetic_recovery_fail BEFORE UPDATE ON partner_hub.portal_state
    FOR EACH ROW EXECUTE FUNCTION partner_hub.synthetic_recovery_fail()`);
  await status(await send(), 503);
  assert.deepEqual(await readPortalState(), before);
  await f.engine.exec(
    'DROP TRIGGER synthetic_recovery_fail ON partner_hub.portal_state',
  );
  await status(await send(), 200);
  const second = (await (await status(await send(), 200)).json()) as {
    alreadyLinked: boolean;
  };
  assert.equal(second.alreadyLinked, true);
  const state = (await readPortalState()) as typeof f.state;
  assert.equal(state.companyDocuments.length, 1);
  assert.equal(state.timeline.length, 1);
  assert.equal((await findCompanyFile(file.id))!.partner_member_id, member.id);
  assert.equal(objects.size, 1);
  assert.equal((await f.page('?status=linked')).items[0].id, file.id);
  await status(
    await preview(f.request(path, undefined, f.adminCookie), context(file.id)),
    409,
  );
  await status(
    await send({ ...input, requestId: 'another-recovery-request' }),
    409,
  );
  await flushWaitUntil();
});

void test('native recovery rejects changed FLOW, lifecycle and state observations, while legacy NULL ETag remains recoverable', async (t) => {
  const f = await setup(t);
  const file = await f.upload('native-recovery-observations');
  const path = `/api/admin/file-inventory/${file.id}/recovery`;
  const actor = { id: f.admin.id, name: '김성민 대표', role: 'admin' as const };
  const initial = newConsultingFlow(caseId, '가상기업', member.id, member.name);
  let flow = manualFlowCommand(
    initial,
    {
      type: 'save_source',
      sourceText: '합성 이전 검증 자료입니다. '.repeat(20),
      privacyMasked: true,
    },
    actor,
    'native-recovery-flow-start',
  ).proposed;
  await commitFlow(initial, flow);
  const getInput = async () => ({
    ...((await (
      await status(
        await preview(
          f.request(path, undefined, f.adminCookie),
          context(file.id),
        ),
        200,
      )
    ).json()) as RecoveryPreview),
    expectedUserId: f.admin.id,
    confirmed: true,
    requestId: 'native-observation-recovery',
    reason: '기존 접수의 합성 원본 회수',
  });
  let input = await getInput();
  const originalHead = f.bucket.head.bind(f.bucket);
  const head = t.mock.method(f.bucket, 'head', async (key: string) => {
    const result = await originalHead(key);
    const next = manualFlowCommand(
      flow,
      {
        type: 'save_source',
        sourceText: '다른 명령으로 갱신된 합성 자료입니다. '.repeat(20),
        privacyMasked: true,
      },
      actor,
      'native-recovery-flow-change',
    ).proposed;
    await commitFlow(flow, next);
    flow = next;
    return result;
  });
  await status(
    await recover(f.request(path, input, f.adminCookie), context(file.id)),
    409,
  );
  assert.equal(
    ((await readPortalState()) as typeof f.state).companyDocuments.length,
    0,
  );
  head.mock.restore();
  input = await getInput();
  const lifecycle = t.mock.method(f.bucket, 'head', async (key: string) => {
    const result = await originalHead(key);
    await f.db
      .prepare(
        "UPDATE company_file_upload_requests SET status='deleted' WHERE file_id=?1",
      )
      .bind(file.id)
      .run();
    return result;
  });
  await status(
    await recover(f.request(path, input, f.adminCookie), context(file.id)),
    409,
  );
  assert.equal(
    ((await readPortalState()) as typeof f.state).timeline.length,
    0,
  );
  lifecycle.mock.restore();

  // Synthetic legacy representation: no upload receipt, SHA or ETag. The
  // metadata-only mode must retain its NULL-safe final write comparison.
  const legacy = await f.upload('native-legacy-recovery');
  await corrupt(
    f,
    'DELETE FROM partner_hub.company_file_upload_requests WHERE file_id=$1',
    [legacy.id],
  );
  await corrupt(
    f,
    'DELETE FROM partner_hub.company_file_object_checksums WHERE file_id=$1',
    [legacy.id],
  );
  await corrupt(
    f,
    "UPDATE partner_hub.company_file_object_integrity SET validation_mode='metadata',r2_etag=NULL WHERE file_id=$1",
    [legacy.id],
  );
  assert.equal(
    (await f.page('?status=all')).items.find((item) => item.id === legacy.id)!
      .integrityProof,
    'metadata',
  );
  assert.equal(
    (await checkInventoryPresence(legacy.id)).integrityMatches,
    true,
  );
  const legacyInput = {
    ...((await (
      await status(
        await preview(
          f.request(path, undefined, f.adminCookie),
          context(legacy.id),
        ),
        200,
      )
    ).json()) as RecoveryPreview),
    expectedUserId: f.admin.id,
    confirmed: true,
    requestId: 'native-legacy-recovery-request',
    reason: '레거시 원본의 기존 접수 연결',
  };
  await status(
    await recover(
      f.request(path, legacyInput, f.adminCookie),
      context(legacy.id),
    ),
    200,
  );
  assert.equal(
    ((await readPortalState()) as typeof f.state).companyDocuments.length,
    1,
  );
});

void test('native inventory excludes malformed proofs, enforces canonical keys and keeps helpers private', async (t) => {
  const f = await setup(t);
  const file = await f.upload('native-proof-corruption');
  await corrupt(
    f,
    "UPDATE partner_hub.company_file_metadata SET content_type='text/plain' WHERE file_id=$1",
    [file.id],
  );
  let page = await f.page('?status=all');
  assert.equal(page.items[0].status, 'inconsistent');
  assert.equal(page.integrityCoverage.unavailable, 1);
  await corrupt(
    f,
    "UPDATE partner_hub.company_file_metadata SET content_type='application/pdf' WHERE file_id=$1",
    [file.id],
  );
  await corrupt(
    f,
    "UPDATE partner_hub.company_file_objects SET storage_key='unexpected/' || id WHERE id=$1",
    [file.id],
  );
  await corrupt(
    f,
    "UPDATE partner_hub.company_file_storage_keys SET storage_key='unexpected/' || file_id WHERE file_id=$1",
    [file.id],
  );
  page = await f.page('?status=all');
  assert.equal(page.items[0].integrityProof, null);
  assert.equal(page.integrityCoverage.sha256, 0);
  const head = t.mock.method(f.bucket, 'head', f.bucket.head.bind(f.bucket));
  await assert.rejects(checkInventoryPresence(file.id), { status: 503 });
  await status(
    await preview(
      f.request('/api/admin/file-inventory', undefined, f.adminCookie),
      context(file.id),
    ),
    503,
  );
  assert.equal(head.mock.callCount(), 0);
  for (const role of ['anon', 'authenticated']) {
    await f.engine.exec(`SET ROLE ${role}`);
    await assert.rejects(
      f.engine.query("SELECT partner_hub.inventory_json('{}')"),
      /permission denied/,
    );
    await assert.rejects(
      f.engine.query("SELECT partner_hub.inventory_unique_json('{}')"),
      /permission denied/,
    );
    await f.engine.exec('RESET ROLE');
  }
});

void test('native recovery API rejects cross-source ID collisions even when bypassing disabled UI controls', async (t) => {
  const f = await setup(t);
  const file = await f.upload('native-collision-recovery');
  const path = `/api/admin/file-inventory/${file.id}/recovery`;
  const candidate = (await (
    await status(
      await preview(
        f.request(path, undefined, f.adminCookie),
        context(file.id),
      ),
      200,
    )
  ).json()) as RecoveryPreview;
  await reserveFlowUploads({
    caseId,
    actorKey: 'admin:primary',
    commandId: 'native-collision-upload',
    fingerprint: 'a'.repeat(64),
    uploads: [
      {
        slot: 'file',
        file: {
          id: file.id,
          key: `consulting-flow/${file.id}`,
          name: 'synthetic.pdf',
          contentType: 'application/pdf',
          size: bytes.byteLength,
          purpose: 'report',
          createdAt: manualFlowStamp,
        },
      },
    ],
  });
  const head = t.mock.method(f.bucket, 'head', f.bucket.head.bind(f.bucket));
  await status(
    await preview(f.request(path, undefined, f.adminCookie), context(file.id)),
    409,
  );
  await status(
    await recover(
      f.request(
        path,
        {
          ...candidate,
          expectedUserId: f.admin.id,
          confirmed: true,
          requestId: 'native-collision-recovery-request',
          reason: '같은 식별자 원본의 합성 회수 시도',
        },
        f.adminCookie,
      ),
      context(file.id),
    ),
    409,
  );
  assert.equal(head.mock.callCount(), 0);
  assert.equal(
    ((await readPortalState()) as typeof f.state).companyDocuments.length,
    0,
  );
});

async function completeFlow(f: Pick<Fixture, 'engine' | 'bucket'>) {
  const { transitions } = await manualFlowScenario(f.engine);
  let flow = transitions[0].previous;
  for (const transition of transitions) {
    let upload = transition.upload;
    let audio: FlowFile | undefined;
    if (
      transition.command.type === 'save_recording' ||
      transition.command.type === 'save_transcript'
    ) {
      const recording = transition.command.type === 'save_recording';
      const id = `${transition.commandId}-attachment`;
      upload = {
        id,
        key: `consulting-flow/${id}`,
        purpose: recording ? 'recording' : 'transcript',
        name: 'synthetic.txt',
        contentType: 'text/plain',
        size: 100,
        createdAt: manualFlowStamp,
      };
      if (recording)
        audio = {
          ...upload,
          id: `${id}-audio`,
          key: `consulting-flow/${id}-audio`,
          name: 'synthetic.mp3',
          contentType: 'audio/mpeg',
        };
    }
    const next = manualFlowCommand(
      flow,
      { ...transition.command, fileConsent: true },
      transition.actor,
      transition.commandId,
      manualFlowStamp,
      upload,
      audio,
      upload?.intakeFileId ? '재무자료' : undefined,
    ).proposed;
    const receipt = next.commandReceipts![transition.commandId];
    receipt.fingerprint = sha(transition.commandId);
    const files = next.files.filter(
      (file) => !flow.files.some((old) => old.id === file.id),
    );
    const bindings = new Map<
      string,
      { etag: string; sha256: string; contentType: string }
    >();
    if (files.length) {
      await reserveFlowUploads({
        caseId: next.caseId,
        actorKey: receipt.actorKey,
        commandId: transition.commandId,
        fingerprint: receipt.fingerprint,
        uploads: files.map((file) => ({
          slot: file.id === audio?.id ? 'audio' : 'file',
          file,
        })),
      });
      for (const file of files) {
        const data = new Uint8Array(file.size).fill(65);
        const object = await f.bucket.put(file.key!, data, {
          httpMetadata: { contentType: file.contentType },
          sha256: createHash('sha256').update(data).digest(),
        });
        assert.ok(object);
        bindings.set(file.id, {
          etag: object.etag,
          sha256: sha(data),
          contentType: file.contentType,
        });
      }
    }
    await commitFlow(
      flow,
      next,
      undefined,
      bindings.size ? bindings : undefined,
      new Set(files.map((file) => file.id)),
    );
    flow = next;
  }
  return flow;
}

void test('native FLOW inventory binds real reservations, all upload actions, slot targets and damaged receipt envelopes', async (t) => {
  const f = await setup(t);
  const flow = await completeFlow(f);
  const page = await f.page('?status=all');
  assert.equal(
    page.items.filter((item) => item.source === 'flow').length,
    flow.files.length,
  );
  for (const file of flow.files.filter(
    (item) => item.purpose !== 'source_archived',
  )) {
    const item = page.items.find((item) => item.id === file.id)!;
    assert.equal(item.integrityProof, 'sha256', JSON.stringify(item));
    assert.equal(
      (await checkInventoryPresence(file.id)).integrityMatches,
      true,
    );
  }
  const target = flow.files.find((file) => file.purpose === 'transcript')!;
  assert.ok(target);
  const commandId = Object.keys(flow.commandReceipts!).find(
    (key) => flow.commandReceipts![key].action === 'save_transcript',
  )!;
  const saved = JSON.stringify(flow);
  const originalHead = f.bucket.head.bind(f.bucket);
  const head = t.mock.method(f.bucket, 'head', originalHead);
  for (const change of [
    (next: typeof flow) => {
      (
        next.files.find((file) => file.id === target.id)! as unknown as Record<
          string,
          unknown
        >
      ).intakeFileId = 123;
    },
    (next: typeof flow) => {
      next.files.push({ ...target });
    },
    (next: typeof flow) => {
      next.commandReceipts![commandId].actor = '\u00a0\ufeff';
    },
    (next: typeof flow) => {
      next.commandReceipts![commandId].fingerprint = 'a'.repeat(64);
    },
    (next: typeof flow) => {
      delete next.commandReceipts![commandId].targetId;
    },
    (next: typeof flow) => {
      next.recordings[0].transcriptFileId = 'other-file';
    },
    (next: typeof flow) => {
      (
        next.commandReceipts![commandId] as unknown as Record<string, unknown>
      ).privateExtra = 'hidden';
    },
    (next: typeof flow) => {
      next.audit.find((entry) => entry.id === commandId)!.detail = ' ';
    },
  ]) {
    const next = JSON.parse(saved) as typeof flow;
    change(next);
    await corrupt(
      f,
      'UPDATE partner_hub.consulting_flows SET payload=$1 WHERE case_id=$2',
      [JSON.stringify(next), flow.caseId],
    );
    const damaged = (await f.page('?status=all')).items.find(
      (item) => item.id === target.id,
    )!;
    assert.equal(damaged.status, 'inconsistent');
    assert.equal(damaged.integrityProof, null);
    const count = head.mock.callCount();
    await assert.rejects(checkInventoryPresence(target.id), { status: 503 });
    assert.equal(
      head.mock.callCount(),
      count,
      'damaged receipt fails before Storage head',
    );
  }
  await corrupt(
    f,
    'UPDATE partner_hub.consulting_flows SET payload=$1 WHERE case_id=$2',
    [saved, flow.caseId],
  );
  for (const invalid of [
    'not-json',
    saved.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
  ]) {
    await corrupt(
      f,
      'UPDATE partner_hub.consulting_flows SET payload=$1 WHERE case_id=$2',
      [invalid, flow.caseId],
    );
    const item = (await f.page('?status=all')).items.find(
      (file) => file.id === target.id,
    )!;
    assert.equal(item.status, 'inconsistent');
    assert.equal(item.integrityProof, null);
  }
  await corrupt(
    f,
    'UPDATE partner_hub.consulting_flows SET payload=$1 WHERE case_id=$2',
    [saved, flow.caseId],
  );
  assert.ok(await readFlow(flow.caseId));
  await status(
    await getState(f.request('/api/state', undefined, f.adminCookie)),
    200,
  );
});

void test('native inventory keeps owner/payload/child/receipt orphans visible once, colliding IDs quarantined and pagination stable', async (t) => {
  const f = await setup(t);
  const flow = await completeFlow(f);
  const target = flow.files.find((file) => file.purpose === 'transcript')!;
  const head = t.mock.method(f.bucket, 'head', f.bucket.head.bind(f.bucket));
  await corrupt(
    f,
    'DELETE FROM partner_hub.consulting_flow_file_owners WHERE file_id=$1',
    [target.id],
  );
  let page = await f.page('?status=all');
  assert.equal(page.items.filter((item) => item.id === target.id).length, 1);
  assert.equal(
    page.items.find((item) => item.id === target.id)!.status,
    'inconsistent',
  );
  const count = head.mock.callCount();
  await assert.rejects(checkInventoryPresence(target.id), { status: 503 });
  assert.equal(head.mock.callCount(), count);
  await corrupt(
    f,
    'DELETE FROM partner_hub.consulting_flows WHERE case_id=$1',
    [flow.caseId],
  );
  page = await f.page('?status=all');
  assert.equal(
    page.items.filter((item) => item.id === target.id).length,
    1,
    'child-ledger-only orphan is visible',
  );
  for (const table of [
    'consulting_flow_file_metadata',
    'consulting_flow_file_object_integrity',
    'consulting_flow_file_object_checksums',
  ]) {
    await corrupt(f, `DELETE FROM partner_hub.${table} WHERE file_id=$1`, [
      target.id,
    ]);
  }
  page = await f.page('?status=all');
  assert.equal(
    page.items.filter((item) => item.id === target.id).length,
    1,
    'receipt-only orphan is visible',
  );
  await assert.rejects(checkInventoryPresence(target.id), { status: 503 });
  assert.equal(head.mock.callCount(), count);
  // An incomplete company reservation sharing a FLOW ID must never authorize
  // a byte lookup for either source. Both rows remain in the paged inventory.
  await f.db
    .prepare(
      "INSERT INTO company_file_upload_requests VALUES (?1,?2,?3,?4,?5,'pending')",
    )
    .bind(
      `member:${member.id}`,
      'collision-request',
      'collision-fingerprint',
      target.id,
      target.createdAt,
    )
    .run();
  for (let i = 0; i < 29; i++) {
    await f.db
      .prepare(
        "INSERT INTO company_file_upload_requests VALUES (?1,?2,?3,?4,?5,'pending')",
      )
      .bind(
        `member:${member.id}`,
        `page-request-${i}`,
        `page-fingerprint-${i}`,
        `page-${String(i).padStart(2, '0')}`,
        target.createdAt,
      )
      .run();
  }
  const all = [];
  let cursor: string | null = null;
  do {
    const page = await f.page(
      `?status=all${cursor ? `&cursor=${cursor}` : ''}`,
    );
    all.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(
    new Set(all.map((item) => `${item.source}:${item.id}`)).size,
    all.length,
  );
  const collided = all.filter((item) => item.id === target.id);
  assert.equal(collided.length, 2);
  assert.ok(
    collided.every(
      (item) =>
        item.idCollision &&
        item.status === 'inconsistent' &&
        item.integrityProof === null,
    ),
  );
  await assert.rejects(checkInventoryPresence(target.id), { status: 409 });
  assert.equal(head.mock.callCount(), count);
  const filtered = await f.page('?status=unlinked');
  assert.equal(filtered.items.length, 0);
  assert.ok(filtered.integrityCoverage.unavailable >= flow.files.length);
  assert.doesNotMatch(
    JSON.stringify(all),
    /fingerprint|commandReceipts|consulting-flow\/|sourceText/,
  );
});
