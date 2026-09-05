import assert from 'node:assert/strict';
import test from 'node:test';
import {
  prependApplicationCase,
  recordBelongsToCase,
} from '../lib/application-case-links';
import { POST as upload } from '../app/api/files/route';
import { DELETE as remove } from '../app/api/files/[id]/route';
import { GET as getState, PUT as saveState } from './state-request';
import { writePortalState } from '../lib/portal-state';
import { companyFileDatabase, findCompanyFile } from '../lib/company-files';
import {
  listIntakeSources,
  previewIntakeSource,
} from '../lib/consulting-intake-sources';
import { newConsultingFlow } from '../lib/consulting-flow';
import { commitFlow } from '../lib/consulting-flow-store';

const permissions = {
  ownCases: true,
  fileUpload: true,
  collaborationApply: true,
  sharedSchedule: true,
  quoteContract: false,
};
const member = {
  id: 'repeat-member',
  name: '가상 신청자',
  email: 'repeat@example.invalid',
  status: '활성',
  permissions,
};
const peer = {
  ...member,
  id: 'repeat-peer',
  email: 'repeat-peer@example.invalid',
};
const company = '가상 반복기업';
const caseRecord = (id: string, partnerMemberId = member.id) => ({
  id,
  company,
  trainee: member.name,
  partnerMemberId,
});
const seed = () => ({
  version: 1,
  consultationNumber: 0,
  cases: [caseRecord('repeat-old'), caseRecord('repeat-peer-case', peer.id)],
  timeline: [],
  tasks: [],
  companyDocuments: [],
  schedule: [],
  members: [member, peer],
});
function request(body?: unknown, method = body ? 'POST' : 'GET') {
  return new Request('http://localhost/api/files', {
    method,
    headers: {
      origin: 'http://localhost',
      'oai-authenticated-user-id': member.email,
      'oai-authenticated-user-email': member.email,
      ...(body instanceof FormData
        ? {}
        : { 'content-type': 'application/json' }),
    },
    ...(body
      ? { body: body instanceof FormData ? body : JSON.stringify(body) }
      : {}),
  });
}
function form(caseId?: string, companyName = company) {
  const data = new FormData();
  data.set(
    'file',
    new File(['SYNTHETIC_REPEAT_SOURCE'], 'synthetic.txt', {
      type: 'text/plain',
    }),
  );
  data.set('company', companyName);
  data.set('title', '가상 신청 근거자료');
  data.set('category', '기타자료');
  data.set('consent', 'confirmed');
  if (caseId !== undefined) data.set('caseId', caseId);
  return data;
}

void test('repeat applications retain separate cases even with an identical company and account; only the same ID is deduplicated', () => {
  const original = [caseRecord('original')];
  const next = prependApplicationCase(original, caseRecord('next'));
  const otherPartner = prependApplicationCase(
    next,
    caseRecord('peer-next', peer.id),
  );
  assert.deepEqual(
    otherPartner.map((item) => item.id),
    ['peer-next', 'next', 'original'],
  );
  assert.equal(original.length, 1);
  assert.equal(
    prependApplicationCase(otherPartner, caseRecord('next')),
    otherPartner,
  );
});

void test('case-linked documents cannot appear in another repeat application; ambiguous legacy documents are not guessed', () => {
  const first = caseRecord('first');
  const second = caseRecord('second');
  const cases = [first, second];
  const linked = { company, caseId: first.id, partnerMemberId: member.id };
  assert.equal(
    recordBelongsToCase(linked, member.name, first, cases, [member, peer]),
    true,
  );
  assert.equal(
    recordBelongsToCase(linked, member.name, second, cases, [member, peer]),
    false,
  );
  const legacy = { company, partnerMemberId: member.id };
  assert.equal(
    recordBelongsToCase(legacy, member.name, first, cases, [member, peer]),
    false,
  );
  assert.equal(
    recordBelongsToCase(legacy, member.name, first, [first], [member, peer]),
    true,
  );
  assert.equal(
    recordBelongsToCase(
      { ...linked, partnerMemberId: peer.id },
      member.name,
      first,
      cases,
      [member, peer],
    ),
    false,
  );
});

