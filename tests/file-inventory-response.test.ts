import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FileInventoryResponseError,
  readFileInventoryPageResponse,
  readFileInventoryPresenceResponse,
} from '../lib/file-inventory-response';

const item = {
  id: 'inventory-file-1',
  fileName: '가상자료.txt',
  company: '가상기업',
  title: '가상 자료',
  category: '기타자료',
  sizeBytes: 4,
  createdAt: '2026-09-04T00:00:00.000Z',
  assignedTrainee: '가상 담당자',
  partnerMemberId: 'member-1',
  uploader: '가상 담당자 · member@example.invalid',
  caseId: null,
  documentLinked: false,
  flowLinked: false,
  status: 'unlinked',
};
const page = {
  items: [item],
  nextCursor: 'safe_cursor-1',
  checkedAt: '2026-09-04T01:00:00.000Z',
};
const presence = {
  id: item.id,
  exists: true,
  sizeBytes: 4,
  expectedSizeBytes: 4,
  sizeMatches: true,
  integrityMode: 'etag',
  integrityMatches: true,
  checkedAt: page.checkedAt,
};

void test('inventory page returns only validated fields', async () => {
  const result = await readFileInventoryPageResponse(
    Response.json({
      ...page,
      privateStorageKey: 'must-not-escape',
      items: [{ ...item, privateStorageKey: 'must-not-escape' }],
    }),
    'unlinked',
  );
  assert.deepEqual(result, page);
  assert.equal(Object.hasOwn(result, 'privateStorageKey'), false);
  assert.equal(Object.hasOwn(result.items[0]!, 'privateStorageKey'), false);
});

void test('inventory page rejects wrong filters, duplicate IDs and malformed pagination', async () => {
  for (const changed of [
    { ...page, items: [{ ...item, status: 'linked' }] },
    { ...page, items: [item, item] },
    { ...page, nextCursor: '../private' },
    { ...page, items: [{ ...item, sizeBytes: -1 }] },
    { ...page, items: [{ ...item, createdAt: 'not-a-date' }] },
    {
      ...page,
      items: Array.from({ length: 26 }, (_, index) => ({
        ...item,
        id: `file-${index}`,
      })),
    },
  ])
    await assert.rejects(
      readFileInventoryPageResponse(Response.json(changed), 'unlinked'),
      /응답 형식이 올바르지 않습니다/,
    );
});

void test('presence response must match requested ID and size relationships', async () => {
  assert.deepEqual(
    await readFileInventoryPresenceResponse(
      Response.json({ ...presence, privateStorageKey: 'must-not-escape' }),
      item.id,
    ),
    presence,
  );
  for (const changed of [
    { ...presence, id: 'different-file' },
    { ...presence, exists: false },
    { ...presence, sizeBytes: -1 },
    { ...presence, expectedSizeBytes: null, sizeMatches: true },
    { ...presence, integrityMode: 'invalid' },
    { ...presence, integrityMatches: null },
    { ...presence, integrityMode: null, integrityMatches: true },
    { ...presence, checkedAt: 'not-a-date' },
  ])
    await assert.rejects(
      readFileInventoryPresenceResponse(Response.json(changed), item.id),
      /응답 형식이 올바르지 않습니다/,
    );

  assert.deepEqual(
    await readFileInventoryPresenceResponse(
      Response.json({
        ...presence,
        exists: false,
        sizeBytes: null,
        sizeMatches: null,
        integrityMatches: null,
      }),
      item.id,
    ),
    {
      ...presence,
      exists: false,
      sizeBytes: null,
      sizeMatches: null,
      integrityMatches: null,
    },
  );

  assert.deepEqual(
    await readFileInventoryPresenceResponse(
      Response.json({
        ...presence,
        expectedSizeBytes: null,
        sizeMatches: null,
        integrityMode: null,
        integrityMatches: null,
      }),
      item.id,
    ),
    {
      ...presence,
      expectedSizeBytes: null,
      sizeMatches: null,
      integrityMode: null,
      integrityMatches: null,
    },
  );
});

void test('inventory failures preserve safe messages and HTTP status', async () => {
  await assert.rejects(
    readFileInventoryPageResponse(
      Response.json(
        { error: '대표 관리자만 확인할 수 있습니다.' },
        { status: 403 },
      ),
      'all',
    ),
    (error: unknown) =>
      error instanceof FileInventoryResponseError &&
      error.status === 403 &&
      error.message === '대표 관리자만 확인할 수 있습니다.',
  );
  await assert.rejects(
    readFileInventoryPresenceResponse(
      new Response('<html>gateway failure</html>', { status: 502 }),
      item.id,
    ),
    (error: unknown) =>
      error instanceof FileInventoryResponseError &&
      error.status === 502 &&
      /응답을 읽지 못했습니다/.test(error.message),
  );
});
