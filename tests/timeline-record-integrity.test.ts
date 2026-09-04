import assert from 'node:assert/strict';
import test from 'node:test';
import { timelineRecordStateError } from '../lib/timeline-record-integrity';

const cases = [{ id: 'case-one' }, { id: 'case-two' }];
const event = {
  id: 'event-one',
  caseId: 'case-one',
  date: '방금 전',
  title: '상담 저장',
  detail: '가상 상담 기록',
  type: '상담',
  tone: 'green',
};

void test('accepts stable linked events and legacy events without IDs or case links', () => {
  assert.equal(
    timelineRecordStateError(
      [
        event,
        {
          date: '08.29 09:20',
          title: '기존 접수',
          detail: '기존 가상 기록',
          type: '접수',
          tone: 'navy',
        },
      ],
      cases,
    ),
    null,
  );
});

void test('rejects missing, padded and non-string display fields', () => {
  for (const [field, value] of [
    ['date', ' '],
    ['title', ' 제목'],
    ['detail', null],
    ['type', 1],
    ['tone', undefined],
  ] as const)
    assert.match(
      timelineRecordStateError([{ ...event, [field]: value }], cases) ?? '',
      /타임라인 필수 표시 필드가 올바르지 않습니다/,
    );
});

void test('rejects malformed, missing and ambiguous explicit case links', () => {
  for (const caseId of [null, ' ', 'missing-case'])
    assert.match(
      timelineRecordStateError([{ ...event, caseId }], cases) ?? '',
      /타임라인 진행 연결/,
    );
  assert.match(
    timelineRecordStateError([event], [...cases, { id: 'case-one' }]) ?? '',
    /타임라인 진행 연결을 하나로 확인할 수 없습니다/,
  );
});

void test('rejects malformed and globally duplicate optional stable IDs', () => {
  for (const id of [null, '', ' padded'])
    assert.match(
      timelineRecordStateError([{ ...event, id }], cases) ?? '',
      /타임라인 안정 ID가 없거나 중복되었습니다/,
    );
  assert.match(
    timelineRecordStateError(
      [event, { ...event, caseId: 'case-two' }],
      cases,
    ) ?? '',
    /타임라인 안정 ID가 없거나 중복되었습니다/,
  );
});
