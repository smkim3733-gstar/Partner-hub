import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GET as preview,
  POST as recover,
} from '../app/api/admin/file-inventory/[id]/recovery/route';
import { GET as getState, PUT as saveState } from '../app/api/state/route';
import {
  companyFileDatabase,
  companyFileBucket,
  ensureCompanyFileTables,
  findCompanyFile,
} from '../lib/company-files';
import { readPortalState, writePortalState } from '../lib/portal-state';
import { flowDatabase } from '../lib/consulting-flow-store';
import { listIntakeSources } from '../lib/consulting-intake-sources';
import { newConsultingFlow } from '../lib/consulting-flow';
import { readFileRecoveryPreviewResponse } from '../lib/file-recovery-preview-response';
import { portalStateId } from '../db/schema';
import { portalRevision } from '../lib/portal-revision';
import { FileRecoverySubmission } from '../lib/file-recovery-submission';
import { PortalSaveQueue } from '../lib/portal-save-queue';

const email = 'seedy@sites.test';
const member = {
  id: 'recovery-partner',
  name: '가상 담당자',
  email: 'recovery@example.invalid',
  status: '활성',
  permissions: { ownCases: true, fileUpload: true, collaborationApply: true },
};
const peer = {
  ...member,
  id: 'recovery-peer',
  email: 'recovery-peer@example.invalid',
};
const id = 'recovery-original';
const caseId = 'case-draft-recovery-original';
const context = { params: Promise.resolve({ id }) };
function request(body?: unknown, user: string | null = email) {
  return new Request(
    'http://localhost/api/admin/file-inventory/recovery-original/recovery',
    {
      method: body ? 'POST' : 'GET',
      headers: {
        origin: 'http://localhost',
        'content-type': 'application/json',
        ...(user
          ? {
              'oai-authenticated-user-email': user,
              'oai-authenticated-user-id': user,
            }
          : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
}
async function state() {
  return (await readPortalState()) as {
    companyDocuments: Array<Record<string, unknown>>;
    timeline: Array<Record<string, unknown>>;
    cases: Array<Record<string, unknown>>;
    members: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
}
async function seed() {
  const db = companyFileDatabase();
  await ensureCompanyFileTables(db);
  await flowDatabase();
  await db.batch(
    [
      'company_file_case_links',
      'company_file_assignments',
      'company_file_objects',
      'company_file_upload_requests',
      'consulting_flows',
    ].map((table) => db.prepare(`DELETE FROM ${table}`)),
  );
  await writePortalState({
    version: 1,
    consultationNumber: 0,
    members: [member, peer],
    cases: [
      {
        id: caseId,
        company: '가상기업',
        partnerMemberId: member.id,
        trainee: member.name,
        service: '정책자금',
      },
    ],
    companyDocuments: [],
    timeline: [],
    tasks: [],
    schedule: [],
  });
  await db
    .prepare(`INSERT INTO company_file_objects (id, storage_key, original_name, company, category, title,
    assigned_trainee, uploaded_by_user_id, uploaded_by_email, content_type, size_bytes, created_at)
    VALUES (?1, ?2, 'original.txt', '가상기업', '기타자료', '원본 검토자료', ?3, ?4, ?4, 'text/plain', 24, '2026-08-31T00:00:00Z')`)
    .bind(id, `company-source/${id}`, member.name, member.email)
    .run();
  await db
    .prepare(
      'INSERT INTO company_file_assignments (file_id, partner_member_id) VALUES (?1, ?2)',
    )
    .bind(id, member.id)
    .run();
  await db
    .prepare(
      'INSERT INTO company_file_case_links (file_id, case_id) VALUES (?1, ?2)',
    )
    .bind(id, caseId)
    .run();
  await db
    .prepare(
      "INSERT INTO company_file_upload_requests (owner_key, request_key, fingerprint, file_id, created_at, status) VALUES (?1, 'private-upload-request', 'private-hash', ?2, '2026-08-31T00:00:00Z', 'ready')",
    )
    .bind(`member:${member.id}`, id)
    .run();
  await companyFileBucket().put(
    `company-source/${id}`,
    'SYNTHETIC_ORIGINAL_BYTES',
  );
}

async function ordinarySave(next: unknown, user: string = email) {
  const write = request({ state: next }, user);
  write.headers.set(
    'if-match',
    `"${await portalRevision(await readPortalState())}"`,
  );
  return saveState(write);
}

void test('ordinary state saves cannot rewrite administrator recovery proof or its timeline', async () => {
  await seed();
  assert.equal((await recover(request(await body()), context)).status, 200);
  const original = await state();
  for (const user of [email, member.email]) {
    const attack = structuredClone(original);
    attack.companyDocuments[0].recovery = {
      ...(attack.companyDocuments[0].recovery as Record<string, unknown>),
      reason: 'forged reason',
      by: 'forged administrator',
    };
    attack.timeline[0].detail = 'forged timeline';
    const response = await ordinarySave(attack, user);
    assert.equal(response.status, 409, await response.clone().text());
    assert.deepEqual(await state(), original);
  }
});

void test('ordinary saves reject removing, replacing or duplicating recovered identities and audit records', async () => {
  await seed();
  await recover(request(await body()), context);
  const original = await state();
  const mutations: Array<(next: Awaited<ReturnType<typeof state>>) => void> = [
    (next) => {
      delete next.companyDocuments[0].recovery;
    },
    (next) => {
      next.companyDocuments = [];
    },
    (next) => {
      next.timeline = [];
    },
    (next) => {
      next.companyDocuments[0].storageFileId = 'replacement-file';
    },
    (next) => {
      next.companyDocuments[0].caseId = 'different-case';
    },
    (next) => {
      next.companyDocuments[0].partnerMemberId = peer.id;
    },
    (next) => {
      next.companyDocuments.push({
        ...next.companyDocuments[0],
        id: 'duplicate',
      });
    },
    (next) => {
      next.companyDocuments.push({
        ...next.companyDocuments[0],
        id: 'shadow-without-proof',
        recovery: undefined,
      });
    },
    (next) => {
      next.timeline.push({ ...next.timeline[0], id: 'duplicate-event' });
    },
    (next) => {
      delete next.timeline[0].recoveryFileId;
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const next = structuredClone(original);
    mutate(next);
    // Structural case/member-link corruption is rejected before the narrower
    // immutable-recovery comparison; both paths must remain atomic.
    const expectedStatus = index === 4 || index === 5 ? 403 : 409;
    assert.equal((await ordinarySave(next)).status, expectedStatus);
    assert.deepEqual(await state(), original);
  }
});

void test('generic state saves cannot create fake recovery facts for either role', async () => {
  await seed();
  const original = await state();
  const fakeDocument = {
    id: 'fake-recovery',
    storageFileId: id,
    caseId,
    company: '가상기업',
    partnerMemberId: member.id,
    assignedTrainee: member.name,
    title: '가상 회수자료',
    category: '기타자료',
    status: '제출완료',
    submittedBy: member.name,
    updatedAt: '방금 전',
    version: 'V1',
    sensitive: true,
    recovery: {
      by: email,
      reason: '위조한 대표 확인',
      requestId: 'fake-recovery-request',
      at: '2026-08-31T00:00:00Z',
    },
  };
  const fakeEvent = {
    id: 'fake-event',
    caseId,
    date: '2026-08-31T00:00:00Z',
    title: '보관 원본 연결 회수',
    detail: '가상 회수 기록',
    type: '서류',
    tone: 'blue',
    recoveryFileId: id,
  };
  for (const user of [email, member.email]) {
    for (const values of [
      { companyDocuments: [fakeDocument] },
      {
        companyDocuments: [
          { ...fakeDocument, id: `file-recovery-${id}`, recovery: undefined },
        ],
      },
      { timeline: [fakeEvent] },
      {
        timeline: [
          {
            ...fakeEvent,
            id: `timeline-recovery-${id}`,
            recoveryFileId: undefined,
          },
        ],
      },
    ]) {
      assert.equal(
        (await ordinarySave({ ...original, ...values }, user)).status,
        409,
      );
      assert.deepEqual(await state(), original);
    }
  }
});

void test('review status changes, unrelated work and reordered JSON preserve recovery proof and retries', async () => {
  await seed();
  const recoveryBody = await body();
  await recover(request(recoveryBody), context);
  const recovered = await state();
  for (const user of [member.email, email]) {
    const next = await state();
    next.companyDocuments[0].status = user === email ? '검토완료' : '보완필요';
    next.companyDocuments[0].updatedAt = '방금 전';
    next.companyDocuments[0].recovery = Object.fromEntries(
      Object.entries(
        next.companyDocuments[0].recovery as Record<string, unknown>,
      ).reverse(),
    );
    next.timeline.push({
      id: `note-${user}`,
      caseId,
      date: '2026-08-31T01:00:00Z',
      title: `검토 메모 ${user}`,
      detail: '정상 업무 메모',
      type: '서류',
      tone: 'blue',
    });
    const response = await ordinarySave(next, user);
    assert.equal(response.status, 200, await response.clone().text());
    const after = await state();
    assert.deepEqual(
      after.companyDocuments[0].recovery,
      recovered.companyDocuments[0].recovery,
    );
    assert.deepEqual(
      after.timeline.find((item) => item.recoveryFileId === id),
      recovered.timeline[0],
    );
  }
  assert.equal((await recover(request(recoveryBody), context)).status, 200);
});
async function body() {
  const response = await preview(request(), context);
  assert.equal(response.status, 200, await response.clone().text());
  const review = await readFileRecoveryPreviewResponse(response, id);
  assert.doesNotMatch(
    JSON.stringify(review),
    /storage_key|company-source|private-upload|private-hash/,
  );
  const { currentUser: user } = (await (await getState(request())).json()) as {
    currentUser: { id: string };
  };
  return {
    ...review,
    requestId: 'recovery-request-unique-0001',
    confirmed: true,
    reason: '기업과 담당 계정 및 원본 대조 완료',
    expectedUserId: user.id,
  };
}

void test('client retry after a committed but lost response retains the lock, sends no stale snapshot and creates one server record', async () => {
  await seed();
  const value = await body(),
    original = await state();
  const submission = new FileRecoverySubmission();
  let locked = false,
    begins = 0,
    stateWrites = 0,
    requests = 0;
  const queue = new PortalSaveQueue<
    Awaited<ReturnType<typeof state>> & { membersRevision?: number }
  >(
    async () => {
      stateWrites++;
      throw new Error('Stale state must not be sent after recovery');
    },
    () => {},
  );
  queue.initialize(original);
  const control = {
    beginRecovery: async () => {
      begins++;
      locked = true;
      queue.update(original);
      await queue.flush();
      return {
        expectedUserId: value.expectedUserId,
        stateRevision: value.stateRevision,
      };
    },
    finishRecovery: () => {
      locked = false;
    },
  };
  const send: typeof fetch = async (_url, options) => {
    requests++;
    assert.equal(typeof options?.body, 'string');
    const result = await recover(
      request(JSON.parse(options!.body as string)),
      context,
    );
    assert.equal(result.status, 200, await result.clone().text());
    if (requests === 1) throw new Error('Committed response lost');
    return result;
  };
  try {
    const input = {
      fileId: id,
      preview: value,
      requestId: value.requestId,
      reason: value.reason,
      confirmed: true,
    };
    await assert.rejects(
      submission.submit(input, control, send),
      /response lost/,
    );
    assert.equal(locked, true);
    assert.equal((await state()).companyDocuments.length, 1);
    await submission.submit(input, control, send);
    assert.equal(begins, 1);
    assert.equal(stateWrites, 0);
    assert.equal(locked, true);
    assert.equal((await state()).timeline.length, 1);
    assert.equal((await state()).companyDocuments.length, 1);
    assert.equal(submission.isSaved(), true);
  } finally {
    queue.dispose();
  }
});

void test('only administrator can preview/recover, with explicit confirmation, reason, origin and stable identity', async () => {
  await seed();
  for (const user of [null, member.email]) {
    assert.equal(
      (await preview(request(undefined, user), context)).status,
      user ? 403 : 401,
    );
    assert.equal(
      (await recover(request({}, user), context)).status,
      user ? 403 : 401,
    );
  }
  const value = await body();
  const lookalike = request(value);
  lookalike.headers.set('content-type', 'application/jsonx');
  assert.equal((await recover(lookalike, context)).status, 415);
  const invalidLength = request(value);
  invalidLength.headers.set('content-length', 'invalid');
  assert.equal((await recover(invalidLength, context)).status, 400);
  assert.equal(
    (await recover(request({ ...value, confirmed: false }), context)).status,
    400,
  );
  assert.equal(
    (await recover(request({ ...value, reason: '짧음' }), context)).status,
    400,
  );
  assert.equal(
    (
      await recover(
        request({ ...value, expectedUserId: 'changed-account' }),
        context,
      )
    ).status,
    403,
  );
  const cross = request(value);
  cross.headers.set('origin', 'https://invalid.example');
  assert.equal((await recover(cross, context)).status, 403);
  assert.equal((await state()).companyDocuments.length, 0);
});

void test('confirmed recovery atomically links a document and audit event while preserving original bytes, ACL and case link', async () => {
  await seed();
  const value = await body();
  const original = await findCompanyFile(id);
  const before = await state();
  const bucket = companyFileBucket();
  const get = bucket.get.bind(bucket),
    put = bucket.put.bind(bucket),
    del = bucket.delete.bind(bucket);
  const noOriginalMutation = async (): Promise<never> => {
    throw new Error('Recovery must not read or mutate original bytes');
  };
  bucket.get = noOriginalMutation;
  bucket.put = noOriginalMutation;
  bucket.delete = noOriginalMutation;
  try {
    const response = await recover(request(value), context);
    assert.equal(response.status, 200, await response.clone().text());
  } finally {
    bucket.get = get;
    bucket.put = put;
    bucket.delete = del;
  }
  const after = await state();
  assert.equal(after.companyDocuments.length, 1);
  assert.equal(after.timeline.length, 1);
  assert.equal(after.companyDocuments[0].storageFileId, id);
  assert.equal(after.companyDocuments[0].partnerMemberId, member.id);
  assert.equal(
    (after.companyDocuments[0].recovery as Record<string, unknown>).reason,
    value.reason,
  );
  assert.deepEqual(after.cases, before.cases);
  assert.deepEqual(await findCompanyFile(id), original);
  assert.equal(
    await (await bucket.get(`company-source/${id}`))!.text(),
    'SYNTHETIC_ORIGINAL_BYTES',
  );
  const flow = newConsultingFlow(caseId, '가상기업', member.id, member.name);
  assert.ok(
    (await listIntakeSources(flow)).files.some((file) => file.id === id),
  );
  const oldWrite = request({ state: before });
  oldWrite.headers.set('if-match', `"${value.stateRevision}"`);
  assert.equal((await saveState(oldWrite)).status, 409);
  assert.deepEqual(await state(), after);
});

void test('lost database acknowledgement can be retried without duplicate documents or audit entries', async () => {
  await seed();
  const value = await body();
  const db = companyFileDatabase();
  const prepare = db.prepare.bind(db);
  let once = true;
  db.prepare = (sql) => {
    const statement = prepare(sql);
    if (
      sql.includes(
        'AND COALESCE((SELECT status FROM company_file_upload_requests',
      )
    ) {
      const bind = statement.bind.bind(statement);
      statement.bind = (...values) => {
        const bound = bind(...values),
          run = bound.run.bind(bound);
        bound.run = async <T = Record<string, unknown>>() => {
          const result = await run<T>();
          if (once) {
            once = false;
            throw new Error('Synthetic lost acknowledgement after commit');
          }
          return result;
        };
        return bound;
      };
    }
    return statement;
  };
  try {
    assert.equal((await recover(request(value), context)).status, 503);
  } finally {
    db.prepare = prepare;
  }
  const retry = await recover(request(value), context);
  assert.equal(retry.status, 200);
  assert.equal(
    ((await retry.json()) as { alreadyLinked: boolean }).alreadyLinked,
    true,
  );
  assert.equal((await state()).companyDocuments.length, 1);
  assert.equal((await state()).timeline.length, 1);
  assert.equal(
    (
      await recover(
        request({ ...value, requestId: 'different-recovery-request' }),
        context,
      )
    ).status,
    409,
  );
});

void test('stale state, wrong target case and changed file metadata are rejected without writes', async () => {
  await seed();
  let value = await body();
  assert.equal(
    (await recover(request({ ...value, caseId: 'case-other' }), context))
      .status,
    409,
  );
  const changed = await state();
  changed.tasks = [{
    id: 'new-other-task',
    company: '가상기업',
    title: '다른 업무',
    kind: '내부업무',
    assignee: '김성민 대표',
    due: '기한 확인',
    dueState: 'upcoming',
    status: '대기',
    priority: '보통',
    related: '복구 경합 검사',
  }];
  await writePortalState(changed);
  assert.equal((await recover(request(value), context)).status, 409);
  assert.deepEqual(await state(), changed);
  value = await body();
  await companyFileDatabase()
    .prepare(
      "UPDATE company_file_objects SET title = '변경된 제목' WHERE id = ?1",
    )
    .bind(id)
    .run();
  assert.equal((await recover(request(value), context)).status, 409);
  assert.equal((await state()).companyDocuments.length, 0);
});

void test('pending, deleted, missing originals and ambiguous or mismatched assignments cannot be recovered', async () => {
  for (const kind of [
    'pending',
    'deleted',
    'missing',
    'size',
    'no-case',
    'no-account',
    'wrong-account',
    'inactive',
  ] as const) {
    await seed();
    const db = companyFileDatabase();
    if (kind === 'pending' || kind === 'deleted')
      await db
        .prepare('UPDATE company_file_upload_requests SET status = ?1')
        .bind(kind)
        .run();
    if (kind === 'missing')
      await companyFileBucket().delete(`company-source/${id}`);
    if (kind === 'size')
      await companyFileBucket().put(`company-source/${id}`, 'SHORT');
    if (kind === 'no-case')
      await db.prepare('DELETE FROM company_file_case_links').run();
    if (kind === 'no-account')
      await db.prepare('DELETE FROM company_file_assignments').run();
    if (kind === 'wrong-account' || kind === 'inactive') {
      const changed = await state();
      if (kind === 'wrong-account') changed.cases[0].partnerMemberId = peer.id;
      else changed.members[0].status = '정지';
      await writePortalState(changed);
    }
    assert.equal((await preview(request(), context)).status, 409, kind);
    assert.equal((await state()).companyDocuments.length, 0);
  }
});

void test('deletion or reassignment immediately after the object check fails the atomic write guard', async () => {
  for (const change of ['delete', 'assignment', 'flow'] as const) {
    await seed();
    const value = await body();
    const db = companyFileDatabase();
    const bucket = companyFileBucket();
    const head = bucket.head.bind(bucket);
    bucket.head = async (key) => {
      const object = await head(key);
      if (change === 'delete')
        await db
          .prepare(
            "UPDATE company_file_upload_requests SET status = 'deleted' WHERE file_id = ?1",
          )
          .bind(id)
          .run();
      if (change === 'assignment')
        await db
          .prepare(
            'UPDATE company_file_assignments SET partner_member_id = ?1 WHERE file_id = ?2',
          )
          .bind(peer.id, id)
          .run();
      if (change === 'flow')
        await db
          .prepare(
            'INSERT INTO consulting_flows (case_id, partner_id, revision, payload, updated_at) VALUES (?1, ?2, 1, ?3, ?4)',
          )
          .bind(
            caseId,
            member.id,
            JSON.stringify(
              newConsultingFlow(caseId, '가상기업', member.id, member.name),
            ),
            'now',
          )
          .run();
      return object;
    };
    try {
      assert.equal(
        (await recover(request(value), context)).status,
        409,
        change,
      );
    } finally {
      bucket.head = head;
    }
    assert.equal((await state()).companyDocuments.length, 0);
    assert.equal((await state()).timeline.length, 0);
  }
});

void test('simultaneous confirmations cannot duplicate recovery and formatted historical payload remains writable', async () => {
  await seed();
  const db = companyFileDatabase();
  await db
    .prepare('UPDATE portal_state SET payload = ?1 WHERE id = ?2')
    .bind(JSON.stringify(await state(), null, 2), portalStateId)
    .run();
  const value = await body();
  const results = await Promise.all([
    recover(request(value), context),
    recover(request(value), context),
  ]);
  assert.ok(results.every((response) => [200, 409].includes(response.status)));
  assert.ok(results.some((response) => response.status === 200));
  assert.equal((await state()).companyDocuments.length, 1);
  assert.equal((await state()).timeline.length, 1);
  assert.equal((await recover(request(value), context)).status, 200);
});
