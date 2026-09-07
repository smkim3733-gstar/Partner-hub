import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  FileInventoryResponseError,
  readFileInventoryPageResponse,
  readFileInventoryPresenceResponse,
} from '../lib/file-inventory-response';
import {
  inventoryIntegrityProofs,
  inventoryPendingAge,
  inventoryPendingAgeLabels,
} from '../lib/file-inventory';

const item = {
  id: 'inventory-file-1',
  source: 'company',
  idCollision: false,
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
  integrityProof: 'sha256',
  status: 'unlinked',
};
const page = {
  items: [item],
  nextCursor: 'safe_cursor-1',
  checkedAt: '2026-09-04T01:00:00.000Z',
  integrityCoverage: { sha256: 1, etag: 2, metadata: 3, unavailable: 4 },
};
const presence = {
  id: item.id,
  exists: true,
  sizeBytes: 4,
  expectedSizeBytes: 4,
  sizeMatches: true,
  integrityMode: 'etag',
  integrityProof: 'sha256',
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

void test('inventory page rejects wrong filters, duplicate source identities and malformed pagination', async () => {
  for (const changed of [
    { ...page, items: [{ ...item, status: 'linked' }] },
    { ...page, items: [item, item] },
    { ...page, nextCursor: '../private' },
    { ...page, items: [{ ...item, sizeBytes: -1 }] },
    { ...page, items: [{ ...item, source: 'private-ledger' }] },
    { ...page, items: [{ ...item, idCollision: null }] },
    {
      ...page,
      items: [item, { ...item, source: 'flow', idCollision: false }],
    },
    { ...page, items: [{ ...item, integrityProof: 'private-proof' }] },
    { ...page, items: [{ ...item, id: 'x'.repeat(201) }] },
    { ...page, items: [{ ...item, createdAt: 'not-a-date' }] },
    { ...page, integrityCoverage: { ...page.integrityCoverage, sha256: -1 } },
    { ...page, integrityCoverage: { ...page.integrityCoverage, etag: 1.5 } },
    { ...page, integrityCoverage: null },
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

  const maximumFlowIdPage = {
    ...page,
    items: [{ ...item, id: 'x'.repeat(200), source: 'flow' }],
  };
  assert.deepEqual(
    await readFileInventoryPageResponse(
      Response.json(maximumFlowIdPage),
      'unlinked',
    ),
    maximumFlowIdPage,
  );

  const crossSourceCollisionPage = {
    ...page,
    items: [
      { ...item, status: 'inconsistent', idCollision: true },
      {
        ...item,
        source: 'flow',
        status: 'inconsistent',
        idCollision: true,
      },
    ],
  };
  assert.deepEqual(
    await readFileInventoryPageResponse(
      Response.json(crossSourceCollisionPage),
      'inconsistent',
    ),
    crossSourceCollisionPage,
  );
});

void test('pending age uses fixed non-overlapping operational buckets', () => {
  const checkedAt = '2026-09-06T12:00:00.000Z';
  assert.equal(
    inventoryPendingAge('2026-09-06T08:00:00.001Z', checkedAt),
    'under4Hours',
  );
  assert.equal(
    inventoryPendingAge('2026-09-06T08:00:00.000Z', checkedAt),
    'fourTo24Hours',
  );
  assert.equal(
    inventoryPendingAge('2026-09-05T12:00:00.000Z', checkedAt),
    'oneTo3Days',
  );
  assert.equal(
    inventoryPendingAge('2026-09-03T12:00:00.000Z', checkedAt),
    'threeDaysOrMore',
  );
  assert.equal(
    inventoryPendingAge('2026-09-06T12:00:00.001Z', checkedAt),
    null,
  );
  assert.deepEqual(Object.values(inventoryPendingAgeLabels), [
    '4시간 미만',
    '4~24시간',
    '1~3일',
    '3일 이상',
  ]);
});

void test('inventory UI distinguishes D1 proof ledgers from current R2 metadata checks', async () => {
  assert.deepEqual(inventoryIntegrityProofs, {
    sha256: 'D1 저장 시 SHA-256 · ETag · MIME 원장',
    etag: 'D1 레거시 ETag · MIME 원장',
    metadata: 'D1 레거시 크기 · MIME 원장',
  });
  const source = await readFile(
    join(process.cwd(), 'components/admin-file-inventory.tsx'),
    'utf8',
  );
  for (const phrase of [
    'D1 저장 증명 원장 적용 현황',
    '현재 R2 원본 확인',
    '현재 R2 객체를 검사한 결과가 아닙니다.',
    '현재 R2 객체 정보가 D1 SHA-256·ETag·MIME 원장과 일치 · 본문 미읽음',
    'ID 충돌 · R2 확인 중지',
    '자동 복구를 중지했습니다.',
  ])
    assert.match(source, new RegExp(phrase));
  assert.doesNotMatch(source, /저장 원장 전체 무결성 증명|원본 무결성 확인/);
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
    { ...presence, integrityProof: 'invalid' },
    { ...presence, integrityMode: 'metadata', integrityProof: 'sha256' },
    { ...presence, integrityProof: 'metadata' },
    { ...presence, integrityMatches: null },
    {
      ...presence,
      integrityMode: null,
      integrityProof: null,
      integrityMatches: true,
    },
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
        integrityMode: null,
        integrityProof: null,
        integrityMatches: null,
      }),
      item.id,
    ),
    {
      ...presence,
      exists: false,
      sizeBytes: null,
      sizeMatches: null,
      integrityMode: null,
      integrityProof: null,
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
        integrityProof: null,
        integrityMatches: null,
      }),
      item.id,
    ),
    {
      ...presence,
      expectedSizeBytes: null,
      sizeMatches: null,
      integrityMode: null,
      integrityProof: null,
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
