import assert from 'node:assert/strict';
import test from 'node:test';
import { operationalRecordStateError } from '../lib/operational-record-integrity';

const task = {
  id: 'task-one',
  company: '세림테크',
  title: '서류 제출 확인',
  kind: '서류요청',
  assignee: '박지현',
  due: '오늘 16:00',
  dueState: 'today',
  status: '진행',
  priority: '긴급',
  related: '서류요청 #1',
};

const document = {
  id: 'document-one',
  company: '세림테크',
  title: '사업자등록증',
  category: '사업자등록증',
  status: '제출완료',
  assignedTrainee: '박지현',
  submittedBy: '박지현',
  updatedAt: '방금 전',
  version: 'V1',
  sensitive: true,
};

const schedule = {
  id: 'schedule-one',
  date: '09.05',
  weekday: '토',
  time: '10:00',
  end: '11:00',
  company: '세림테크',
  service: '정책자금 상담',
  method: '화상',
  status: '확정',
  tone: 'green',
  source: 'partner',
  shareMode: 'all_with_assignee',
};

function error(
  tasks: unknown = [task],
  documents: unknown = [document],
  scheduleItems: unknown = [schedule],
) {
  return operationalRecordStateError(tasks, documents, scheduleItems);
}

void test('accepts complete task, company document, and schedule display contracts', () => {
  assert.equal(error(), null);
  assert.equal(
    error(
      [{ ...task, kind: '지원요청', supportCategory: 'account_access' }],
      [{ ...document, status: '요청중', version: '-' }],
      [{ ...schedule, status: '예약됨', source: 'google', shareMode: 'all_busy', private: true }],
    ),
    null,
  );
});

void test('rejects missing or untrimmed task display fields', () => {
  for (const field of ['company', 'title', 'assignee', 'due', 'related']) {
    assert.match(
      error([{ ...task, [field]: field === 'title' ? '  ' : ` ${task[field as keyof typeof task]}` }]) ?? '',
      /업무 .*필드/,
    );
  }
});

void test('rejects unsupported task classifications and status values', () => {
  for (const [field, value] of [
    ['kind', '임의업무'],
    ['dueState', 'later'],
    ['status', '보류'],
    ['priority', '높음'],
    ['supportCategory', 'unknown'],
  ] as const) {
    assert.match(error([{ ...task, [field]: value }]) ?? '', /업무 .*올바르지/);
  }
});

void test('rejects incomplete company document display fields and unsupported values', () => {
  for (const field of ['company', 'title', 'assignedTrainee', 'submittedBy', 'updatedAt', 'version']) {
    assert.match(error(undefined, [{ ...document, [field]: '' }]) ?? '', /기업자료 .*필드/);
  }
  assert.match(error(undefined, [{ ...document, category: '임의자료' }]) ?? '', /기업자료 종류/);
  assert.match(error(undefined, [{ ...document, status: '삭제됨' }]) ?? '', /기업자료 상태/);
  assert.match(error(undefined, [{ ...document, sensitive: 'true' }]) ?? '', /민감자료/);
});

void test('rejects incomplete schedule display fields and unsupported sharing values', () => {
  for (const field of ['date', 'weekday', 'time', 'end', 'company', 'service', 'method', 'status', 'tone']) {
    assert.match(error(undefined, undefined, [{ ...schedule, [field]: ' ' }]) ?? '', /일정 .*필드/);
  }
  assert.match(error(undefined, undefined, [{ ...schedule, source: 'external' }]) ?? '', /일정 출처/);
  assert.match(error(undefined, undefined, [{ ...schedule, status: '취소됨' }]) ?? '', /일정 상태/);
  assert.match(error(undefined, undefined, [{ ...schedule, shareMode: 'everyone' }]) ?? '', /일정 공개범위/);
  assert.match(error(undefined, undefined, [{ ...schedule, private: 'yes' }]) ?? '', /일정 비공개/);
});

void test('leaves collection shape failures to the outer portal-state boundary', () => {
  assert.equal(operationalRecordStateError(null, [], []), null);
  assert.equal(operationalRecordStateError([null], [], []), null);
});
