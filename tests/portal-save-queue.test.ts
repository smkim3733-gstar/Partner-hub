import assert from 'node:assert/strict';
import test from 'node:test';
import { PortalSaveQueue, putPortalSnapshot } from '../lib/portal-save-queue';
import { ApplicationSubmission } from '../lib/application-submission';
import { GET, PUT } from './state-request';
import { readPortalState, writePortalState } from '../lib/portal-state';

type Snapshot = { value: string; membersRevision?: number };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

void test('an idle flush followed immediately by an edit does not strand the edit', async () => {
  const writes: string[] = [];
  const queue = new PortalSaveQueue<Snapshot>(
    async (state) => {
      writes.push(state.value);
      return {};
    },
    () => {},
    undefined,
    0,
  );
  queue.initialize({ value: 'original' });
  const idle = queue.flush();
  queue.update({ value: 'new' });
  await idle;
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(writes, ['new']);
  assert.equal(queue.hasUnsavedChanges(), false);
  queue.dispose();
});

void test('one in-flight save drains only the newest snapshot and never announces an older response as fully saved', async () => {
  const first = deferred<{ membersRevision: number }>();
  const second = deferred<{ membersRevision: number }>();
  const writes: Snapshot[] = [];
  const statuses: string[] = [];
  const queue = new PortalSaveQueue<Snapshot>(
    (state) => {
      writes.push(state);
      return writes.length === 1 ? first.promise : second.promise;
    },
    (status) => statuses.push(status),
  );
  queue.initialize({ value: 'initial' });
  queue.update({ value: 'one' });
  const saving = queue.flush();
  queue.update({ value: 'intermediate' });
  queue.update({ value: 'latest' });
  assert.equal(queue.flush(), saving);
  assert.equal(writes.length, 1);
  first.resolve({ membersRevision: 4 });
  await Promise.resolve();
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1], { value: 'latest', membersRevision: 4 });
  assert.ok(!statuses.includes('saved'));
  assert.equal(queue.hasUnsavedChanges(), true);
  second.resolve({ membersRevision: 4 });
  await saving;
  assert.equal(statuses.at(-1), 'saved');
  assert.equal(queue.hasUnsavedChanges(), false);
  queue.dispose();
});

void test('returning to an older value while a write is in flight still writes the reversion', async () => {
  const response = deferred<object>();
  const writes: string[] = [];
  const queue = new PortalSaveQueue<Snapshot>(
    async (state) => {
      writes.push(state.value);
      return writes.length === 1 ? response.promise : {};
    },
    () => {},
  );
  queue.initialize({ value: 'original' });
  queue.update({ value: 'changed' });
  const saving = queue.flush();
  queue.update({ value: 'original' });
  assert.equal(queue.hasUnsavedChanges(), true);
  response.resolve({});
  await saving;
  assert.deepEqual(writes, ['changed', 'original']);
  assert.equal(queue.hasUnsavedChanges(), false);
  queue.dispose();
});

void test('failed saves retain latest edits, stop automatic writes, and retry only on request', async () => {
  const writes: string[] = [];
  const statuses: string[] = [];
  const queue = new PortalSaveQueue<Snapshot>(
    async (state) => {
      writes.push(state.value);
      if (writes.length === 1) throw new Error('network unavailable');
      return {};
    },
    (status) => statuses.push(status),
    undefined,
    0,
  );
  queue.initialize({ value: 'original' });
  queue.update({ value: 'attempt' });
  await assert.rejects(queue.flush(), /network unavailable/);
  queue.update({ value: 'newest edit' });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(writes, ['attempt']);
  assert.equal(statuses.at(-1), 'error');
  await queue.flush();
  assert.deepEqual(writes, ['attempt', 'newest edit']);
  assert.equal(queue.hasUnsavedChanges(), false);
  queue.dispose();
});

void test('an uncertain response still requires confirmation after reverting to the original value', async () => {
  const writes: string[] = [];
  const queue = new PortalSaveQueue<Snapshot>(
    async (state) => {
      writes.push(state.value);
      if (writes.length === 1) throw new Error('response lost');
      return {};
    },
    () => {},
  );
  queue.initialize({ value: 'original' });
  queue.update({ value: 'maybe saved' });
  await assert.rejects(queue.flush());
  queue.update({ value: 'original' });
  assert.equal(queue.hasUnsavedChanges(), true);
  await queue.flush();
  assert.deepEqual(writes, ['maybe saved', 'original']);
  queue.dispose();
});

void test('server revision acknowledgements do not cause another save and queued data is immutable', async () => {
  const writes: Snapshot[] = [];
  const queue = new PortalSaveQueue<Snapshot>(
    async (state) => {
      writes.push(state);
      return { membersRevision: 3 };
    },
    () => {},
  );
  queue.initialize({ value: 'original', membersRevision: 2 });
  const state = { value: 'snapshot', membersRevision: 2 };
  queue.update(state);
  state.value = 'mutated outside queue';
  await queue.flush();
  queue.update({ value: 'snapshot', membersRevision: 3 });
  await queue.flush();
  assert.deepEqual(writes, [{ value: 'snapshot', membersRevision: 2 }]);
  queue.dispose();
});

