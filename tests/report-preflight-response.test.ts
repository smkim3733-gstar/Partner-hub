import assert from 'node:assert/strict';
import test from 'node:test';
import {
  reportPreflightCheckDefinitions,
  reportPreflightNotices,
} from '../lib/report-preflight';
import {
  ReportPreflightResponseError,
  readReportPreflightResponse,
} from '../lib/report-preflight-response';

const caseId = 'preflight-case-1';
const revision = 3;
const files = [
  {
    id: 'source-file-1',
    name: '가상근거.txt',
    size: 32,
    type: 'text/plain',
    imported: true,
  },
];
const checks = Object.entries(reportPreflightCheckDefinitions).map(
  ([id, definition]) => ({
    id,
    ...definition,
    passed: true,
    detail: `${definition.label} 가상 점검을 통과했습니다.`,
  }),
);
const preflight = {
  caseId,
  revision,
  checkedAt: '2026-09-04T00:00:00.000Z',
  canGenerate: true,
  sourceTextChars: 40,
  fileCount: 1,
  totalBytes: 32,
  excludedCount: 0,
  model: 'synthetic-model',
  hasExistingReport: false,
  files,
  checks,
  notices: [...reportPreflightNotices],
};

void test('preflight response returns only validated public fields', async () => {
  const result = await readReportPreflightResponse(
    Response.json({
      ...preflight,
      apiKey: 'must-not-escape',
      files: [{ ...files[0], key: 'must-not-escape' }],
    }),
    caseId,
    revision,
  );
  assert.deepEqual(result, preflight);
  assert.equal(Object.hasOwn(result, 'apiKey'), false);
  assert.equal(Object.hasOwn(result.files[0]!, 'key'), false);
});

void test('preflight response must match the current case and revision', async () => {
  for (const changed of [
    { ...preflight, caseId: 'another-case' },
    { ...preflight, revision: revision + 1 },
    { ...preflight, checkedAt: 'not-a-date' },
  ])
    await assert.rejects(
      readReportPreflightResponse(Response.json(changed), caseId, revision),
      /응답 형식이 올바르지 않습니다/,
    );
});

void test('preflight generation flag must agree with all checks and source totals', async () => {
  for (const changed of [
    { ...preflight, canGenerate: false },
    { ...preflight, fileCount: 2 },
    { ...preflight, totalBytes: 31 },
    { ...preflight, files: [files[0], files[0]] },
    {
      ...preflight,
      checks: checks.map((check) =>
        check.id === 'policy' ? { ...check, passed: false } : check,
      ),
    },
    {
      ...preflight,
      sourceTextChars: 0,
      fileCount: 0,
      totalBytes: 0,
      files: [],
    },
  ])
    await assert.rejects(
      readReportPreflightResponse(Response.json(changed), caseId, revision),
      /응답 형식이 올바르지 않습니다/,
    );
});

void test('preflight checks and mandatory notices cannot be replaced', async () => {
  for (const changed of [
    {
      ...preflight,
      checks: checks.map((check) =>
        check.id === 'phase' ? { ...check, target: 'sources' } : check,
      ),
    },
    { ...preflight, checks: checks.slice(0, -1) },
    { ...preflight, notices: reportPreflightNotices.slice(0, -1) },
    {
      ...preflight,
      notices: ['생성해도 안전합니다.', ...reportPreflightNotices.slice(1)],
    },
  ])
    await assert.rejects(
      readReportPreflightResponse(Response.json(changed), caseId, revision),
      /응답 형식이 올바르지 않습니다/,
    );
});

void test('preflight failures preserve bounded guidance and hide unreadable bodies', async () => {
  await assert.rejects(
    readReportPreflightResponse(
      Response.json(
        { error: '1차 AI 생성 사전점검은 대표만 할 수 있습니다.' },
        { status: 403 },
      ),
      caseId,
      revision,
    ),
    (error: unknown) =>
      error instanceof ReportPreflightResponseError &&
      error.status === 403 &&
      error.message === '1차 AI 생성 사전점검은 대표만 할 수 있습니다.',
  );
  await assert.rejects(
    readReportPreflightResponse(
      new Response('<html>private gateway failure</html>', { status: 502 }),
      caseId,
      revision,
    ),
    (error: unknown) =>
      error instanceof ReportPreflightResponseError &&
      error.status === 502 &&
      /응답을 읽지 못했습니다/.test(error.message) &&
      !error.message.includes('private'),
  );
});
