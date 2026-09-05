import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { env } from 'cloudflare:workers';
import { PUT as saveState } from '../app/api/state/route';
import {
  companyFileBucket,
  companyFileDatabase,
  ensureCompanyFileTables,
} from '../lib/company-files';
import { readPortalState, writePortalState } from '../lib/portal-state';
import { portalRevision } from '../lib/portal-revision';
import { objects } from './runtime-mock.mjs';

const ownerHeaders = {
  'oai-authenticated-user-id': 'provenance-owner',
  'oai-authenticated-user-email': 'seedy@sites.test',
};
const member = {
  id: 'provenance-member',
  name: '가상 담당자',
  email: 'provenance-member@example.invalid',
  role: '일반 파트너',
  status: '활성',
  cohort: '',
  companies: 1,
  permissions: {
    ownCases: true,
    fileUpload: true,
    collaborationApply: true,
    sharedSchedule: true,
    quoteContract: false,
  },
};
const peer = {
  ...member,
  id: 'provenance-peer',
  name: '가상 다른담당자',
  email: 'provenance-peer@example.invalid',
};
const caseId = 'provenance-case';

function emptyState() {
  return {
    version: 1,
    consultationNumber: 0,
    membersRevision: 1,
    members: [member, peer],
    cases: [
      {
        id: caseId,
        company: '가상기업',
        trainee: member.name,
        partnerMemberId: member.id,
      },
      {
        id: 'provenance-peer-case',
        company: '가상기업',
        trainee: peer.name,
        partnerMemberId: peer.id,
      },
    ],
    companyDocuments: [] as Array<ReturnType<typeof document>>,
    timeline: [],
    tasks: [],
    schedule: [],
  };
}

function document(fileId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `document-${fileId}`,
    company: '가상기업',
    title: '사업자등록증 원본',
    category: '사업자등록증',
    status: '제출완료',
    assignedTrainee: member.name,
    partnerMemberId: member.id,
    caseId,
    submittedBy: member.name,
    updatedAt: '방금 전',
    version: 'V1',
    sensitive: true,
    storageFileId: fileId,
    fileName: 'source.pdf',
    fileSize: 1_024,
    ...overrides,
  };
}

type SeedOptions = {
  fileId: string;
  status?: 'pending' | 'ready' | 'deleted' | null;
  objectSize?: number | null;
  originalName?: string;
  company?: string;
  title?: string;
  category?: string;
  partnerMemberId?: string | null;
  linkedCaseId?: string | null;
  assignedTrainee?: string;
  sizeBytes?: number;
};

async function seedFile({
  fileId,
  status = 'ready',
  objectSize = 1_024,
  originalName = 'source.pdf',
  company = '가상기업',
  title = '사업자등록증 원본',
  category = '사업자등록증',
  partnerMemberId = member.id,
  linkedCaseId = caseId,
  assignedTrainee = member.name,
  sizeBytes = 1_024,
}: SeedOptions) {
  const db = companyFileDatabase();
  await db
    .prepare(`INSERT INTO company_file_objects
      (id, storage_key, original_name, company, category, title,
       assigned_trainee, uploaded_by_user_id, uploaded_by_email,
       content_type, size_bytes, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
        'application/pdf', ?10, '2026-09-05T00:00:00Z')`)
    .bind(
      fileId,
      `company-source/${fileId}`,
      originalName,
      company,
      category,
      title,
      assignedTrainee,
      member.id,
      member.email,
      sizeBytes,
    )
    .run();
  await db
    .prepare(`INSERT INTO company_file_object_integrity
      (file_id, validation_mode, r2_etag, r2_content_type)
      VALUES (?1, 'metadata', NULL, 'application/pdf')`)
    .bind(fileId)
    .run();
  await db
    .prepare(`INSERT INTO company_file_storage_keys (file_id, storage_key)
      VALUES (?1, ?2)`)
    .bind(fileId, `company-source/${fileId}`)
    .run();
  if (partnerMemberId !== null)
    await db
      .prepare(
        'INSERT INTO company_file_assignments (file_id, partner_member_id) VALUES (?1, ?2)',
      )
      .bind(fileId, partnerMemberId)
      .run();
  if (linkedCaseId !== null)
    await db
      .prepare(
        'INSERT INTO company_file_case_links (file_id, case_id) VALUES (?1, ?2)',
      )
      .bind(fileId, linkedCaseId)
      .run();
  if (status !== null)
    await db
      .prepare(`INSERT INTO company_file_upload_requests
        (owner_key, request_key, fingerprint, file_id, created_at, status)
        VALUES (?1, ?2, ?3, ?4, '2026-09-05T00:00:00Z', ?5)`)
      .bind(
        `member:${member.id}`,
        `request-${fileId}`,
        `fingerprint-${fileId}`,
        fileId,
        status,
      )
      .run();
  if (objectSize !== null)
    await companyFileBucket().put(
      `company-source/${fileId}`,
      new Uint8Array(objectSize),
      { httpMetadata: { contentType: 'application/pdf' } },
    );
}

async function save(next: unknown) {
  const request = new Request('http://localhost/api/state', {
    method: 'PUT',
    headers: {
      origin: 'http://localhost',
      'content-type': 'application/json',
      'if-match': `"${await portalRevision(await readPortalState())}"`,
      ...ownerHeaders,
    },
    body: JSON.stringify({ state: next }),
  });
  return saveState(request);
}

beforeEach(async () => {
  const db = companyFileDatabase();
  await ensureCompanyFileTables(db);
  await db.batch(
    [
      'company_file_object_integrity',
      'company_file_storage_keys',
      'company_file_case_links',
      'company_file_assignments',
      'company_file_objects',
      'company_file_upload_requests',
    ].map((table) => db.prepare(`DELETE FROM ${table}`)),
  );
  objects.clear();
  await writePortalState(emptyState());
});