void test('disposal cancels a queued write and suppresses callbacks from an outstanding response', async () => {
  const response = deferred<object>();
  const statuses: string[] = [];
  let writes = 0;
  const queue = new PortalSaveQueue<Snapshot>(
    () => {
      writes++;
      return response.promise;
    },
    (status) => statuses.push(status),
  );
  queue.update({ value: 'one' });
  const saving = queue.flush();
  queue.update({ value: 'two' });
  queue.dispose();
  response.resolve({});
  await saving;
  assert.equal(writes, 1);
  assert.ok(!statuses.includes('saved'));
});

void test('submission waits for persistence, shares a double click, and reuses uploaded IDs after failure', async () => {
  const receipt = deferred<void>();
  const submission = new ApplicationSubmission<{
    caseId: string;
    fileIds: string[];
  }>();
  let preparations = 0;
  const saved: Array<{ caseId: string; fileIds: string[] }> = [];
  const prepare = async () => {
    preparations++;
    return { caseId: 'case-stable', fileIds: ['file-stable'] };
  };
  const persist = async (value: { caseId: string; fileIds: string[] }) => {
    saved.push(value);
    await receipt.promise;
  };
  const first = submission.submit(prepare, persist);
  assert.equal(first, submission.submit(prepare, persist));
  await Promise.resolve();
  assert.equal(submission.hasPrepared(), true);
  receipt.reject(new Error('response lost'));
  await assert.rejects(first, /response lost/);
  assert.equal(submission.hasPrepared(), true);
  const result = await submission.submit(prepare, async (value) => {
    saved.push(value);
  });
  assert.equal(preparations, 1);
  assert.equal(saved[0], saved[1]);
  assert.deepEqual(result, { caseId: 'case-stable', fileIds: ['file-stable'] });
  assert.equal(submission.hasPrepared(), false);
});

void test('a preparation failure can be retried without pretending an application was prepared', async () => {
  const submission = new ApplicationSubmission<string>();
  await assert.rejects(
    submission.submit(
      async () => {
        throw new Error('upload failed');
      },
      async () => {
        assert.fail('must not save');
      },
    ),
  );
  assert.equal(submission.hasPrepared(), false);
  assert.equal(
    await submission.submit(
      async () => 'prepared',
      async () => {},
    ),
    'prepared',
  );
});

void test('HTTP success without an explicit save acknowledgement is not accepted', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({});
    await assert.rejects(
      putPortalSnapshot<Snapshot>({ value: 'example' }, 'bound-user'),
      /저장 완료 응답/,
    );
    globalThis.fetch = async (_url, init) => {
      assert.equal(
        JSON.parse(init!.body as string).expectedUserId,
        'bound-user',
      );
      return Response.json({ ok: true, membersRevision: 7 });
    };
    assert.equal(
      (await putPortalSnapshot<Snapshot>({ value: 'example' }, 'bound-user'))
        .membersRevision,
      7,
    );
  } finally {
    globalThis.fetch = original;
  }
});

void test('lost save response followed by retry retains one case, timeline and document in the database', async () => {
  const empty = {
    version: 1,
    consultationNumber: 0,
    membersRevision: 0,
    cases: [],
    timeline: [],
    companyDocuments: [],
    tasks: [],
    schedule: [],
    members: [],
  };
  const headers = {
    origin: 'http://localhost',
    'content-type': 'application/json',
    'oai-authenticated-user-id': 'synthetic-save-owner',
    'oai-authenticated-user-email': 'smkim3733@gmail.com',
  };
  const request = (body?: unknown) =>
    new Request('http://localhost/api/state', {
      method: body ? 'PUT' : 'GET',
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  await writePortalState(empty);
  const identity = (
    (await (await GET(request())).json()) as { currentUser: { id: string } }
  ).currentUser.id;
  const state = {
    ...empty,
    cases: [
      {
        id: 'stable-case',
        company: '가상기업',
        trainee: '대표',
        partnerMemberId: '',
      },
    ],
    timeline: [{ caseId: 'stable-case', date: 'synthetic', title: '접수' }],
    companyDocuments: [
      {
        id: 'stable-document',
        caseId: 'stable-case',
        storageFileId: 'stable-file',
      },
    ],
  };
  let attempts = 0;
  const queue = new PortalSaveQueue<typeof state>(
    async (snapshot) => {
      const response = await PUT(
        request({ state: snapshot, expectedUserId: identity }),
      );
      assert.equal(response.status, 200, await response.clone().text());
      attempts++;
      if (attempts === 1)
        throw new Error('connection lost after server commit');
      return await response.json();
    },
    () => {},
  );
  queue.update(state);
  await assert.rejects(queue.flush(), /after server commit/);
  await queue.flush();
  const reloaded = (await readPortalState()) as typeof state;
  assert.equal(reloaded.cases.length, 1);
  assert.equal(reloaded.timeline.length, 1);
  assert.equal(reloaded.companyDocuments.length, 1);
  assert.equal(reloaded.companyDocuments[0].storageFileId, 'stable-file');
  assert.equal(
    (
      await PUT(
        request({
          state: { ...state, cases: [] },
          expectedUserId: 'different-user',
        }),
      )
    ).status,
    403,
  );
  assert.equal(((await readPortalState()) as typeof state).cases.length, 1);
  queue.dispose();
});
