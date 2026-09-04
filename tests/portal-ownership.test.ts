import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeStateForPortalUser,
  stateForPortalUser,
  type PortalUser,
} from '../lib/portal-auth';
import { mayReadCompanyFile, type CompanyFileRow } from '../lib/company-files';

const permissions = {
  ownCases: true,
  sharedSchedule: true,
  collaborationApply: true,
  fileUpload: true,
  quoteContract: false,
};
const user: PortalUser = {
  id: 'password:partner-one',
  email: 'one@example.invalid',
  displayName: '가상 동명이인',
  role: 'trainee',
  memberId: 'partner-one',
  memberName: '가상 동명이인',
  permissions,
  authMethod: 'password',
};
function fixture() {
  return {
    version: 1,
    consultationNumber: 0,
    membersRevision: 0,
    members: [
      {
        id: 'partner-one',
        name: user.memberName!,
        email: user.email,
        status: '활성',
        permissions,
      },
      {
        id: 'partner-two',
        name: user.memberName!,
        email: 'two@example.invalid',
        status: '활성',
        permissions,
      },
    ],
    cases: [
      {
        id: 'own-case',
        company: '가상 본인기업',
        trainee: user.memberName,
        partnerMemberId: user.memberId,
      },
      {
        id: 'other-case',
        company: '가상 타인기업',
        trainee: user.memberName,
        partnerMemberId: 'partner-two',
      },
      {
        id: 'legacy-case',
        company: '가상 미확정기업',
        trainee: user.memberName,
      },
    ],
    tasks: [
      { id: 'ambiguous-task', assignee: user.memberName, title: '미확정 업무' },
    ],
    companyDocuments: [
      {
        id: 'ambiguous-doc',
        assignedTrainee: user.memberName,
        title: '미확정 자료',
      },
    ],
    schedule: [
      {
        id: 'ambiguous-meeting',
        assignedTrainee: user.memberName,
        company: '가상 타인기업',
        shareMode: 'all_with_assignee',
        source: 'partner',
        time: '10:00',
        end: '11:00',
        description: '비공개 상담내용',
        meetingUrl: 'https://private.example.invalid',
        caseId: 'other-case',
      },
    ],
    timeline: [
      {
        caseId: 'other-case',
        date: '2026-08-31',
        title: '비공개 진행',
        detail: '타인 기록',
      },
    ],
  };
}

void test('same-name partners only see ID-assigned cases; ambiguous legacy data and schedule details stay private', () => {
  const visible = stateForPortalUser(fixture(), user) as ReturnType<
    typeof fixture
  >;
  assert.deepEqual(
    visible.cases.map((item) => item.id),
    ['own-case'],
  );
  assert.deepEqual(visible.tasks, []);
  assert.deepEqual(visible.companyDocuments, []);
  assert.deepEqual(visible.timeline, []);
  assert.equal(visible.schedule[0].time, '10:00');
  assert.doesNotMatch(
    JSON.stringify(visible.schedule),
    /가상 타인기업|비공개 상담내용|private\.example|partner-two|other-case/,
  );
});

void test('duplicate or blank case IDs fail closed before partner projection can mix records', () => {
  const duplicate = fixture();
  duplicate.cases[1].id = duplicate.cases[0].id;
  duplicate.timeline = [
    {
      caseId: duplicate.cases[0].id,
      date: '2026-09-05',
      title: '충돌 진행기록',
      detail: '다른 파트너 비공개 기록',
    },
  ];
  assert.throws(
    () => stateForPortalUser(duplicate, user),
    /사건 ID가 없거나 중복되었습니다/,
  );

  const blank = fixture();
  blank.cases[0].id = ' ';
  assert.throws(
    () => stateForPortalUser(blank, user),
    /사건 ID가 없거나 중복되었습니다/,
  );
});

