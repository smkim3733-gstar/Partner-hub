import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PortalInitializationGate } from '../components/portal-initialization-gate';
import {
  PORTAL_STATE_LIMIT_BYTES,
  countPilotSeedRecords,
  emptyPortalStateBaseline,
  isPilotSeedId,
  isPilotSeedRecord,
  operationalPilotRecords,
  portalStorageTelemetry,
} from '../lib/pilot-readiness';

void test('pilot seed classification uses reserved IDs instead of client-writable labels', () => {
  const deceptivelyNamedOperationalRecord = {
    id: 'operational-case',
    company: '테스트(가상)',
  };
  assert.equal(isPilotSeedId('case', 'case-1'), true);
  assert.equal(isPilotSeedId('case', 'case-10'), true);
  assert.equal(isPilotSeedId('case', 'case-11'), false);
  assert.equal(
    isPilotSeedRecord('case', deceptivelyNamedOperationalRecord),
    false,
  );
  assert.equal(
    countPilotSeedRecords('task', [
      { id: 'task-1' },
      { id: 'task-real' },
      { id: 'task-7' },
    ]),
    2,
  );
  const original = [{ id: 'case-1' }, { id: 'operational-case' }];
  assert.deepEqual(operationalPilotRecords('case', original), [
    { id: 'operational-case' },
  ]);
  assert.equal(original.length, 2, 'derived filtering must not mutate saved arrays');
});

void test('empty pilot baseline contains no virtual or operational records', () => {
  const state = emptyPortalStateBaseline();
  assert.equal(state.version, 1);
  assert.equal(state.consultationNumber, 0);
  for (const records of [
    state.timeline,
    state.schedule,
    state.tasks,
    state.companyDocuments,
    state.cases,
    state.members,
    state.diagnosisAssessments,
  ]) {
    assert.deepEqual(records, []);
  }
});

void test('storage telemetry distinguishes exact stored bytes from next request wrapper', () => {
  const state = { version: 1, cases: [] };
  const payload = JSON.stringify(state);
  const telemetry = portalStorageTelemetry({
    payload,
    state,
    expectedUserId: 'owner',
  });
  assert.equal(telemetry.storedBytes, new TextEncoder().encode(payload).byteLength);
  assert.ok(telemetry.nextRequestBytes > telemetry.storedBytes);
  assert.equal(telemetry.effectiveBytes, telemetry.nextRequestBytes);
  assert.equal(telemetry.limitBytes, PORTAL_STATE_LIMIT_BYTES);
  assert.equal(telemetry.thresholdProvisional, true);
});

void test('storage telemetry reports exact limit boundaries and provisional warnings', () => {
  const atLimit = portalStorageTelemetry({
    payload: 'x'.repeat(PORTAL_STATE_LIMIT_BYTES),
    state: null,
    expectedUserId: 'owner',
  });
  assert.equal(atLimit.storedBytes, PORTAL_STATE_LIMIT_BYTES);
  assert.equal(atLimit.remainingBytes, 0);
  assert.equal(atLimit.usagePercent, 100);
  assert.equal(atLimit.warning, true);

  const overLimit = portalStorageTelemetry({
    payload: 'x'.repeat(PORTAL_STATE_LIMIT_BYTES + 1_000),
    state: null,
    expectedUserId: 'owner',
  });
  assert.equal(overLimit.remainingBytes, 0);
  assert.ok(overLimit.usagePercent > 100);
});

void test('first-run gate requires an explicit owner baseline choice', () => {
  const html = renderToStaticMarkup(
    createElement(PortalInitializationGate, {
      busy: false,
      onChoose: () => {},
    }),
  );
  assert.match(html, /운영 데이터 기준선 선택/);
  assert.match(html, /빈 운영 데이터 선택/);
  assert.match(html, /가상 예시 데이터 선택/);
  assert.match(html, /자동 저장하지 않습니다/);
});