void test('two same-company applications retain both timelines and each private source across a real state round trip', async () => {
  await writePortalState(seed());
  const a = caseRecord('repeat-new-a');
  const b = caseRecord('repeat-new-b');
  const uploadA = await upload(request(form(a.id)));
  const uploadB = await upload(request(form(b.id)));
  assert.equal(uploadA.status, 201, await uploadA.clone().text());
  assert.equal(uploadB.status, 201, await uploadB.clone().text());
  type Stored = {
    id: string;
    fileName: string;
    sizeBytes: number;
    caseId: string;
    partnerMemberId: string;
    assignedTrainee: string;
  };
  const fileA = ((await uploadA.json()) as { file: Stored }).file;
  const fileB = ((await uploadB.json()) as { file: Stored }).file;
  assert.equal(fileA.caseId, a.id);
  assert.equal(fileB.caseId, b.id);
  const incoming = {
    ...seed(),
    cases: [a, b],
    timeline: [a, b].map((item) => ({
      caseId: item.id,
      date: '2026-08-31',
      title: '협업신청 접수',
      detail: item.id,
      type: '접수',
      tone: 'navy',
    })),
    companyDocuments: [fileA, fileB].map((file) => ({
      id: `doc-${file.id}`,
      company,
      caseId: file.caseId,
      partnerMemberId: member.id,
      assignedTrainee: member.name,
      storageFileId: file.id,
      fileName: file.fileName,
      fileSize: file.sizeBytes,
      title: '협업신청 접수자료',
      category: '기타자료',
      status: '제출완료',
      submittedBy: member.name,
      updatedAt: '방금 전',
      version: 'V1',
      sensitive: true,
    })),
  };
  const saved = await saveState(request({ state: incoming }, 'PUT'));
  assert.equal(saved.status, 200, await saved.clone().text());
  const reloaded = (await (await getState(request())).json()) as {
    state: {
      cases: Array<{ id: string }>;
      timeline: Array<{ caseId: string }>;
      companyDocuments: Array<{ caseId: string }>;
    };
  };
  assert.deepEqual(
    reloaded.state.cases.map((item) => item.id),
    ['repeat-old', a.id, b.id],
  );
  assert.deepEqual(
    reloaded.state.timeline.map((item) => item.caseId),
    [a.id, b.id],
  );
  assert.deepEqual(
    reloaded.state.companyDocuments.map((item) => item.caseId),
    [a.id, b.id],
  );
  const flowA = newConsultingFlow(a.id, company, member.id, member.name);
  const flowB = newConsultingFlow(b.id, company, member.id, member.name);
  assert.deepEqual(
    (await listIntakeSources(flowA)).files.map((file) => file.id),
    [fileA.id],
  );
  assert.deepEqual(
    (await listIntakeSources(flowB)).files.map((file) => file.id),
    [fileB.id],
  );
  await assert.rejects(previewIntakeSource(flowA, fileB.id), /연결된 신청자료/);
  assert.equal((await previewIntakeSource(flowA, fileA.id)).file.id, fileA.id);
  assert.equal((await findCompanyFile(fileA.id))?.case_id, a.id);
  assert.equal(
    (
      await remove(request(undefined, 'DELETE'), {
        params: Promise.resolve({ id: fileA.id }),
      })
    ).status,
    204,
  );
  assert.equal(
    await companyFileDatabase()
      .prepare('SELECT file_id FROM company_file_case_links WHERE file_id = ?1')
      .bind(fileA.id)
      .first(),
    null,
  );
  assert.ok(await findCompanyFile(fileB.id));
});

void test('upload refuses foreign, mismatched, malformed and duplicate case links and uses the stored flow assignment', async () => {
  await writePortalState(seed());
  assert.equal((await upload(request(form('repeat-peer-case')))).status, 403);
  assert.equal(
    (await upload(request(form('repeat-old', '가상 다른기업')))).status,
    403,
  );
  for (const value of ['', '../invalid', 'x'.repeat(121)])
    assert.equal((await upload(request(form(value)))).status, 400);
  const duplicate = form('repeat-old');
  duplicate.append('caseId', 'repeat-other');
  assert.equal((await upload(request(duplicate))).status, 400);
  const before = newConsultingFlow('repeat-old', company, peer.id, peer.name);
  await commitFlow(before, {
    ...before,
    revision: 1,
    updatedAt: new Date().toISOString(),
  });
  assert.equal((await upload(request(form('repeat-old')))).status, 403);
});

void test('general company files remain unlinked and usable without silently assigning historical case IDs', async () => {
  await writePortalState(seed());
  const response = await upload(request(form()));
  assert.equal(response.status, 201);
  const file = (
    (await response.json()) as { file: { id: string; caseId?: string } }
  ).file;
  assert.equal(file.caseId, undefined);
  assert.equal((await findCompanyFile(file.id))?.case_id, null);
  const options = await listIntakeSources(
    newConsultingFlow('unlinked-review', company, member.id, member.name),
  );
  assert.ok(options.files.some((item) => item.id === file.id));
});
