import assert from 'node:assert/strict';
import test from 'node:test';
import { googleCalendarDraftUrl, scheduleDateGroups } from '../lib/schedule-display';

const base = { date: '09.15', time: '10:00', end: '11:00', company: '가상 일정 & 검증', service: '가상 상담', method: '가상 상담실' };

void test('date groups include dates beyond the old week and distinguish identical month/day across years', () => {
  const items = [
    { ...base, id: 'next-year', isoDate: '2027-09-15' },
    { ...base, id: 'later', isoDate: '2026-09-15', time: '14:00', end: '15:00' },
    { ...base, id: 'earlier', isoDate: '2026-09-15' },
  ];
  const before = structuredClone(items);
  const groups = scheduleDateGroups(items);
  assert.deepEqual(groups.map(g => g.key), ['2026-09-15', '2027-09-15']);
  assert.deepEqual(groups[0].items.map(i => i.id), ['earlier', 'later']);
  assert.equal(groups[0].label, '2026.09.15 (화)');
  assert.equal(groups[1].label, '2027.09.15 (수)');
  assert.deepEqual(items, before);
});

void test('unknown years and invalid calendar dates remain visible without an invented year', () => {
  const groups = scheduleDateGroups([
    { ...base },
    { ...base, isoDate: '2026-02-29' },
    { ...base, isoDate: '2028-02-29' },
  ]);
  assert.equal(groups[0].key, '2028-02-29');
  assert.ok(groups.find(g => g.label === '09.15 · 연도 확인 필요'));
  assert.ok(groups.find(g => g.label === '2026-02-29 · 날짜 확인 필요'));
  assert.equal(groups.flatMap(g => g.items).length, 3);
  assert.deepEqual(scheduleDateGroups([]), []);
});

void test('calendar draft preserves cross-year ending and Korean time zone without sending anything', () => {
  const url = new URL(googleCalendarDraftUrl({ ...base, isoDate: '2026-12-31', endIsoDate: '2027-01-01', time: '23:30', end: '00:30' })!);
  assert.equal(url.searchParams.get('dates'), '20261231T233000/20270101T003000');
  assert.equal(url.searchParams.get('ctz'), 'Asia/Seoul');
  assert.equal(url.searchParams.get('text'), '[한기평 상담] 가상 일정 & 검증 - 가상 상담');
});

void test('calendar drafts are unavailable for unknown years, impossible dates and invalid or reversed times', () => {
  for (const data of [
    base,
    { ...base, isoDate: '2026-02-29' },
    { ...base, isoDate: '2026-09-15', endIsoDate: '2026-09-14' },
    { ...base, isoDate: '2026-09-15', time: '24:00' },
    { ...base, isoDate: '2026-09-15', end: '10:00' },
    { ...base, isoDate: '2026-09-15', end: '00:30' },
  ]) assert.equal(googleCalendarDraftUrl(data), null);
  assert.ok(googleCalendarDraftUrl({ ...base, isoDate: '2026-09-15' }));
});
