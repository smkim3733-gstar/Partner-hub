import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FirstReportPreflight } from '../components/report-preflight';
import { currentPreflight } from '../lib/report-preflight';
import { inspectFirstReport } from '../lib/consulting-report-preflight';
import { newConsultingFlow, type FlowFile } from '../lib/consulting-flow';
import { flowBucket, flowEnvironment } from '../lib/consulting-flow-store';

const summary =
  '가상 자료의 진단용 요약입니다. 현재 상황과 목표는 증빙 확인 전의 내부 검토 내용이며 사실 확정이 아닙니다.';
void test('preflight is read-only, excludes archived originals and never exposes content or credentials', async () => {
  const flow = newConsultingFlow(
    'preflight-unit',
    '가상기업',
    'partner',
    '가상파트너',
  );
  flow.ai.sourceText = summary;
  flow.ai.enabled = true;
  flow.files.push({
    id: 'excluded',
    key: 'nonexistent-original',
    name: 'excluded-source.docx',
    contentType: 'application/docx',
    size: 25_000_000,
    purpose: 'source_archived',
    createdAt: '2026-08-30',
  });
  const runtime = flowEnvironment();
  const key = runtime.ANTHROPIC_API_KEY;
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('External network forbidden in preflight');
  };
  runtime.ANTHROPIC_API_KEY = 'synthetic-preflight-secret';
  try {
    const original = structuredClone(flow);
    const result = await inspectFirstReport(flow);
    assert.equal(result.canGenerate, true);
    assert.equal(result.fileCount, 0);
    assert.equal(result.excludedCount, 1);
    assert.equal(result.sourceTextChars, summary.length);
    assert.equal(calls, 0);
    assert.deepEqual(flow, original);
    const json = JSON.stringify(result);
    for (const privateValue of [
      summary,
      'synthetic-preflight-secret',
      'nonexistent-original',
    ])
      assert.ok(!json.includes(privateValue));
    assert.ok(result.notices.some((note) => note.includes('PDF·이미지')));
    assert.ok(
      result.checks
        .find((check) => check.id === 'key')
        ?.detail.includes('확인되지 않았습니다'),
    );
    assert.equal(currentPreflight(result, flow.caseId, flow.revision), true);
    assert.equal(currentPreflight(result, 'other-case', flow.revision), false);
    assert.equal(
      currentPreflight(result, flow.caseId, flow.revision + 1),
      false,
    );
    assert.equal(currentPreflight(null, flow.caseId, flow.revision), false);
    flow.ai.enabled = false;
    assert.equal((await inspectFirstReport(flow)).canGenerate, false);
    flow.ai.enabled = true;
    runtime.ANTHROPIC_API_KEY = undefined;
    assert.equal(
      (await inspectFirstReport(flow)).checks.find(
        (check) => check.id === 'key',
      )?.passed,
      false,
    );
    runtime.ANTHROPIC_API_KEY = 'synthetic-preflight-secret';
    flow.jobs.push({
      id: 'pending',
      stage: 1,
      status: 'queued',
      reason: '',
      createdAt: new Date().toISOString(),
    });
    assert.equal(
      (await inspectFirstReport(flow)).checks.find(
        (check) => check.id === 'phase',
      )?.passed,
      false,
    );
  } finally {
    runtime.ANTHROPIC_API_KEY = key;
    globalThis.fetch = oldFetch;
  }
});

void test('preflight blocks missing, unsupported, excessive, corrupt, empty and unmasked source text', async () => {
  const flow = newConsultingFlow(
    'preflight-invalid',
    '가상기업',
    'partner',
    '가상파트너',
  );
  const file: FlowFile = {
    id: 'source',
    key: 'preflight/source',
    name: 'reviewed.txt',
    contentType: 'text/plain',
    size: 123,
    purpose: 'source',
    createdAt: '2026-08-30',
  };
  assert.equal(
    (await inspectFirstReport(flow)).checks.find(
      (check) => check.id === 'composition',
    )?.passed,
    false,
  );
  flow.files = [file];
  assert.ok(
    (await inspectFirstReport(flow)).checks
      .find((check) => check.id === 'sources')
      ?.detail.includes('찾지 못했습니다'),
  );
  async function textSource(value: string | Uint8Array) {
    const bytes =
      typeof value === 'string' ? new TextEncoder().encode(value) : value;
    file.size = bytes.byteLength;
    await flowBucket().put(file.key, bytes);
    return inspectFirstReport(flow);
  }
  assert.equal(
    (await textSource(summary)).checks.find((check) => check.id === 'sources')
      ?.passed,
    true,
  );
  assert.equal(
    (
      await textSource(
        '아직 미확정인 상담 내용이며 대표 전화번호 010-1234-5678이 포함되어 있습니다.',
      )
    ).checks.find((check) => check.id === 'sources')?.passed,
    false,
  );
  assert.equal(
    (await textSource('short')).checks.find((check) => check.id === 'sources')
      ?.passed,
    false,
  );
  assert.equal(
    (await textSource('가'.repeat(80001))).checks.find(
      (check) => check.id === 'sources',
    )?.passed,
    false,
  );
  assert.equal(
    (await textSource(new Uint8Array([255, 254, 100, 0]))).checks.find(
      (check) => check.id === 'sources',
    )?.passed,
    false,
  );
  await textSource(summary);
  file.size++;
  assert.ok(
    (await inspectFirstReport(flow)).checks
      .find((check) => check.id === 'sources')
      ?.detail.includes('크기가 일치하지'),
  );
  file.contentType = 'audio/mp4';
  file.name = 'recording.m4a';
  assert.equal(
    (await inspectFirstReport(flow)).checks.find(
      (check) => check.id === 'sources',
    )?.passed,
    false,
  );
  flow.files = Array.from({ length: 9 }, (_, i) => ({
    ...file,
    id: `source-${i}`,
  }));
  assert.equal(
    (await inspectFirstReport(flow)).checks.find(
      (check) => check.id === 'composition',
    )?.passed,
    false,
  );
  flow.files = [{ ...file, size: 8 * 1024 * 1024 + 1 }];
  assert.equal(
    (await inspectFirstReport(flow)).checks.find(
      (check) => check.id === 'composition',
    )?.passed,
    false,
  );
});

void test('initial preflight UI keeps paid generation disabled and names the separate check action', () => {
  const html = renderToStaticMarkup(
    createElement(FirstReportPreflight, {
      caseId: 'test-ui',
      revision: 0,
      busy: false,
      generate: async () => true,
      refresh: () => {},
      openReports: () => {},
    }),
  );
  assert.ok(html.includes('생성 전 자료 점검 (AI 미전송)'));
  assert.ok(html.includes('확인한 자료로 1차 보고서 생성 (유료)'));
  assert.ok(
    html.includes(
      '점검 통과와 최종 확인 전에는 생성 버튼이 활성화되지 않습니다.',
    ),
  );
  assert.match(html, /<input[^>]*type="checkbox"[^>]*disabled/);
});
