import assert from 'node:assert/strict';
import test from 'node:test';
import { PortalFlowProjectionRefresh } from '../lib/portal-flow-projection-refresh';

type State = { version: number };
const isState = (value: unknown): value is State =>
  value !== null &&
  typeof value === 'object' &&
  typeof (value as { version?: unknown }).version === 'number';

void test('validated current FLOW projection response becomes applicable', async () => {
  const refresh = new PortalFlowProjectionRefresh(isState);
  const result = await refresh.refresh(() =>
    Promise.resolve(Response.json({ state: { version: 2 } })),
  );

  assert.deepEqual(result, { current: true, state: { version: 2 } });
});

void test('FLOW projection refresh exposes server failure and rejects malformed success', async () => {
  const refresh = new PortalFlowProjectionRefresh(isState);

  await assert.rejects(
    refresh.refresh(() =>
      Promise.resolve(Response.json({ error: '로그인이 만료되었습니다.' }, { status: 401 })),
    ),
    /로그인이 만료되었습니다/,
  );
  await assert.rejects(
    refresh.refresh(() => Promise.resolve(Response.json({ state: null }))),
    /응답 형식이 올바르지 않습니다/,
  );
});

void test('newer FLOW projection response makes an older success stale', async () => {
  const refresh = new PortalFlowProjectionRefresh(isState);
  let finishFirst!: (response: Response) => void;
  const firstResponse = new Promise<Response>((resolve) => {
    finishFirst = resolve;
  });
  const first = refresh.refresh(() => firstResponse);
  const second = await refresh.refresh(() =>
    Promise.resolve(Response.json({ state: { version: 2 } })),
  );
  finishFirst(Response.json({ state: { version: 1 } }));

  assert.deepEqual(second, { current: true, state: { version: 2 } });
  assert.deepEqual(await first, { current: false });
});

void test('obsolete FLOW projection failure cannot replace a newer result with an error', async () => {
  const refresh = new PortalFlowProjectionRefresh(isState);
  let failFirst!: (error: Error) => void;
  const firstResponse = new Promise<Response>((_resolve, reject) => {
    failFirst = reject;
  });
  const first = refresh.refresh(() => firstResponse);
  const second = await refresh.refresh(() =>
    Promise.resolve(Response.json({ state: { version: 3 } })),
  );
  failFirst(new Error('stale network failure'));

  assert.equal(second.current, true);
  assert.deepEqual(await first, { current: false });
});
