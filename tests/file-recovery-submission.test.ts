import test from 'node:test';
import assert from 'node:assert/strict';
import { FileRecoverySubmission } from '../lib/file-recovery-submission';
import type { RecoveryPreview } from '../lib/file-recovery';

function bodyText(options?: RequestInit) {
  assert.equal(typeof options?.body, 'string');
  return options!.body as string;
}

const preview: RecoveryPreview = {
  fileId: 'original',
  fileName: 'synthetic.txt',
  company: '가상기업',
  category: '기타자료',
  title: '가상 원본',
  caseId: 'case-1',
  service: '가상 검토',
  partnerMemberId: 'partner-1',
  partnerName: '가상 파트너',
  partnerEmail: 'partner@example.invalid',
  sizeBytes: 10,
  stateRevision: 'a'.repeat(64),
  fileRevision: 'b'.repeat(64),
};
const input = () => ({
  fileId: 'original',
  preview,
  requestId: 'recovery-client-test-0001',
  reason: '가상 원본 대조 완료',
  confirmed: true,
});
function controls() {
  let locked = false;
  let begins = 0;
  const finished: boolean[] = [];
  return {
    isLocked: () => locked,
    begins: () => begins,
    finished,
    beginRecovery: async () => {
      begins++;
      locked = true;
      return {
        expectedUserId: 'owner-1',
        stateRevision: preview.stateRevision,
      };
    },
    finishRecovery: (reload: boolean) => {
      finished.push(reload);
      locked = false;
    },
  };
}

void test('a lost recovery response retains the editor lock and retries the exact original request without another state flush', async () => {
  const submission = new FileRecoverySubmission(),
    control = controls();
  const bodies: string[] = [];
  const send: typeof fetch = async (_url, options) => {
    bodies.push(bodyText(options));
    if (bodies.length === 1)
      throw new Error('response lost after server commit');
    return Response.json({ ok: true, alreadyLinked: true });
  };
  await assert.rejects(
    submission.submit(input(), control, send),
    /response lost/,
  );
  assert.equal(control.isLocked(), true);
  assert.equal(submission.hasAttempt(), true);
  assert.equal(submission.isSaved(), false);
  await submission.submit(input(), control, send);
  assert.equal(control.begins(), 1);
  assert.equal(bodies[1], bodies[0]);
  assert.deepEqual(control.finished, []);
  assert.equal(control.isLocked(), true);
  assert.equal(submission.isSaved(), true);
  control.finishRecovery(true);
  assert.equal(control.isLocked(), false);
});

void test('preflight validation and stale preview never send a recovery and release only an acquired lock', async () => {
  const control = controls(),
    submission = new FileRecoverySubmission();
  let sends = 0;
  const send: typeof fetch = async () => {
    sends++;
    return Response.json({ ok: true });
  };
  await assert.rejects(
    submission.submit({ ...input(), confirmed: false }, control, send),
  );
  assert.equal(control.begins(), 0);
  assert.deepEqual(control.finished, []);
  await assert.rejects(
    submission.submit(
      { ...input(), preview: { ...preview, stateRevision: 'old' } },
      control,
      send,
    ),
    /버전이 다릅니다/,
  );
  assert.equal(control.isLocked(), false);
  assert.equal(submission.hasAttempt(), false);
  assert.deepEqual(control.finished, [false]);
  assert.equal(sends, 0);
  await submission.submit(input(), control, send);
  assert.equal(control.isLocked(), true);
  assert.equal(sends, 1);
});

void test('double confirmation sends one immutable request and a completed confirmation cannot send again', async () => {
  let resolve!: (value: Response) => void;
  const waiting = new Promise<Response>((yes) => {
    resolve = yes;
  });
  const control = controls(),
    submission = new FileRecoverySubmission();
  const bodies: string[] = [];
  const send: typeof fetch = async (_url, options) => {
    bodies.push(bodyText(options));
    return waiting;
  };
  const value = input();
  const first = submission.submit(value, control, send);
  value.reason = 'changed after first click';
  const second = submission.submit(value, control, send);
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(control.isLocked(), true);
  assert.equal(bodies.length, 1);
  assert.match(bodies[0], /가상 원본 대조 완료/);
  assert.doesNotMatch(bodies[0], /changed after/);
  resolve(Response.json({ ok: true }));
  await first;
  await submission.submit(input(), control, send);
  assert.equal(bodies.length, 1);
  assert.equal(control.isLocked(), true);
});

void test('server denial and unreadable responses stay locked until same-request confirmation or explicit reload', async () => {
  for (const response of [
    Response.json({ error: 'changed' }, { status: 409 }),
    Response.json({ error: 'denied' }, { status: 403 }),
    Response.json({ error: 'uncertain' }, { status: 503 }),
    new Response('truncated'),
    Response.json({ ok: false }),
    Response.json(null),
  ]) {
    const control = controls(),
      submission = new FileRecoverySubmission();
    await assert.rejects(
      submission.submit(input(), control, async () => response),
    );
    assert.equal(control.isLocked(), true);
    assert.equal(submission.isSaved(), false);
    assert.equal(submission.hasAttempt(), true);
    assert.deepEqual(control.finished, []);
    control.finishRecovery(true);
    assert.deepEqual(control.finished, [true]);
  }
});

void test('recovery response preserves safe server errors and replaces unreadable payload details with retry guidance', async () => {
  const denied = new FileRecoverySubmission();
  await assert.rejects(
    denied.submit(input(), controls(), async () =>
      Response.json({ error: '최신 원본 상태를 다시 확인해 주세요.' }, { status: 409 }),
    ),
    /최신 원본 상태를 다시 확인해 주세요/,
  );

  const unreadable = new FileRecoverySubmission();
  await assert.rejects(
    unreadable.submit(
      input(),
      controls(),
      async () => new Response('<html>gateway detail</html>'),
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /회수 저장 응답을 읽지 못했습니다/);
      assert.doesNotMatch(error.message, /gateway detail|SyntaxError/);
      return true;
    },
  );
});

void test('retry cannot adopt a changed login identity or another original and never flushes pending edits again', async () => {
  const control = controls(),
    submission = new FileRecoverySubmission();
  const bodies: string[] = [];
  const fail: typeof fetch = async (_url, options) => {
    bodies.push(bodyText(options));
    throw new Error('offline');
  };
  await assert.rejects(submission.submit(input(), control, fail));
  let beginAgain = 0;
  const changed = {
    ...control,
    beginRecovery: async () => {
      beginAgain++;
      throw new Error('must not flush stale edits or adopt new user');
    },
  };
  await assert.rejects(
    submission.submit({ ...input(), fileId: 'different' }, changed, fail),
    /원본의 결과/,
  );
  await submission.submit(
    { ...input(), reason: 'replacement reason' },
    changed,
    async (_url, options) => {
      bodies.push(bodyText(options));
      return Response.json({ ok: true });
    },
  );
  assert.equal(beginAgain, 0);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1], bodies[0]);
  assert.match(bodies[1], /owner-1/);
  assert.equal(control.isLocked(), true);
});