void test('duplicate or blank task, document and schedule IDs fail closed before ownership merging', () => {
  const fixtures = [
    {
      key: 'tasks',
      label: '업무',
      records: [
        { id: 'collision-record', assignee: user.memberName, partnerMemberId: user.memberId, title: '첫 업무' },
        { id: 'collision-record', assignee: user.memberName, partnerMemberId: user.memberId, title: '둘째 업무' },
      ],
    },
    {
      key: 'companyDocuments',
      label: '기업자료',
      records: [
        { id: 'collision-record', assignedTrainee: user.memberName, partnerMemberId: user.memberId, title: '첫 자료' },
        { id: 'collision-record', assignedTrainee: user.memberName, partnerMemberId: user.memberId, title: '둘째 자료' },
      ],
    },
    {
      key: 'schedule',
      label: '일정',
      records: [
        { id: 'collision-record', assignedTrainee: user.memberName, partnerMemberId: user.memberId, title: '첫 일정' },
        { id: 'collision-record', assignedTrainee: user.memberName, partnerMemberId: user.memberId, title: '둘째 일정' },
      ],
    },
  ] as const;

  for (const { key, label, records } of fixtures) {
    const duplicate = { ...fixture(), [key]: records };
    assert.throws(
      () => stateForPortalUser(duplicate, user),
      new RegExp(`${label} ID가 없거나 중복되었습니다`),
    );
    const blank = { ...fixture(), [key]: [{ ...records[0], id: ' ' }] };
    assert.throws(
      () => stateForPortalUser(blank, user),
      new RegExp(`${label} ID가 없거나 중복되었습니다`),
    );
  }
});

void test('forged incoming assignee and ID cannot rewrite another account case, timeline or ambiguous legacy records', () => {
  const current = fixture();
  const incoming = structuredClone(current);
  incoming.cases[1] = {
    ...incoming.cases[1],
    partnerMemberId: user.memberId,
    company: '탈취 시도',
  };
  incoming.cases[2].company = '레거시 탈취 시도';
  incoming.tasks[0].title = '업무 탈취 시도';
  incoming.companyDocuments[0].title = '자료 탈취 시도';
  incoming.timeline[0].detail = '진행 탈취 시도';
  const saved = mergeStateForPortalUser(
    current,
    incoming,
    user,
  ) as typeof current;
  assert.deepEqual(saved.cases.slice(1), current.cases.slice(1));
  assert.deepEqual(saved.tasks, current.tasks);
  assert.deepEqual(saved.companyDocuments, current.companyDocuments);
  assert.deepEqual(saved.timeline, current.timeline);
  assert.deepEqual(saved.members, current.members);
});

void test('stable timeline IDs preserve same-title events and stay scoped to their case', () => {
  const current = {
    ...fixture(),
    timeline: [
      { id: 'shared-id', caseId: 'other-case', date: '방금 전', title: '상담 #1 저장', detail: '타인 원본' },
      { id: 'own-existing', caseId: 'own-case', date: '방금 전', title: '상담 #1 저장', detail: '본인 원본' },
    ],
  };
  const incoming = {
    ...structuredClone(current),
    timeline: [
      { id: 'shared-id', caseId: 'own-case', date: '방금 전', title: '상담 #1 저장', detail: '같은 ID의 본인 기록' },
      { id: 'own-existing', caseId: 'own-case', date: '방금 전', title: '상담 #1 저장', detail: '본인 수정' },
      { id: 'own-first', caseId: 'own-case', date: '방금 전', title: '상담 #2 저장', detail: '첫 번째' },
      { id: 'own-second', caseId: 'own-case', date: '방금 전', title: '상담 #2 저장', detail: '두 번째' },
      { id: 'own-duplicate', caseId: 'own-case', date: '방금 전', title: '상담 #3 저장', detail: '중복 첫 번째' },
      { id: 'own-duplicate', caseId: 'own-case', date: '방금 전', title: '상담 #3 저장', detail: '중복 마지막' },
    ],
  };

  const saved = mergeStateForPortalUser(current, incoming, user) as typeof current;
  assert.equal(saved.timeline.find((item) => item.caseId === 'other-case')?.detail, '타인 원본');
  assert.equal(saved.timeline.find((item) => item.id === 'own-existing')?.detail, '본인 수정');
  assert.equal(saved.timeline.filter((item) => item.caseId === 'own-case' && item.id === 'shared-id').length, 1);
  assert.equal(saved.timeline.filter((item) => item.caseId === 'own-case' && item.title === '상담 #2 저장').length, 2);
  assert.equal(saved.timeline.filter((item) => item.id === 'own-duplicate').length, 1);
  assert.equal(saved.timeline.find((item) => item.id === 'own-duplicate')?.detail, '중복 마지막');
});

