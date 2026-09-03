import assert from 'node:assert/strict';
import test from 'node:test';
import { newConsultingFlow } from '../lib/consulting-flow';
import {
  ConsultingFlowResponseError,
  ConsultingFlowStateRefresh,
  readConsultingFlowMutationResponse,
  readConsultingFlowStateResponse,
} from '../lib/consulting-flow-response';

const flow = newConsultingFlow(
  'case-response',
  '가상 응답기업',
  'partner-response',
  '가상 파트너',
);

void test('FLOW state response requires flow, role, upload permission and readiness', async () => {
  const payload = await readConsultingFlowStateResponse(
    Response.json({
      flow,
      role: 'partner',
      canUpload: true,
      readiness: { aiConnected: false, model: '' },
    }),
  );

  assert.equal(payload.flow.caseId, flow.caseId);
  assert.equal(payload.role, 'partner');
});

void test('FLOW mutation response accepts the narrower saved-flow contract', async () => {
  const payload = await readConsultingFlowMutationResponse(
    Response.json({ flow, duplicate: true }),
  );

  assert.deepEqual(payload.flow, flow);
  assert.equal(payload.duplicate, true);
});

void test('FLOW response keeps HTTP status and safe server error', async () => {
  await assert.rejects(
    readConsultingFlowMutationResponse(
      Response.json({ error: '다른 변경이 있습니다.' }, { status: 409 }),
    ),
    (error: unknown) =>
      error instanceof ConsultingFlowResponseError &&
      error.status === 409 &&
      error.message === '다른 변경이 있습니다.',
  );
});

void test('unreadable and malformed successful FLOW responses never become UI state', async () => {
  await assert.rejects(
    readConsultingFlowMutationResponse(
      new Response('<html>failure</html>', {
        headers: { 'content-type': 'text/html' },
      }),
    ),
    /진행 정보를 불러오지 못했습니다/,
  );
  await assert.rejects(
    readConsultingFlowMutationResponse(Response.json({ flow: {} })),
    /응답 형식이 올바르지 않습니다/,
  );
  await assert.rejects(
    readConsultingFlowStateResponse(Response.json({ flow })),
    /응답 형식이 올바르지 않습니다/,
  );
});

void test('latest FLOW state refresh wins when successful responses arrive out of order', async () => {
  const refresh = new ConsultingFlowStateRefresh();
  let finishFirst!: (response: Response) => void;
  const firstResponse = new Promise<Response>((resolve) => {
    finishFirst = resolve;
  });
  const first = refresh.refresh(() => firstResponse);
  const secondFlow = { ...flow, revision: 2 };
  const second = await refresh.refresh(() =>
    Promise.resolve(Response.json({
      flow: secondFlow,
      role: 'admin',
      canUpload: true,
      readiness: { aiConnected: false, model: '' },
    })),
  );
  finishFirst(Response.json({
    flow: { ...flow, revision: 1 },
    role: 'admin',
    canUpload: true,
    readiness: { aiConnected: false, model: '' },
  }));

  assert.equal(second.current && second.payload.flow.revision, 2);
  assert.deepEqual(await first, { current: false });
});

void test('obsolete FLOW state refresh failure cannot replace a newer success', async () => {
  const refresh = new ConsultingFlowStateRefresh();
  let failFirst!: (error: Error) => void;
  const firstResponse = new Promise<Response>((_resolve, reject) => {
    failFirst = reject;
  });
  const first = refresh.refresh(() => firstResponse);
  const second = await refresh.refresh(() =>
    Promise.resolve(Response.json({
      flow,
      role: 'partner',
      canUpload: false,
      readiness: { aiConnected: false, model: '' },
    })),
  );
  failFirst(new Error('obsolete network failure'));

  assert.equal(second.current, true);
  assert.deepEqual(await first, { current: false });
});
