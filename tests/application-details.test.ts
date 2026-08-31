import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ApplicationDetailFields,
  ApplicationDetailsSummary,
} from '../components/application-details';
import {
  applicationFieldKeys,
  applicationFields,
  emptyApplicationDetails,
  parseApplicationDetails,
  ApplicationDetailsError,
} from '../lib/application-details';
import { GET, PUT } from './state-request';
import { readPortalState, writePortalState } from '../lib/portal-state';
import { newConsultingFlow } from '../lib/consulting-flow';
import { projectFlowState } from '../lib/consulting-flow-projection';

const details = () => ({
  ...emptyApplicationDetails(),
  relationship: '기존 고객',
  collaborator: '가상 협업자',
  message: '첫째 줄\n둘째 줄',
  registrationNumber: '000-00-00000',
  representative: '가상 대표',
  business: '가상 부품 제조',
  location: '가상시',
  contactName: '가상 담당',
  contactPhone: '010-0000-0000',
  requestedStart: '2026-09-01',
  urgency: '긴급',
  requestBackground: '가상 검증용 요청 배경',
});
const permissions = {
  ownCases: true,
  fileUpload: true,
  collaborationApply: true,
  sharedSchedule: true,
  quoteContract: false,
};
const member = {
  id: 'detail-member',
  name: '가상파트너',
  email: 'detail@example.invalid',
  status: '활성',
  permissions,
};
const peer = {
  ...member,
  id: 'detail-peer',
  email: 'detail-peer@example.invalid',
};
type FixtureCase = {
  id: string;
  company: string;
  trainee: string;
  partnerMemberId: string;
  service: string;
  applicationDetails?: ReturnType<typeof details>;
};
const seed = () => ({
  version: 1,
  consultationNumber: 0,
  membersRevision: 0,
  members: [member, peer],
  cases: [
    {
      id: 'legacy-case',
      company: '이전 기업',
      trainee: member.name,
      partnerMemberId: member.id,
      service: '이전 서비스',
    },
  ] as FixtureCase[],
  timeline: [],
  companyDocuments: [],
  tasks: [],
  schedule: [],
});
const incoming = () => ({
  ...seed(),
  cases: [
    ...seed().cases,
    {
      id: 'detail-case',
      company: '가상 입력기업',
      service: '정책자금 · 기업인증',
      trainee: member.name,
      partnerMemberId: member.id,
      applicationDetails: details(),
    },
  ],
});
function request(body?: unknown, email = member.email) {
  return new Request('http://localhost/api/state', {
    method: body ? 'PUT' : 'GET',
    headers: {
      origin: 'http://localhost',
      'content-type': 'application/json',
      'oai-authenticated-user-id': email,
      'oai-authenticated-user-email': email,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

void test('all declared application fields normalize without dropping optional text, dates or line breaks', () => {
  const input = details();
  const parsed = parseApplicationDetails(input);
  assert.deepEqual(
    Object.keys(parsed).sort(),
    ['version', ...applicationFieldKeys].sort(),
  );
  assert.equal(parsed.registrationNumber, '0000000000');
  assert.equal(parsed.message, '첫째 줄\n둘째 줄');
  assert.equal(parsed.contactPhone, input.contactPhone);
  assert.deepEqual(parseApplicationDetails(parsed), parsed);
  assert.equal(input.registrationNumber, '000-00-00000');
});

void test('required fields are checked at their step; invalid types, enums, excessive text, dates and number formats are refused', () => {
  assert.doesNotThrow(() =>
    parseApplicationDetails(emptyApplicationDetails(), 1),
  );
  assert.throws(
    () => parseApplicationDetails(emptyApplicationDetails(), 2),
    (error) => error instanceof ApplicationDetailsError && error.step === 2,
  );
  for (const key of applicationFieldKeys) {
    assert.throws(
      () => parseApplicationDetails({ ...details(), [key]: 123 }),
      ApplicationDetailsError,
    );
    assert.throws(
      () =>
        parseApplicationDetails({
          ...details(),
          [key]: '가'.repeat(applicationFields[key].max + 1),
        }),
      ApplicationDetailsError,
    );
    if ('required' in applicationFields[key])
      assert.throws(
        () => parseApplicationDetails({ ...details(), [key]: ' ' }),
        ApplicationDetailsError,
      );
  }
  for (const patch of [
    { version: 2 },
    { injected: true },
    { registrationNumber: '123' },
    { registrationNumber: '123x4567890' },
    { requestedStart: '2026-02-30' },
    { requestedStart: 'invalid' },
    { urgency: 'unknown' },
    { companyType: 'unknown' },
    { relationship: 'unknown' },
  ])
    assert.throws(
      () => parseApplicationDetails({ ...details(), ...patch }),
      ApplicationDetailsError,
    );
  assert.doesNotThrow(() =>
    parseApplicationDetails({ ...details(), requestedStart: '' }),
  );
});

void test('all three input sections render supplied values again after remount with accessible labels and limits', () => {
  const saved = details();
  for (const step of [1, 2, 3, 2, 1, 3]) {
    const html = renderToStaticMarkup(
      createElement(ApplicationDetailFields, {
        step,
        value: saved,
        onChange: () => {},
        inputClass: 'test-input',
      }),
    );
    for (const key of applicationFieldKeys.filter(
      (key) => applicationFields[key].step === step,
    )) {
      assert.ok(html.includes(`for="application-${key}"`), key);
      assert.ok(html.includes(`name="${key}"`), key);
      assert.ok(html.includes(saved[key]), key);
    }
    assert.ok(!html.includes('defaultValue'));
  }
});

void test('application summary escapes submitted text, identifies memo-only sharing, and does not fabricate legacy details', () => {
  const input = {
    ...details(),
    message: '<script>alert(1)</script>\nsecond line',
  };
  const html = renderToStaticMarkup(
    createElement(ApplicationDetailsSummary, { details: input }),
  );
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('공동 협업자 권한 부여'));
  assert.ok(html.includes(input.contactPhone));
  const legacy = renderToStaticMarkup(
    createElement(ApplicationDetailsSummary, {}),
  );
  assert.ok(legacy.includes('저장된 신청 상세가 없습니다'));
  assert.ok(!legacy.includes(input.contactPhone));
});

void test('submitted details survive retry, GET, flow projection and old-client save; other accounts cannot read or replace them', async () => {
  await writePortalState(seed());
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await PUT(request({ state: incoming() }));
    assert.equal(response.status, 200, await response.clone().text());
  }
  const own = (
    (await (await GET(request())).json()) as {
      state: ReturnType<typeof incoming>;
    }
  ).state;
  assert.equal(own.cases.length, 2);
  assert.deepEqual(
    own.cases.find((item) => item.id === 'detail-case')?.applicationDetails,
    parseApplicationDetails(details()),
  );
  const other = await (await GET(request(undefined, peer.email))).text();
  assert.ok(!other.includes('0000000000'));
  assert.ok(!other.includes('가상 검증용 요청 배경'));
  const forged = incoming();
  forged.cases[1].partnerMemberId = peer.id;
  forged.cases[1].trainee = peer.name;
  forged.cases[1].applicationDetails!.requestBackground = 'forged change';
  assert.equal((await PUT(request({ state: forged }, peer.email))).status, 200);
  const adminState = (
    (await (await GET(request(undefined, 'smkim3733@gmail.com'))).json()) as {
      state: ReturnType<typeof incoming>;
    }
  ).state;
  const olderClient = {
    ...adminState,
    cases: adminState.cases.map(
      ({ applicationDetails: _ignored, ...item }) => item,
    ),
  };
  assert.equal(
    (await PUT(request({ state: olderClient }, 'smkim3733@gmail.com'))).status,
    200,
  );
  const persisted = await readPortalState();
  const projected = projectFlowState(persisted, [
    newConsultingFlow('detail-case', '가상 입력기업', member.id, member.name),
  ]) as ReturnType<typeof incoming>;
  assert.deepEqual(
    projected.cases.find((item) => item.id === 'detail-case')
      ?.applicationDetails,
    parseApplicationDetails(details()),
  );
  assert.equal(projected.cases[0].applicationDetails, undefined);
});

void test('invalid submitted details fail atomically, while historical cases without details remain supported', async () => {
  await writePortalState(seed());
  const before = await readPortalState();
  for (const patch of [
    { registrationNumber: '123' },
    { requestBackground: '' },
    { requestedStart: '2026-99-99' },
  ]) {
    const state = incoming();
    state.cases[1].applicationDetails = { ...details(), ...patch };
    assert.equal((await PUT(request({ state }))).status, 400);
    assert.deepEqual(await readPortalState(), before);
  }
  const tooLong = incoming();
  tooLong.cases[1].company = '가'.repeat(101);
  assert.equal((await PUT(request({ state: tooLong }))).status, 400);
  const noServices = incoming();
  noServices.cases[1].service = '';
  assert.equal((await PUT(request({ state: noServices }))).status, 400);
  assert.equal((await PUT(request({ state: seed() }))).status, 200);
});