void test('new partner records bind to the authenticated ID without changing an existing assignment', () => {
  const current = fixture();
  const incoming = {
    ...structuredClone(current),
    cases: [
      { id: 'new-case', trainee: user.memberName, company: '새 가상기업' },
    ],
    timeline: [],
  };
  const saved = mergeStateForPortalUser(current, incoming, user) as ReturnType<
    typeof fixture
  >;
  assert.equal(
    saved.cases.find((item) => item.id === 'new-case')?.partnerMemberId,
    user.memberId,
  );
  assert.equal(
    saved.cases.find((item) => item.id === 'other-case')?.partnerMemberId,
    'partner-two',
  );
});

void test('duplicate new partner record IDs are rejected instead of collapsing data', () => {
  const current = fixture();
  const incoming = {
    ...structuredClone(current),
    tasks: [
      ...structuredClone(current.tasks),
      { id: 'new-task', assignee: user.memberName, title: '첫 번째 업무' },
      { id: 'new-task', assignee: user.memberName, title: '마지막 업무' },
    ],
  };
  assert.throws(
    () => mergeStateForPortalUser(current, incoming, user),
    /업무 ID가 없거나 중복되었습니다/,
  );
});

void test('partner cannot create an operational record with a reserved seed ID', () => {
  const current = fixture();
  const incoming = {
    ...structuredClone(current),
    cases: [
      ...structuredClone(current.cases),
      {
        id: 'case-1',
        trainee: user.memberName,
        partnerMemberId: user.memberId,
        company: '실제 진행 위장 시도',
      },
    ],
  };
  assert.throws(
    () => mergeStateForPortalUser(current, incoming, user),
    /가상 예시 식별자는 새 운영 기록에 사용할 수 없습니다/,
  );
  const taskIncoming = {
    ...structuredClone(current),
    tasks: [
      ...structuredClone(current.tasks),
      {
        id: 'task-diagnosis-review-1',
        title: '가상 파생업무 위장 시도',
        assignee: user.memberName,
        partnerMemberId: user.memberId,
      },
    ],
  };
  assert.throws(
    () => mergeStateForPortalUser(current, taskIncoming, user),
    /가상 예시 식별자는 새 운영 기록에 사용할 수 없습니다/,
  );
});

void test('unambiguous legacy names remain usable, including normalized display names', () => {
  const current = fixture();
  current.members = [current.members[0]];
  current.members[0].name = ` ${user.memberName!}(가상) `;
  const visible = stateForPortalUser(current, user) as typeof current;
  assert.deepEqual(
    visible.cases.map((item) => item.id),
    ['own-case', 'legacy-case'],
  );
  assert.equal(visible.tasks.length, 1);
  assert.equal(visible.companyDocuments.length, 1);
});

void test('ID-linked related records survive duplicate names but conflicting case links and suspended duplicates never grant access', () => {
  const current = fixture();
  current.members[1].status = '정지';
  const raw = {
    ...current,
    tasks: [
      {
        id: 'own-task',
        assignee: '이전 표시이름',
        partnerMemberId: user.memberId,
      },
      { id: 'linked-task', caseId: 'own-case' },
      {
        id: 'conflicting-task',
        caseId: 'other-case',
        partnerMemberId: user.memberId,
      },
      { id: 'unknown-task', caseId: 'missing-case', assignee: user.memberName },
      ...current.tasks,
    ],
  };
  const visible = stateForPortalUser(raw, user) as typeof raw;
  assert.deepEqual(
    visible.tasks.map((item) => item.id),
    ['own-task', 'linked-task'],
  );
  assert.deepEqual(
    visible.cases.map((item) => item.id),
    ['own-case'],
  );
});

void test('legacy file permission refuses a same-name claimant and keeps administrator access', () => {
  const row: CompanyFileRow = {
    id: 'test-file',
    storage_key: 'private/test-file',
    original_name: '가상.txt',
    company: '가상기업',
    category: '기타자료',
    title: '가상 자료',
    assigned_trainee: user.memberName!,
    uploaded_by_user_id: 'password:partner-two',
    uploaded_by_email: 'two@example.invalid',
    content_type: 'text/plain',
    size_bytes: 10,
    created_at: '2026-08-31T00:00:00Z',
  };
  assert.equal(mayReadCompanyFile(user, row, fixture()), false);
  assert.equal(
    mayReadCompanyFile({ ...user, role: 'admin' }, row, fixture()),
    true,
  );
  const unique = fixture();
  unique.members = [unique.members[0]];
  assert.equal(mayReadCompanyFile(user, row, unique), true);
});
