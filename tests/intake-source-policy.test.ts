import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntakeSourceReview } from '../components/intake-source-review';
import {
  intakeSourceProblem,
  intakeSourceKind,
  MAX_AI_SOURCE_BYTES,
  MAX_AI_SOURCE_FILES,
  MAX_AI_SOURCE_MEGABYTES,
} from '../lib/intake-source-policy';
import {
  MAX_AUDIO_MEGABYTES,
  MAX_TRANSCRIPT_FILE_MEGABYTES,
} from '../lib/transcript-policy';
import {
  applyFlowCommand,
  newConsultingFlow,
  type FlowFile,
} from '../lib/consulting-flow';

void test('intake review distinguishes readable text, binary sources and auxiliary audio', () => {
  assert.equal(MAX_AI_SOURCE_MEGABYTES, 8);
  assert.equal(MAX_AI_SOURCE_FILES, 8);
  assert.equal(MAX_TRANSCRIPT_FILE_MEGABYTES, 5);
  assert.equal(MAX_AUDIO_MEGABYTES, 25);
  assert.equal(intakeSourceKind('call.DOCX'), 'text');
  assert.equal(intakeSourceKind('certificate.PDF'), 'binary');
  assert.match(
    intakeSourceProblem({ name: 'call.m4a', size: 100 }),
    /자동 전사하지/,
  );
  assert.match(intakeSourceProblem({ name: 'call.xlsx', size: 100 }), /변환/);
  assert.match(
    intakeSourceProblem({ name: 'call.txt', size: 5 * 1024 * 1024 + 1 }),
    /5MB/,
  );
  assert.match(
    intakeSourceProblem({ name: 'source.pdf', size: MAX_AI_SOURCE_BYTES + 1 }),
    /8MB/,
  );
  assert.match(intakeSourceProblem({ name: 'call.docx', size: 0 }), /비어/);
});

void test('source import enforces verified context, capacity, locked stages and never fabricates a consultation', () => {
  const flow = newConsultingFlow(
    'test-import',
    '가상기업',
    'partner',
    '가상파트너',
  );
  const actor = { id: 'admin', role: 'admin' as const, name: '대표' };
  const now = '2026-08-30T10:00:00.000Z';
  const upload: FlowFile = {
    id: 'copy',
    key: 'private/copy',
    name: 'reviewed.txt',
    size: 100,
    contentType: 'text/plain',
    createdAt: now,
    purpose: 'source',
    intakeFileId: 'original',
  };
  const cmd = {
    type: 'import_intake_source',
    intakeFileId: 'original',
    fileConsent: true,
    contentReviewed: true,
    privacyMasked: true,
    recordingConsent: true,
  };
  const context = {
    commandId: 'test-source-command',
    now,
    upload,
    intakeCategory: '상담녹취',
  };
  assert.throws(
    () =>
      applyFlowCommand(flow, cmd, actor, { commandId: context.commandId, now }),
    /서버에서/,
  );
  assert.throws(
    () => applyFlowCommand(flow, cmd, { ...actor, role: 'partner' }, context),
    /대표/,
  );
  const full = structuredClone(flow);
  full.files = Array.from({ length: 8 }, (_, i) => ({
    ...upload,
    id: `other-${i}`,
    intakeFileId: `other-${i}`,
  }));
  assert.throws(() => applyFlowCommand(full, cmd, actor, context), /8개/);
  const huge = structuredClone(flow);
  huge.files = [
    { ...upload, id: 'huge', intakeFileId: 'huge', size: MAX_AI_SOURCE_BYTES },
  ];
  assert.throws(() => applyFlowCommand(huge, cmd, actor, context), /8MB/);
  const completed = structuredClone(flow);
  completed.meetings.push({
    id: 'first',
    kind: 'first',
    status: 'completed',
    completedAt: now,
    startsAt: now,
    endsAt: now,
    location: '가상',
    attendance: 'both',
    note: '',
    createdBy: 'admin',
  });
  assert.throws(
    () => applyFlowCommand(completed, cmd, actor, context),
    /초회상담/,
  );
  const after = applyFlowCommand(flow, cmd, actor, context);
  assert.equal(after.files.length, 1);
  assert.equal(
    after.reports.length +
      after.jobs.length +
      after.recordings.length +
      after.meetings.length,
    0,
  );
  assert.equal(flow.files.length, 0);
});

void test('intake review UI explains the no-AI boundary and escapes company labels', () => {
  const flow = newConsultingFlow(
    'ui-source',
    '<script>test</script>',
    'partner',
    '가상파트너',
  );
  const html = renderToStaticMarkup(
    createElement(IntakeSourceReview, {
      flow,
      busy: false,
      submit: async () => true,
    }),
  );
  assert.ok(html.includes('신청자료 불러오기 · 1차 진단 준비'));
  assert.ok(html.includes('상담 완료나 보고서 생성을 처리하지 않습니다'));
  assert.ok(html.includes('&lt;script&gt;test&lt;/script&gt;'));
  assert.ok(!html.includes('<script>test</script>'));
});
