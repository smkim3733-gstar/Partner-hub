import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PORTAL_TASK_COMPANY_MAX_LENGTH,
  PORTAL_TASK_DUE_MAX_LENGTH,
  PORTAL_TASK_TITLE_MAX_LENGTH,
  preparePortalTaskDraft,
} from '../lib/portal-task-draft';
import { SUPPORT_REQUEST_COMPANY } from '../lib/support-request-metrics';

void test('task draft trims required operational input without inventing values', () => {
  assert.deepEqual(preparePortalTaskDraft({
    title: '  추가서류 확인  ',
    company: '  세림테크  ',
    due: '  9월 5일 16:00  ',
    kind: '서류요청',
  }), {
    ok: true,
    value: {
      title: '추가서류 확인',
      company: '세림테크',
      due: '9월 5일 16:00',
    },
  });
});

void test('support request uses its fixed non-company scope', () => {
  assert.deepEqual(preparePortalTaskDraft({
    title: '로그인 지원',
    company: '',
    due: '오늘',
    kind: '지원요청',
  }), {
    ok: true,
    value: {
      title: '로그인 지원',
      company: SUPPORT_REQUEST_COMPANY,
      due: '오늘',
    },
  });
});

void test('task draft refuses each blank field instead of storing sample or fallback text', () => {
  assert.deepEqual(preparePortalTaskDraft({ title: ' ', company: '회사', due: '오늘', kind: '내부업무' }), {
    ok: false,
    error: '업무명을 입력해 주세요.',
  });
  assert.deepEqual(preparePortalTaskDraft({ title: '업무', company: ' ', due: '오늘', kind: '내부업무' }), {
    ok: false,
    error: '기업명을 입력해 주세요.',
  });
  assert.deepEqual(preparePortalTaskDraft({ title: '업무', company: '회사', due: ' ', kind: '내부업무' }), {
    ok: false,
    error: '마감일을 입력해 주세요.',
  });
});

void test('task draft bounds every user-written display field', () => {
  const base = { title: '업무', company: '회사', due: '오늘', kind: '내부업무' };
  assert.equal(preparePortalTaskDraft({ ...base, title: '가'.repeat(PORTAL_TASK_TITLE_MAX_LENGTH + 1) }).ok, false);
  assert.equal(preparePortalTaskDraft({ ...base, company: '가'.repeat(PORTAL_TASK_COMPANY_MAX_LENGTH + 1) }).ok, false);
  assert.equal(preparePortalTaskDraft({ ...base, due: '가'.repeat(PORTAL_TASK_DUE_MAX_LENGTH + 1) }).ok, false);
});
