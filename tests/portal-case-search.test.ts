import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePortalCaseSearch } from '../lib/portal-case-search';

const cases = [
  { id: 'case-2026-00000001', company: '세림테크', privateNote: 'first' },
  { id: 'case-2026-00000002', company: '세림테크', privateNote: 'repeat' },
  { id: 'case-2026-00000003', company: '한빛 솔루션', privateNote: 'unique' },
];

void test('case search prioritizes a full or displayed application number', () => {
  assert.deepEqual(resolvePortalCaseSearch(cases, 'case-2026-00000002'), {
    kind: 'match',
    item: cases[1],
  });
  assert.deepEqual(resolvePortalCaseSearch(cases, '00000003'), {
    kind: 'match',
    item: cases[2],
  });
});

void test('case search normalizes company input and refuses to guess between repeat applications', () => {
  assert.deepEqual(resolvePortalCaseSearch(cases, '  한빛   솔루션  '), {
    kind: 'match',
    item: cases[2],
  });
  assert.deepEqual(resolvePortalCaseSearch(cases, '세림테크'), {
    kind: 'ambiguous',
    count: 2,
  });
});

void test('case search distinguishes empty, missing and unique partial queries', () => {
  assert.deepEqual(resolvePortalCaseSearch(cases, '   '), { kind: 'empty' });
  assert.deepEqual(resolvePortalCaseSearch(cases, '없는기업'), { kind: 'none' });
  assert.deepEqual(resolvePortalCaseSearch(cases, '한빛'), {
    kind: 'match',
    item: cases[2],
  });
});

void test('case search never returns records outside the authorized candidate list', () => {
  assert.deepEqual(resolvePortalCaseSearch([cases[2]], '세림테크'), { kind: 'none' });
});
