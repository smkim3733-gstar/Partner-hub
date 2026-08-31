import assert from 'node:assert/strict';
import test from 'node:test';
import { POST as upload } from '../app/api/files/route';
import { GET as download, DELETE as remove } from '../app/api/files/[id]/route';
import { writePortalState } from '../lib/portal-state';
import { companyFileDatabase, findCompanyFile } from '../lib/company-files';
import {
  listIntakeSources,
  previewIntakeSource,
} from '../lib/consulting-intake-sources';
import { newConsultingFlow } from '../lib/consulting-flow';

const permissions = {
  ownCases: true,
  fileUpload: true,
  collaborationApply: true,
  sharedSchedule: true,
  quoteContract: false,
};
const member = {
  id: 'file-owner-one',
  name: '가상 동명이인',
  email: 'file-one@example.invalid',
  status: '활성',
  permissions,
};
const peer = {
  ...member,
  id: 'file-owner-two',
  email: 'file-two@example.invalid',
};
const ownerEmail = 'seedy@sites.test';
function state() {
  return {
    version: 1,
    consultationNumber: 0,
    cases: [],
    timeline: [],
    tasks: [],
    schedule: [],
    companyDocuments: [],
    members: [{ ...member }, { ...peer }],
  };
}
function request(email: string, method = 'GET', body?: FormData) {
  return new Request('http://localhost/api/files', {
    method,
    ...(body ? { body } : {}),
    headers: {
      origin: 'http://localhost',
      'oai-authenticated-user-id': email,
      'oai-authenticated-user-email': email,
    },
  });
}
function form(partnerId?: string, name = member.name) {
  const data = new FormData();
  data.set(
    'file',
    new File(['SYNTHETIC_PRIVATE_FILE'], 'synthetic.txt', {
      type: 'text/plain',
    }),
  );
  data.set('company', '가상 동일기업');
  data.set('title', '가상 기업자료');
  data.set('category', '기타자료');
  data.set('assignedTrainee', name);
  data.set('consent', 'confirmed');
  if (partnerId !== undefined) data.set('partnerMemberId', partnerId);
  return data;
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });

void test('same-name uploads bind to the authenticated account despite forged assignment, survive rename, and delete atomically', async () => {
  const current = state();
  await writePortalState(current);
  const created = await upload(request(member.email, 'POST', form(peer.id)));
  assert.equal(created.status, 201, await created.clone().text());
  const { file } = (await created.json()) as {
    file: { id: string; partnerMemberId: string };
  };
  assert.equal(file.partnerMemberId, member.id);
  assert.equal(
    (await download(request(member.email), context(file.id))).status,
    200,
  );
  assert.equal(
    (await download(request(peer.email), context(file.id))).status,
    403,
  );
  assert.equal(
    (await remove(request(peer.email, 'DELETE'), context(file.id))).status,
    403,
  );
  current.members[0].name = '가상 변경이름';
  await writePortalState(current);
  assert.equal(
    (await download(request(member.email), context(file.id))).status,
    200,
  );
  assert.equal(
    (await download(request(peer.email), context(file.id))).status,
    403,
  );
  assert.equal(
    (await remove(request(member.email, 'DELETE'), context(file.id))).status,
    204,
  );
  assert.equal(await findCompanyFile(file.id), null);
  assert.equal(
    await companyFileDatabase()
      .prepare('SELECT * FROM company_file_assignments WHERE file_id = ?1')
      .bind(file.id)
      .first(),
    null,
  );
});

void test('administrator selects an account ID; missing, invalid, inactive or duplicate fields cannot misassign files', async () => {
  const current = state();
  await writePortalState(current);
  assert.equal((await upload(request(ownerEmail, 'POST', form()))).status, 400);
  assert.equal(
    (await upload(request(ownerEmail, 'POST', form('missing-member')))).status,
    400,
  );
  const duplicate = form(member.id);
  duplicate.append('partnerMemberId', peer.id);
  assert.equal(
    (await upload(request(ownerEmail, 'POST', duplicate))).status,
    400,
  );
  current.members[1].status = '정지';
  await writePortalState(current);
  assert.equal(
    (await upload(request(ownerEmail, 'POST', form(peer.id)))).status,
    400,
  );
  const created = await upload(
    request(
      ownerEmail,
      'POST',
      form(member.id, '이름 입력은 권한 근거가 아님'),
    ),
  );
  assert.equal(created.status, 201, await created.clone().text());
  const { file } = (await created.json()) as {
    file: { id: string; partnerMemberId: string; assignedTrainee: string };
  };
  assert.equal(file.partnerMemberId, member.id);
  assert.equal(file.assignedTrainee, member.name);
  assert.equal(
    (await download(request(member.email), context(file.id))).status,
    200,
  );
});

void test('explicit administrator-only storage never becomes accessible through a later matching name', async () => {
  await writePortalState(state());
  const created = await upload(request(ownerEmail, 'POST', form('')));
  assert.equal(created.status, 201);
  const { file } = (await created.json()) as {
    file: { id: string; partnerMemberId: string };
  };
  assert.equal(file.partnerMemberId, '');
  await writePortalState({ ...state(), members: [member] });
  assert.equal(
    (await download(request(member.email), context(file.id))).status,
    403,
  );
  assert.equal(
    (await download(request(ownerEmail), context(file.id))).status,
    200,
  );
});

void test('intake review uses file account ID for the same company and remains usable after a display-name change', async () => {
  await writePortalState(state());
  const own = await upload(request(member.email, 'POST', form()));
  const other = await upload(request(peer.email, 'POST', form()));
  const ownId = ((await own.json()) as { file: { id: string } }).file.id;
  const otherId = ((await other.json()) as { file: { id: string } }).file.id;
  const flow = newConsultingFlow(
    'file-intake-case',
    '가상 동일기업',
    member.id,
    '가상 변경이름',
  );
  const options = await listIntakeSources(flow);
  assert.ok(options.files.some((file) => file.id === ownId));
  assert.ok(!options.files.some((file) => file.id === otherId));
  await assert.rejects(previewIntakeSource(flow, otherId), /연결된 신청자료/);
  const preview = await previewIntakeSource(flow, ownId);
  assert.equal(preview.file.id, ownId);
});
