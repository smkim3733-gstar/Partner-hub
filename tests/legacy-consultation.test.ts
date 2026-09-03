import assert from 'node:assert/strict';
import test from 'node:test';
import {
  consultationTitleMaxLength,
  emptyConsultationSelections,
  prepareConsultation,
  type ConsultationPayload,
} from '../lib/legacy-consultation';
import { googleCalendarDraftUrl } from '../lib/schedule-display';

const input: ConsultationPayload = { title: '  가상 상담  ', startsAt: '2026-12-31T23:30', method: '화상', status: '일정 확정', addToSchedule: true, shareMode: 'private', followUps: ['서류요청'] };

void test('new consultation starts without invented method, status, schedule or follow-up', () => {
  assert.deepEqual(emptyConsultationSelections(), {
    followUps: [],
    addToSchedule: false,
    method: '',
    status: '',
    shareMode: 'all_with_assignee',
  });
});

void test('legacy consultation requires a title and a real Korean calendar minute before any records are prepared', () => {
  assert.equal(prepareConsultation({ ...input, title: ' ' }).ok, false);
  assert.equal(prepareConsultation({ ...input, title: '가'.repeat(consultationTitleMaxLength + 1) }).ok, false);
  for (const startsAt of ['', '2026-02-29T10:00', '2026-04-31T10:00', '2026-12-31T24:00', '2026-12-31T11:60', '2026-12-31T10:00Z', '0000-01-01T10:00', '9999-12-31T23:30']) {
    const result = prepareConsultation({ ...input, startsAt });
    assert.equal(result.ok, false, startsAt);
  }
  assert.equal(prepareConsultation({ ...input, startsAt: '2028-02-29T10:00' }).ok, true);
});

void test('legacy consultation requires an explicit allowed method and status', () => {
  assert.deepEqual(prepareConsultation({ ...input, method: '' }), {
    ok: false,
    field: 'method',
    error: '상담방식을 선택해 주세요.',
  });
  assert.deepEqual(prepareConsultation({ ...input, status: '' }), {
    ok: false,
    field: 'status',
    error: '상담상태를 선택해 주세요.',
  });
});

void test('confirmed consultation preserves Korean midnight and year rollover for the stored schedule and calendar draft', () => {
  const result = prepareConsultation(input);
  assert.ok(result.ok);
  assert.deepEqual(result.schedule, { isoDate: '2026-12-31', endIsoDate: '2027-01-01', date: '12.31', weekday: '목', time: '23:30', end: '00:30' });
  assert.ok(result.schedule);
  const url = new URL(googleCalendarDraftUrl({ ...result.schedule, company: '가상기업', service: result.payload.title, method: input.method })!);
  assert.equal(url.searchParams.get('dates'), '20261231T233000/20270101T003000');
  assert.equal(url.searchParams.get('ctz'), 'Asia/Seoul');
  assert.equal(result.payload.title, '가상 상담');
});

void test('cancelled and pending consultations never create a schedule or follow-up tasks', () => {
  for (const status of ['취소', '일정 요청', '고객 회신 대기']) {
    const result = prepareConsultation({ ...input, status });
    assert.ok(result.ok);
    assert.equal(result.schedule, null);
    assert.deepEqual(result.payload.followUps, []);
    assert.ok(result.detail.includes(status));
    assert.ok(result.detail.includes('2026-12-31 23:30 (한국시간)'));
    assert.ok(!result.detail.includes('일정 등록'));
  }
  const confirmed = prepareConsultation(input);
  assert.ok(confirmed.ok);
  assert.deepEqual(confirmed.payload.followUps, []);
});

void test('only completed consultations retain unique selected follow-ups without mutating the input', () => {
  const original = { ...input, status: '상담 완료', followUps: ['서류요청', '서류요청', '견적서 작성'] };
  const before = structuredClone(original);
  const result = prepareConsultation(original);
  assert.ok(result.ok);
  assert.equal(result.schedule, null);
  assert.deepEqual(result.payload.followUps, ['서류요청', '견적서 작성']);
  assert.ok(result.detail.includes('서류요청 · 견적서 작성'));
  assert.deepEqual(original, before);
});

void test('completed consultation rejects an unknown follow-up instead of creating fallback work', () => {
  assert.deepEqual(
    prepareConsultation({ ...input, status: '상담 완료', followUps: ['임의 후속업무'] }),
    {
      ok: false,
      field: 'followUps',
      error: '상담 후속조치를 목록에서 선택해 주세요.',
    },
  );
});

void test('opting out of a hub schedule still preserves basic consultation details without a sharing claim', () => {
  const result = prepareConsultation({ ...input, addToSchedule: false });
  assert.ok(result.ok);
  assert.equal(result.schedule, null);
  for (const text of ['가상 상담', '2026-12-31 23:30 (한국시간)', '화상', '일정 확정']) assert.ok(result.detail.includes(text));
  assert.ok(!result.detail.includes('공개'));
});
