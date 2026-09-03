import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IntakeSourceResponseError,
  readIntakeSourceListResponse,
  readIntakeSourcePreviewResponse,
} from '../lib/intake-source-response';

const file = {
  id: 'intake-file-1',
  name: '가상상담.txt',
  category: '상담녹취',
  size: 32,
  createdAt: '2026-09-04T00:00:00.000Z',
  kind: 'text' as const,
  blockedReason: '',
};
const list = { files: [file], hasMore: false };
const preview = {
  file,
  sourceHash: 'a'.repeat(64),
  text: '가상 상담 본문입니다. 외부 전송 없이 응답 경계만 검증합니다.',
};

void test('intake source list returns only validated public fields', async () => {
  const result = await readIntakeSourceListResponse(
    Response.json({
      ...list,
      storageKey: 'must-not-escape',
      files: [{ ...file, storageKey: 'must-not-escape' }],
    }),
  );
  assert.deepEqual(result, list);
  assert.equal(Object.hasOwn(result, 'storageKey'), false);
  assert.equal(Object.hasOwn(result.files[0]!, 'storageKey'), false);
});

void test('intake source list rejects duplicate and inconsistent metadata', async () => {
  for (const changed of [
    { ...list, files: [file, file] },
    { ...list, files: [{ ...file, kind: 'binary' }] },
    { ...list, files: [{ ...file, blockedReason: 'forged warning' }] },
    { ...list, files: [{ ...file, size: -1 }] },
    { ...list, files: [{ ...file, category: 'private' }] },
    {
      ...list,
      files: Array.from({ length: 101 }, (_, index) => ({
        ...file,
        id: `file-${index}`,
      })),
    },
  ])
    await assert.rejects(
      readIntakeSourceListResponse(Response.json(changed)),
      /응답 형식이 올바르지 않습니다/,
    );
});

void test('intake preview must match the selected file and source shape', async () => {
  const result = await readIntakeSourcePreviewResponse(
    Response.json({
      ...preview,
      storageKey: 'must-not-escape',
      file: { ...file, storageKey: 'must-not-escape' },
    }),
    file,
  );
  assert.deepEqual(result, preview);
  assert.equal(Object.hasOwn(result, 'storageKey'), false);
  assert.equal(Object.hasOwn(result.file, 'storageKey'), false);

  for (const changed of [
    { ...preview, file: { ...file, id: 'another-file' } },
    { ...preview, file: { ...file, name: 'renamed.txt' } },
    { ...preview, sourceHash: 'not-a-hash' },
    { ...preview, text: '가'.repeat(60_001) },
    { ...preview, file: { ...file, blockedReason: 'blocked' } },
  ])
    await assert.rejects(
      readIntakeSourcePreviewResponse(Response.json(changed), file),
      /응답 형식이 올바르지 않습니다/,
    );
});

void test('binary preview rejects invented text and accepts a matching file', async () => {
  const binary = {
    ...file,
    name: '가상증빙.pdf',
    category: '기타자료',
    kind: 'binary' as const,
  };
  const value = { file: binary, sourceHash: 'b'.repeat(64) };
  assert.deepEqual(
    await readIntakeSourcePreviewResponse(Response.json(value), binary),
    value,
  );
  await assert.rejects(
    readIntakeSourcePreviewResponse(
      Response.json({ ...value, text: 'invented text' }),
      binary,
    ),
    /응답 형식이 올바르지 않습니다/,
  );
});

void test('intake response failures retain safe messages and status', async () => {
  await assert.rejects(
    readIntakeSourceListResponse(
      Response.json(
        { error: '신청자료의 검토는 대표만 할 수 있습니다.' },
        { status: 403 },
      ),
    ),
    (error: unknown) =>
      error instanceof IntakeSourceResponseError &&
      error.status === 403 &&
      error.message === '신청자료의 검토는 대표만 할 수 있습니다.',
  );
  await assert.rejects(
    readIntakeSourcePreviewResponse(
      new Response('<html>gateway failure</html>', { status: 502 }),
      file,
    ),
    (error: unknown) =>
      error instanceof IntakeSourceResponseError &&
      error.status === 502 &&
      /응답을 읽지 못했습니다/.test(error.message),
  );
});