void test('new document originals must exist in the private file ledger', async () => {
  const next = emptyState();
  next.companyDocuments = [document('fabricated-file')];
  const response = await save(next);
  assert.equal(response.status, 409, await response.clone().text());
  assert.deepEqual(await readPortalState(), emptyState());
});

void test('new document originals must match every authoritative D1 fact', async () => {
  const mismatches: Array<SeedOptions> = [
    { fileId: 'mismatch-name', originalName: 'ledger.pdf' },
    { fileId: 'mismatch-size', sizeBytes: 2_048, objectSize: 2_048 },
    { fileId: 'mismatch-company', company: '다른기업' },
    { fileId: 'mismatch-category', category: '기타자료' },
    { fileId: 'mismatch-member', partnerMemberId: peer.id },
    { fileId: 'mismatch-case', linkedCaseId: 'provenance-peer-case' },
  ];
  for (const seed of mismatches) {
    await seedFile(seed);
    const next = emptyState();
    next.companyDocuments = [
      document(seed.fileId, { title: '포털 표시 제목은 별도 관리' }),
    ];
    const response = await save(next);
    assert.equal(
      response.status,
      409,
      `${seed.fileId}: ${await response.clone().text()}`,
    );
    assert.deepEqual(await readPortalState(), emptyState());
  }
});

void test('pending, deleted, missing and size-mismatched private originals cannot be linked', async () => {
  const invalidFiles: SeedOptions[] = [
    { fileId: 'pending-file', status: 'pending' },
    { fileId: 'deleted-file', status: 'deleted' },
    { fileId: 'missing-object', objectSize: null },
    { fileId: 'wrong-object-size', objectSize: 512 },
  ];
  for (const seed of invalidFiles) {
    await seedFile(seed);
    const next = emptyState();
    next.companyDocuments = [
      document(seed.fileId, { title: '포털 표시 제목은 별도 관리' }),
    ];
    const response = await save(next);
    assert.equal(
      response.status,
      409,
      `${seed.fileId}: ${await response.clone().text()}`,
    );
    assert.deepEqual(await readPortalState(), emptyState());
  }
});

void test('ready and legacy ledger originals with intact R2 bytes can be linked', async () => {
  for (const seed of [
    { fileId: 'ready-file', status: 'ready' as const },
    { fileId: 'legacy-file', status: null },
  ]) {
    await seedFile(seed);
    const next = emptyState();
    next.companyDocuments = [
      document(seed.fileId, { title: '포털 표시 제목은 별도 관리' }),
    ];
    const response = await save(next);
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(
      ((await readPortalState()) as ReturnType<typeof emptyState>)
        .companyDocuments,
      [document(seed.fileId, { title: '포털 표시 제목은 별도 관리' })],
    );
    await writePortalState(emptyState());
  }
});

void test('a missing object-integrity ledger row fails a new document link closed', async () => {
  await seedFile({ fileId: 'missing-integrity-file' });
  await companyFileDatabase()
    .prepare('DELETE FROM company_file_object_integrity WHERE file_id = ?1')
    .bind('missing-integrity-file')
    .run();
  const next = emptyState();
  next.companyDocuments = [document('missing-integrity-file')];
  const response = await save(next);
  assert.equal(response.status, 503, await response.clone().text());
  assert.deepEqual(await readPortalState(), emptyState());
});

void test('a same-size R2 replacement cannot become a new document original', async () => {
  const fileId = 'replaced-original-file';
  await seedFile({ fileId });
  const bucket = companyFileBucket(),
    key = `company-source/${fileId}`,
    original = await bucket.head(key);
  assert.ok(original);
  await companyFileDatabase()
    .prepare(`UPDATE company_file_object_integrity
      SET validation_mode = 'etag', r2_etag = ?1 WHERE file_id = ?2`)
    .bind(original.etag, fileId)
    .run();
  const replacement = new Uint8Array(1_024);
  replacement[0] = 1;
  await bucket.put(key, replacement, {
    httpMetadata: { contentType: 'application/pdf' },
  });
  const next = emptyState();
  next.companyDocuments = [document(fileId)];
  const response = await save(next);
  assert.equal(response.status, 409, await response.clone().text());
  assert.deepEqual(await readPortalState(), emptyState());
});

void test('existing original links remain reviewable without retroactive ledger migration', async () => {
  const existing = emptyState();
  existing.companyDocuments = [document('legacy-existing')];
  await writePortalState(existing);
  const review = structuredClone(existing);
  review.companyDocuments[0].status = '검토완료';
  review.companyDocuments[0].updatedAt = '검토 방금 전';
  const response = await save(review);
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await readPortalState(), review);
});

void test('D1 deletion between R2 validation and state commit cannot create a stale link', async () => {
  const fileId = 'racing-delete-file';
  await seedFile({ fileId });
  const bucket = (env as unknown as { AI_SOURCE_FILES: R2Bucket })
    .AI_SOURCE_FILES;
  const originalHead = bucket.head.bind(bucket);
  bucket.head = async (key: string) => {
    const result = await originalHead(key);
    await companyFileDatabase()
      .prepare(
        "UPDATE company_file_upload_requests SET status = 'deleted' WHERE file_id = ?1",
      )
      .bind(fileId)
      .run();
    return result;
  };
  try {
    const next = emptyState();
    next.companyDocuments = [document(fileId)];
    const response = await save(next);
    assert.equal(response.status, 409, await response.clone().text());
    assert.deepEqual(await readPortalState(), emptyState());
  } finally {
    bucket.head = originalHead;
  }
});
