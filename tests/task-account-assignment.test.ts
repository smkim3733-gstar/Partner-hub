import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCaseAssignmentDraft,
  assignmentMemberId,
  assignmentDisplayName,
  createCaseAssignmentDraft,
  newTaskAssignment,
} from '../lib/assignment-display';
import { GET, PUT } from './state-request';
import { writePortalState } from '../lib/portal-state';

const permissions = {
  ownCases: true,
  fileUpload: true,
  collaborationApply: true,
  sharedSchedule: true,
  quoteContract: false,
};
const members = [
  {
    id: 'task-one',
    name: '가상 동명이인',
    email: 'task-one@example.invalid',
    status: '활성',
    permissions,
  },
  {
    id: 'task-two',
    name: '가상 동명이인',
    email: 'task-two@example.invalid',
    status: '활성',
    permissions,
  },
];
function request(email: string, state?: unknown) {
  return new Request('http://localhost/api/state', {
    method: state ? 'PUT' : 'GET',
    headers: {
      origin: 'http://localhost',
      'content-type': 'application/json',
      'oai-authenticated-user-id': email,
      'oai-authenticated-user-email': email,
    },
    ...(state ? { body: JSON.stringify({ state }) } : {}),
  });
}

type TestState = {
  version: number;
  consultationNumber: number;
  timeline: unknown[];
  schedule: unknown[];
  companyDocuments: unknown[];
  members: typeof members;
  cases: Array<{
    id: string;
    company: string;
    trainee: string;
    partnerMemberId?: string;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    assignee?: string;
    partnerMemberId?: string;
    caseId?: string;
    status?: string;
  }>;
};
async function stateFor(email: string) {
  const response = await GET(request(email));
  assert.equal(response.status, 200);
  return ((await response.json()) as { state: TestState }).state;
}

void test('administrator filters distinguish same-name accounts and retain unresolved legacy and administrator-only records', () => {
  assert.equal(
    assignmentMemberId({ partnerMemberId: 'task-one' }, '과거 이름', members),
    'task-one',
  );
  assert.equal(
    assignmentMemberId({ partnerMemberId: 'task-two' }, '과거 이름', members),
    'task-two',
  );
  assert.equal(assignmentMemberId({}, members[0].name, members), null);
  assert.equal(
    assignmentMemberId({ partnerMemberId: '' }, members[0].name, members),
    '',
  );
  assert.equal(
    assignmentMemberId({ partnerMemberId: 'missing' }, members[0].name, [
      members[0],
    ]),
    null,
  );
  assert.equal(
    assignmentMemberId({}, members[0].name, [
      members[0],
      { ...members[1], status: '정지' },
    ]),
    null,
  );
  assert.equal(
    assignmentMemberId({}, ` ${members[0].name}(가상) `, [members[0]]),
    'task-one',
  );
});

void test('task selection rejects unknown, duplicate, pending and suspended accounts without granting administrator-only work to a partner', () => {
  assert.deepEqual(newTaskAssignment('task-one', members, true), {
    partnerMemberId: 'task-one',
    assignee: members[0].name,
  });
  assert.deepEqual(newTaskAssignment('', members, true), {
    partnerMemberId: '',
    assignee: '김성민 대표',
  });
  assert.throws(() => newTaskAssignment('', members, false));
  assert.throws(() => newTaskAssignment('missing', members, true));
  assert.throws(() =>
    newTaskAssignment('task-one', [members[0], members[0]], true),
  );
  for (const status of ['정지', '승인대기'])
    assert.throws(() =>
      newTaskAssignment('task-one', [{ ...members[0], status }], true),
    );
});

void test('case assignment stays unchanged until the reviewed draft is applied', () => {
  const record = {
    id: 'assignment-case',
    company: '가상 담당변경기업',
    trainee: members[0].name,
    partnerMemberId: members[0].id,
    stage: '접수',
  };
  const original = structuredClone(record);
  const draft = createCaseAssignmentDraft(record, members[1].id, members);
  assert.deepEqual(record, original);
  assert.deepEqual(draft, {
    caseId: record.id,
    expectedMemberId: members[0].id,
    nextMemberId: members[1].id,
  });
  const changed = applyCaseAssignmentDraft(record, draft, members);
  assert.equal(changed.partnerMemberId, members[1].id);
  assert.equal(changed.trainee, members[1].name);
  assert.equal(changed.stage, record.stage);
  assert.deepEqual(record, original);
});

