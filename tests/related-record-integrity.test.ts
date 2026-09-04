import assert from 'node:assert/strict';
import test from 'node:test';
import { relatedRecordStateError } from '../lib/related-record-integrity';

const members = [
  { id: 'partner-one', name: '첫 파트너' },
  { id: 'partner-two', name: '둘 파트너' },
];
const cases = [
  {
    id: 'case-one',
    company: '가상 기업',
    trainee: '첫 파트너',
    partnerMemberId: 'partner-one',
  },
  {
    id: 'legacy-case',
    company: '가상 레거시 기업',
    trainee: '둘 파트너(가상)',
  },
];

function errorFor(
  key: 'tasks' | 'companyDocuments' | 'schedule',
  record: Record<string, unknown>,
) {
  const collections = {
    tasks: [] as Record<string, unknown>[],
    companyDocuments: [] as Record<string, unknown>[],
    schedule: [] as Record<string, unknown>[],
  };
  collections[key] = [record];
  return relatedRecordStateError(
    collections.tasks,
    collections.companyDocuments,
    collections.schedule,
    cases,
    members,
  );
}

void test('accepts direct, inherited, representative-only and legacy related assignments', () => {
  assert.equal(
    relatedRecordStateError(
      [
        { id: 'direct', partnerMemberId: 'partner-one' },
        { id: 'inherited', caseId: 'case-one' },
        { id: 'representative', caseId: 'case-one', partnerMemberId: '' },
      ],
      [{ id: 'legacy', caseId: 'legacy-case', partnerMemberId: 'partner-two' }],
      [{ id: 'unassigned-legacy', assignedTrainee: '첫 파트너' }],
      cases,
      members,
    ),
    null,
  );
});

void test('rejects malformed or unresolved case links for every related collection', () => {
  for (const [key, label] of [
    ['tasks', '업무'],
    ['companyDocuments', '기업자료'],
    ['schedule', '일정'],
  ] as const) {
    assert.match(errorFor(key, { id: 'bad', caseId: ' ' }) ?? '', new RegExp(`${label} 진행 연결`));
    assert.match(errorFor(key, { id: 'bad', caseId: 'missing' }) ?? '', new RegExp(`${label} 진행 연결`));
  }
});

void test('rejects malformed, unresolved or duplicate explicit member links', () => {
  assert.match(
    errorFor('tasks', { id: 'bad', partnerMemberId: null }) ?? '',
    /업무 담당 계정 연결이 올바르지 않습니다/,
  );
  assert.match(
    errorFor('companyDocuments', { id: 'bad', partnerMemberId: 'missing' }) ?? '',
    /기업자료 담당 계정 연결을 하나로 확인할 수 없습니다/,
  );
  assert.match(
    relatedRecordStateError(
      [],
      [],
      [{ id: 'bad', partnerMemberId: 'partner-one' }],
      cases,
      [...members, { id: 'partner-one', name: '중복 계정' }],
    ) ?? '',
    /일정 담당 계정 연결을 하나로 확인할 수 없습니다/,
  );
});

void test('rejects direct assignments that conflict with linked case ownership', () => {
  for (const [key, label] of [
    ['tasks', '업무'],
    ['companyDocuments', '기업자료'],
    ['schedule', '일정'],
  ] as const)
    assert.match(
      errorFor(key, {
        id: 'conflict',
        caseId: 'case-one',
        partnerMemberId: 'partner-two',
      }) ?? '',
      new RegExp(`${label} 담당 계정과 진행 담당 계정이 일치하지 않습니다`),
    );
});
