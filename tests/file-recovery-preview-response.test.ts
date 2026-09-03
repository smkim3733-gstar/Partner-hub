import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FileRecoveryPreviewResponseError,
  readFileRecoveryPreviewResponse,
} from '../lib/file-recovery-preview-response';

const preview = {
  fileId: 'recovery-file-1',
  fileName: '가상자료.pdf',
  company: '가상기업',
  category: '기타자료',
  title: '가상 자료',
  caseId: 'case-1',
  service: '정책자금',
  partnerMemberId: 'member-1',
  partnerName: '가상 담당자',
  partnerEmail: 'member@example.invalid',
  sizeBytes: 42,
  stateRevision: 'a'.repeat(64),
  fileRevision: 'b'.repeat(64),
};

void test('recovery preview returns only validated public fields', async () => {
  const result = await readFileRecoveryPreviewResponse(
    Response.json({ ...preview, storageKey: 'must-not-escape' }),
    preview.fileId,
  );
  assert.deepEqual(result, preview);
  assert.equal(Object.hasOwn(result, 'storageKey'), false);
});

void test('recovery preview must match the requested original and revisions', async () => {
  for (const changed of [
    { ...preview, fileId: 'another-file' },
    { ...preview, caseId: '../private' },
    { ...preview, partnerMemberId: '' },
    { ...preview, partnerEmail: 'not-an-email' },
    { ...preview, stateRevision: 'not-a-revision' },
    { ...preview, fileRevision: 'A'.repeat(64) },
  ])
    await assert.rejects(
      readFileRecoveryPreviewResponse(Response.json(changed), preview.fileId),
      /응답 형식이 올바르지 않습니다/,
    );
});

void test('recovery preview rejects invalid metadata and sizes', async () => {
  for (const changed of [
    { ...preview, fileName: '' },
    { ...preview, company: '가'.repeat(201) },
    { ...preview, category: 'private' },
    { ...preview, sizeBytes: 0 },
    { ...preview, sizeBytes: 25 * 1024 * 1024 + 1 },
  ])
    await assert.rejects(
      readFileRecoveryPreviewResponse(Response.json(changed), preview.fileId),
      /응답 형식이 올바르지 않습니다/,
    );
});

void test('recovery preview failures preserve bounded guidance and status', async () => {
  await assert.rejects(
    readFileRecoveryPreviewResponse(
      Response.json(
        { error: '원본과 신청의 연결을 확인해 주세요.' },
        { status: 409 },
      ),
      preview.fileId,
    ),
    (error: unknown) =>
      error instanceof FileRecoveryPreviewResponseError &&
      error.status === 409 &&
      error.message === '원본과 신청의 연결을 확인해 주세요.',
  );
  await assert.rejects(
    readFileRecoveryPreviewResponse(
      new Response('<html>private gateway failure</html>', { status: 502 }),
      preview.fileId,
    ),
    (error: unknown) =>
      error instanceof FileRecoveryPreviewResponseError &&
      error.status === 502 &&
      /응답을 읽지 못했습니다/.test(error.message) &&
      !error.message.includes('private'),
  );
});