void test('case assignment rejects stale, flow-managed and unavailable account changes', () => {
  const record = {
    id: 'guarded-assignment',
    trainee: members[0].name,
    partnerMemberId: members[0].id,
  };
  const draft = createCaseAssignmentDraft(record, members[1].id, members);
  assert.throws(
    () => createCaseAssignmentDraft(record, members[0].id, members),
    /이미 이 계정/,
  );
  assert.throws(
    () => createCaseAssignmentDraft({ ...record, flowManaged: true }, members[1].id, members),
    /FLOW가 관리/,
  );
  assert.throws(
    () => createCaseAssignmentDraft(record, 'missing', members),
    /승인된 담당 계정/,
  );
  assert.throws(
    () => createCaseAssignmentDraft(record, members[1].id, [{ ...members[1], status: '정지' }]),
    /승인된 담당 계정/,
  );
  assert.throws(
    () => applyCaseAssignmentDraft({ ...record, partnerMemberId: members[1].id }, draft, members),
    /담당 정보가 변경/,
  );
  assert.throws(
    () => applyCaseAssignmentDraft(record, { ...draft, caseId: 'other-case' }, members),
    /진행을 다시 확인/,
  );
});

void test('real state handlers preserve account-assigned tasks and cases across display-name changes, including linked-only follow-ups', async () => {
  const seed = {
    version: 1,
    consultationNumber: 0,
    timeline: [],
    schedule: [],
    companyDocuments: [],
    cases: [],
    tasks: [],
    members: structuredClone(members),
  };
  await writePortalState(seed);
  const current = await stateFor('seedy@sites.test');
  current.cases = [
    {
      id: 'task-case',
      company: '가상 본인기업',
      trainee: members[0].name,
      partnerMemberId: 'task-one',
    },
  ];
  current.tasks = [
    {
      id: 'own-task',
      title: '본인 직접업무',
      ...newTaskAssignment('task-one', members, true),
    },
    {
      id: 'peer-task',
      title: '타인 비공개업무',
      ...newTaskAssignment('task-two', members, true),
    },
    {
      id: 'admin-task',
      title: '대표 비공개업무',
      ...newTaskAssignment('', members, true),
    },
    { id: 'linked-task', title: '상담 후속업무', caseId: 'task-case' },
  ];
  assert.equal((await PUT(request('seedy@sites.test', current))).status, 200);
  const renamed = await stateFor('seedy@sites.test');
  renamed.members[0].name = '가상 변경이름';
  assert.equal((await PUT(request('seedy@sites.test', renamed))).status, 200);
  const visible = await stateFor(members[0].email);
  assert.deepEqual(
    visible.tasks.map((task: { id: string }) => task.id),
    ['own-task', 'linked-task'],
  );
  assert.equal(visible.cases.length, 1);
  assert.equal(
    assignmentDisplayName(
      visible.cases[0],
      visible.cases[0].trainee,
      visible.members,
    ),
    '가상 변경이름',
  );
  assert.equal(
    assignmentDisplayName(
      visible.tasks[0],
      visible.tasks[0].assignee,
      visible.members,
    ),
    '가상 변경이름',
  );
  visible.tasks[0].status = '완료';
  visible.tasks[1].status = '완료';
  assert.equal((await PUT(request(members[0].email, visible))).status, 200);
  const saved = await stateFor('seedy@sites.test');
  assert.equal(saved.tasks[0].status, '완료');
  assert.equal(saved.tasks[3].status, '완료');
  assert.deepEqual(saved.tasks[1], current.tasks[1]);
  assert.deepEqual(saved.tasks[2], current.tasks[2]);
});
