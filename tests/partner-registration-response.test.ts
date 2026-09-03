import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultPartnerPermissions,
  type PartnerRegistration,
} from '../lib/partner-registration';
import {
  PartnerRegistrationResponseError,
  readPartnerRegistrationResponse,
} from '../lib/partner-registration-response';

const requestId = 'partner-request-123456789';
const registration: PartnerRegistration = {
  name: '가상 신규파트너',
  phone: '010-0000-0000',
  affiliation: '가상 검증소속',
  email: 'new-partner@example.invalid',
  memberType: '한기평 컨설턴트',
};
const existing = {
  id: 'existing-partner',
  name: '가상 기존파트너',
  email: 'existing-partner@example.invalid',
  cohort: '',
  memberType: '기타',
  role: '일반 파트너',
  status: '활성',
  companies: 1,
  permissions: { ...defaultPartnerPermissions },
};
const member = {
  id: 'new-partner-id',
  ...registration,
  cohort: '',
  role: '일반 파트너',
  status: '활성',
  companies: 0,
  permissions: { ...defaultPartnerPermissions },
  registration: {
    method: 'admin',
    requestId,
    createdAt: '2026-09-04T00:00:00.000Z',
    createdBy: 'owner-id',
  },
};
const payload = {
  member,
  members: [existing, member],
  membersRevision: 3,
  replayed: false,
};
const expected = { registration, requestId };

void test('registration response returns only validated account fields', async () => {
  const result = await readPartnerRegistrationResponse(
    Response.json(
      {
        ...payload,
        secret: 'must-not-escape',
        member: { ...member, secret: 'must-not-escape' },
        members: [existing, { ...member, secret: 'must-not-escape' }],
      },
      { status: 201 },
    ),
    expected,
  );

  assert.deepEqual(result, payload);
  assert.equal(Object.hasOwn(result, 'secret'), false);
  assert.equal(Object.hasOwn(result.member, 'secret'), false);
});

void test('replayed registration requires the matching HTTP result', async () => {
  const result = await readPartnerRegistrationResponse(
    Response.json({ ...payload, replayed: true }, { status: 200 }),
    expected,
  );
  assert.equal(result.replayed, true);

  await assert.rejects(
    readPartnerRegistrationResponse(
      Response.json({ ...payload, replayed: false }, { status: 200 }),
      expected,
    ),
    /응답 형식이 올바르지 않습니다/,
  );
});

void test('mismatched registration and malformed roster never reach portal state', async () => {
  for (const changed of [
    { ...payload, member: { ...member, email: 'other@example.invalid' } },
    {
      ...payload,
      member: {
        ...member,
        permissions: { ...member.permissions, quoteContract: true },
      },
    },
    { ...payload, members: [existing] },
    { ...payload, members: [member, member] },
    { ...payload, members: [{ ...existing, email: member.email }, member] },
    { ...payload, membersRevision: -1 },
    { ...payload, replayed: 'false' },
  ])
    await assert.rejects(
      readPartnerRegistrationResponse(
        Response.json(changed, { status: 201 }),
        expected,
      ),
      /응답 형식이 올바르지 않습니다/,
    );
});

void test('registration failure retains only safe field errors and receipt', async () => {
  const receipt = 'A'.repeat(43);
  await assert.rejects(
    readPartnerRegistrationResponse(
      Response.json(
        {
          error: '입력 항목을 확인해 주세요.',
          errors: {
            email: '이미 등록된 이메일입니다.',
            unknown: 'must-not-escape',
            phone: 3,
          },
          recoveryReceipt: receipt,
        },
        { status: 409 },
      ),
      expected,
    ),
    (error: unknown) =>
      error instanceof PartnerRegistrationResponseError &&
      error.status === 409 &&
      error.message === '입력 항목을 확인해 주세요.' &&
      error.recoveryReceipt === receipt &&
      Object.keys(error.errors).length === 1 &&
      error.errors.email === '이미 등록된 이메일입니다.',
  );
});

void test('unreadable registration response keeps retry guidance and status', async () => {
  await assert.rejects(
    readPartnerRegistrationResponse(
      new Response('<html>gateway failure</html>', { status: 502 }),
      expected,
    ),
    (error: unknown) =>
      error instanceof PartnerRegistrationResponseError &&
      error.status === 502 &&
      /응답을 읽지 못했습니다/.test(error.message),
  );
});
