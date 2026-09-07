import test from 'node:test';
import assert from 'node:assert/strict';
import { GET as list } from '../app/api/admin/file-inventory/route';
import { GET as presence } from '../app/api/admin/file-inventory/[id]/presence/route';
import {
  companyFileDatabase,
  companyFileBucket,
  ensureCompanyFileTables,
} from '../lib/company-files';
import { readPortalState, writePortalState } from '../lib/portal-state';
import { flowDatabase } from '../lib/consulting-flow-store';
import { newConsultingFlow } from '../lib/consulting-flow';
import type { InventoryPage, InventoryPresence } from '../lib/file-inventory';
import {
  readFileInventoryPageResponse,
  readFileInventoryPresenceResponse,
} from '../lib/file-inventory-response';
import { mutateCompanyFileObjectFixture } from './company-file-object-fixture';
import {
  deleteConsultingFlowFixture,
  mutateConsultingFlowFixture,
} from './flow-root-fixture';
import { deleteFlowFileLedgerFixture } from './flow-file-ledger-fixture';
import { consultingFlowUploadRequestsNoDeleteTriggerSql } from '../db/schema';
import {
  FLOW_ADMIN_COMMAND_ACTOR_KEY,
  FLOW_ADMIN_COMMAND_ACTOR_NAME,
} from '../lib/flow-command-receipt';

const owner = 'seedy@sites.test';
const member = {
  id: 'inventory-member',
  name: '가상 담당자',
  email: 'inventory@example.invalid',
  status: '활성',
  permissions: { fileUpload: true, collaborationApply: true, ownCases: true },
};
const date = '2026-08-31T00:00:00.000Z';
function request(query = '', email: string | null = owner) {
  return new Request(`http://localhost/api/admin/file-inventory${query}`, {
    headers: email
      ? {
          'oai-authenticated-user-email': email,
          'oai-authenticated-user-id': email,
        }
      : {},
  });
}
async function seed(documents: unknown[] = [], cases: unknown[] = []) {
  const db = companyFileDatabase();
  await ensureCompanyFileTables(db);
  await flowDatabase();
  await db
    .prepare('DROP TRIGGER IF EXISTS company_file_upload_requests_no_delete')
    .run();
  await db
    .prepare('DROP TRIGGER IF EXISTS consulting_flow_upload_requests_no_delete')
    .run();
  try {
    await deleteConsultingFlowFixture(db);
    await db.batch([
      db.prepare('DELETE FROM company_file_objects'),
      db.prepare('DELETE FROM company_file_upload_requests'),
      db.prepare('DELETE FROM consulting_flow_upload_requests'),
    ]);
  } finally {
    await ensureCompanyFileTables(db);
    await db.prepare(consultingFlowUploadRequestsNoDeleteTriggerSql).run();
  }
  await writePortalState({
    version: 1,
    members: [member],
    companyDocuments: documents,
    cases,
    timeline: [],
    tasks: [],
    schedule: [],
  });
}
async function flowReservation(
  id: string,
  caseId: string,
  actorKey = FLOW_ADMIN_COMMAND_ACTOR_KEY,
  size = 4,
) {
  await (
    await flowDatabase()
  )
    .prepare(`INSERT INTO consulting_flow_upload_requests
      (case_id, actor_key, command_id, slot, fingerprint, file_id, storage_key,
       original_name, content_type, size_bytes, purpose, created_at, status)
      VALUES (?1, ?2, ?3, 'file', ?4, ?5, ?6, ?7, 'text/plain', ?8,
        'report', ?9, 'pending')`)
    .bind(
      caseId,
      actorKey,
      `inventory-${id}`,
      'a'.repeat(64),
      id,
      `consulting-flow/${id}`,
      `${id}.txt`,
      size,
      date,
    )
    .run();
}
async function completedFlowFile(
  id: string,
  caseId: string,
  ownerStorageKey?: string,
  ownerCaseId = caseId,
) {
  const key = `consulting-flow/${id}`;
  const storedFile = {
    id,
    key,
    name: `${id}.txt`,
    contentType: 'text/plain',
    size: 4,
    purpose: 'report',
    createdAt: date,
  };
  await companyFileBucket().put(key, 'TEST', {
    httpMetadata: { contentType: storedFile.contentType },
  });
  const flow = {
    ...newConsultingFlow(caseId, '완료 FLOW 재고기업', member.id, member.name),
    revision: 1,
    updatedAt: date,
    files: [storedFile],
  };
  const db = await flowDatabase();
  await db
    .prepare(
      'INSERT INTO consulting_flows (case_id, partner_id, revision, payload, updated_at) VALUES (?1, ?2, 1, ?3, ?4)',
    )
    .bind(caseId, member.id, JSON.stringify(flow), date)
    .run();
  await db.batch([
    db
      .prepare(`INSERT INTO consulting_flow_file_owners
        (file_id, case_id, storage_key, created_at)
        VALUES (?1, ?2, ?3, ?4)`)
      .bind(id, ownerCaseId, ownerStorageKey ?? key, date),
    db
      .prepare(`INSERT INTO consulting_flow_file_metadata
        (file_id, original_name, content_type, size_bytes, purpose)
        VALUES (?1, ?2, 'text/plain', 4, 'report')`)
      .bind(id, storedFile.name),
    db
      .prepare(`INSERT INTO consulting_flow_file_object_integrity
        (file_id, validation_mode, r2_etag, r2_content_type)
        VALUES (?1, 'metadata', NULL, 'text/plain')`)
      .bind(id),
  ]);
  return storedFile;
}
async function file(
  id: string,
  status?: 'pending' | 'ready' | 'deleted',
  metadata = true,
  caseId?: string,
  metadataLedger = true,
  objectIntegrity: {
    validationMode?: 'metadata' | 'etag';
    r2Etag?: string | null;
    r2ContentType?: string;
    sha256?: string;
  } | null = {},
) {
  const db = companyFileDatabase();
  if (metadata) {
    await db
      .prepare(`INSERT INTO company_file_objects (id, storage_key, original_name, company, category, title,
      assigned_trainee, uploaded_by_user_id, uploaded_by_email, content_type, size_bytes, created_at)
      VALUES (?1, ?2, ?3, ?4, '기타자료', '가상 자료', ?5, ?6, ?6, 'text/plain', 4, ?7)`)
      .bind(
        id,
        `company-source/${id}`,
        `${id}.txt`,
        '가상기업',
        member.name,
        member.email,
        date,
      )
      .run();
    if (metadataLedger)
      await db
        .prepare(`INSERT INTO company_file_metadata
          (file_id, original_name, company, category, title, assigned_trainee,
           uploaded_by_user_id, uploaded_by_email, content_type, size_bytes, created_at)
          SELECT id, original_name, company, category, title, assigned_trainee,
            uploaded_by_user_id, uploaded_by_email, content_type, size_bytes, created_at
          FROM company_file_objects WHERE id = ?1`)
        .bind(id)
        .run();
    await db
      .prepare(
        'INSERT INTO company_file_assignments (file_id, partner_member_id) VALUES (?1, ?2)',
      )
      .bind(id, member.id)
      .run();
    if (objectIntegrity !== null)
      await db
        .prepare(`INSERT INTO company_file_object_integrity
          (file_id, validation_mode, r2_etag, r2_content_type)
          VALUES (?1, ?2, ?3, ?4)`)
        .bind(
          id,
          objectIntegrity.validationMode ?? 'metadata',
          objectIntegrity.r2Etag ?? null,
          objectIntegrity.r2ContentType ?? 'text/plain',
        )
        .run();
    if (objectIntegrity?.sha256)
      await db
        .prepare(
          'INSERT INTO company_file_object_checksums (file_id, sha256) VALUES (?1, ?2)',
        )
        .bind(id, objectIntegrity.sha256)
        .run();
    await db
      .prepare(`INSERT INTO company_file_storage_keys (file_id, storage_key)
        VALUES (?1, ?2)`)
      .bind(id, `company-source/${id}`)
      .run();
    if (caseId)
      await db
        .prepare(
          'INSERT INTO company_file_case_links (file_id, case_id) VALUES (?1, ?2)',
        )
        .bind(id, caseId)
        .run();
  }
  if (status)
    await db
      .prepare(`INSERT INTO company_file_upload_requests (owner_key, request_key, fingerprint, file_id, created_at, status)
    VALUES (?1, ?2, 'PRIVATE_FINGERPRINT', ?3, ?4, ?5)`)
      .bind(`member:${member.id}`, `PRIVATE_REQUEST_${id}`, id, date, status)
      .run();
}
async function page(query = ''): Promise<InventoryPage> {
  const response = await list(request(query));
  assert.equal(response.status, 200, await response.clone().text());
  assert.match(response.headers.get('cache-control')!, /private, no-store/);
  const filter =
    new URL(request(query).url).searchParams.get('status') ?? 'unlinked';
  return readFileInventoryPageResponse(
    response,
    filter as Parameters<typeof readFileInventoryPageResponse>[1],
  );
}

void test('inventory list and presence are administrator-only, including malformed or guessed requests', async () => {
  await seed();
  await file('private-inventory-file', 'ready');
  for (const email of [null, member.email]) {
    assert.equal(
      (await list(request('?status=invalid', email))).status,
      email ? 403 : 401,
    );
    assert.equal(
      (
        await presence(request('', email), {
          params: Promise.resolve({ id: 'private-inventory-file' }),
        })
      ).status,
      email ? 403 : 401,
    );
  }
  assert.equal((await page()).items.length, 1);
});

void test('inventory exposes SHA-256 coverage without hashes or R2 body reads', async () => {
  await seed();
  await file('proof-metadata', 'ready');
  await file('proof-etag', 'ready', true, undefined, true, {
    validationMode: 'etag',
    r2Etag: 'legacy-etag',
  });
  await file('proof-sha256', 'ready', true, undefined, true, {
    validationMode: 'etag',
    r2Etag: 'sha-etag',
    sha256: 'a'.repeat(64),
  });
  await file('proof-unavailable', 'ready', true, undefined, true, null);
  const bucket = companyFileBucket();
  const originalHead = bucket.head.bind(bucket),
    originalGet = bucket.get.bind(bucket);
  let r2Calls = 0;
  bucket.head = async (...args: Parameters<R2Bucket['head']>) => {
    r2Calls++;
    return originalHead(...args);
  };
  bucket.get = async (...args: Parameters<R2Bucket['get']>) => {
    r2Calls++;
    return originalGet(...args);
  };
  try {
    const result = await page('?status=all');
    assert.deepEqual(
      Object.fromEntries(
        result.items.map((item) => [item.id, item.integrityProof]),
      ),
      {
        'proof-unavailable': null,
        'proof-sha256': 'sha256',
        'proof-metadata': 'metadata',
        'proof-etag': 'etag',
      },
    );
    assert.deepEqual(result.integrityCoverage, {
      sha256: 1,
      etag: 1,
      metadata: 1,
      unavailable: 1,
    });
    assert.doesNotMatch(JSON.stringify(result), /a{64}|legacy-etag|sha-etag/);
  } finally {
    bucket.head = originalHead;
    bucket.get = originalGet;
  }
  assert.equal(r2Calls, 0);
});

void test('inventory list and checksum coverage share one D1 snapshot', async () => {
  await seed();
  await file('snapshot-existing', 'ready', true, undefined, true, {
    validationMode: 'etag',
    r2Etag: 'existing-etag',
    sha256: 'a'.repeat(64),
  });
  const db = companyFileDatabase();
  const prepare = db.prepare.bind(db);
  let intercepted = 0;
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, property) {
        if (property === 'bind')
          return (...values: unknown[]) => wrap(target.bind(...values));
        if (property === 'all')
          return async <T = Record<string, unknown>>() => {
            const result = await target.all<T>();
            intercepted++;
            await file('snapshot-late', 'ready', true, undefined, true, {
              validationMode: 'etag',
              r2Etag: 'late-etag',
              sha256: 'b'.repeat(64),
            });
            return result;
          };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  db.prepare = (sql: string) =>
    sql.includes('WITH document_refs AS') ? wrap(prepare(sql)) : prepare(sql);
  let result: InventoryPage;
  try {
    result = await page('?status=all');
  } finally {
    db.prepare = prepare;
  }
  assert.equal(intercepted, 1);
  assert.deepEqual(
    result.items.map((item) => item.id),
    ['snapshot-existing'],
  );
  assert.deepEqual(result.integrityCoverage, {
    sha256: 1,
    etag: 0,
    metadata: 0,
    unavailable: 0,
  });
  assert.equal(
    (
      await db
        .prepare('SELECT COUNT(*) AS count FROM company_file_objects')
        .first<{ count: number }>()
    )?.count,
    2,
  );
});

void test('inventory coverage rejects broken MIME, storage and FLOW ownership ledgers', async () => {
  await seed();
  await file('proof-valid-binding', 'ready', true, undefined, true, {
    validationMode: 'etag',
    r2Etag: 'valid-etag',
    sha256: 'a'.repeat(64),
  });
  await file('proof-mime-drift', 'ready', true, undefined, true, {
    validationMode: 'etag',
    r2Etag: 'mime-etag',
    sha256: 'b'.repeat(64),
  });
  await file('proof-key-drift', 'ready', true, undefined, true, {
    validationMode: 'etag',
    r2Etag: 'key-etag',
    sha256: 'c'.repeat(64),
  });
  const db = companyFileDatabase();
  await mutateCompanyFileObjectFixture(
    db,
    "UPDATE company_file_objects SET content_type = 'text/markdown' WHERE id = ?1",
    ['proof-mime-drift'],
  );
  await mutateCompanyFileObjectFixture(
    db,
    "UPDATE company_file_objects SET storage_key = 'company-source/wrong-key' WHERE id = ?1",
    ['proof-key-drift'],
  );
  const orphanFlowId = 'proof-orphan-flow';
  await db.batch([
    db
      .prepare(`INSERT INTO consulting_flow_file_owners
        (file_id, case_id, storage_key, created_at)
        VALUES (?1, 'missing-flow-case', ?2, ?3)`)
      .bind(orphanFlowId, `consulting-flow/${orphanFlowId}`, date),
    db
      .prepare(`INSERT INTO consulting_flow_file_metadata
        (file_id, original_name, content_type, size_bytes, purpose)
        VALUES (?1, 'orphan.txt', 'text/plain', 4, 'report')`)
      .bind(orphanFlowId),
    db
      .prepare(`INSERT INTO consulting_flow_file_object_integrity
        (file_id, validation_mode, r2_etag, r2_content_type)
        VALUES (?1, 'etag', 'orphan-etag', 'text/plain')`)
      .bind(orphanFlowId),
    db
      .prepare(`INSERT INTO consulting_flow_file_object_checksums
        (file_id, sha256) VALUES (?1, ?2)`)
      .bind(orphanFlowId, 'd'.repeat(64)),
  ]);
  let result: InventoryPage;
  try {
    result = await page('?status=all');
  } finally {
    for (const table of [
      'consulting_flow_file_object_checksums',
      'consulting_flow_file_object_integrity',
      'consulting_flow_file_metadata',
      'consulting_flow_file_owners',
    ] as const)
      await deleteFlowFileLedgerFixture(db, table, orphanFlowId);
  }
  assert.deepEqual(result.integrityCoverage, {
    sha256: 1,
    etag: 0,
    metadata: 0,
    unavailable: 3,
  });
  assert.equal(
    result.items.find((item) => item.id === 'proof-valid-binding')
      ?.integrityProof,
    'sha256',
  );
  for (const id of ['proof-mime-drift', 'proof-key-drift']) {
    const item = result.items.find((candidate) => candidate.id === id);
    assert.equal(item?.integrityProof, null);
    assert.equal(item?.status, 'inconsistent');
  }
});

void test('actual document and intake references distinguish linked files from staged, incomplete and deletion records', async () => {
  await seed(
    [
      { storageFileId: 'document-linked' },
      { storageFileId: 'deleted-reference' },
    ],
    [
      {
        id: 'flow-reservation-case',
        company: '예약 가상기업',
        trainee: member.name,
        partnerMemberId: member.id,
      },
    ],
  );
  await file('document-linked', 'ready');
  await file('flow-linked');
  await file('unlinked-legacy');
  await file('staged-only', 'ready', true, 'case-draft-not-submitted');
  await file('pending-record', 'pending', false);
  await file('metadata-missing', 'ready', false);
  await file('integrity-missing', 'ready', true, undefined, true, null);
  await file('integrity-mime-mismatch', 'ready', true, undefined, true, {
    r2ContentType: 'text/markdown',
  });
  await file('storage-key-mismatch', 'ready');
  await file('metadata-ledger-missing', 'ready', true, undefined, false);
  await file('metadata-title-mismatch', 'ready');
  await file('deletion-incomplete', 'deleted');
  await file('deleted-reference', 'deleted', false);
  await file('deleted-complete', 'deleted', false);
  await flowReservation('flow-reserved', 'flow-reservation-case');
  await mutateCompanyFileObjectFixture(
    companyFileDatabase(),
    `UPDATE company_file_objects
      SET storage_key = 'company-source/another-file' WHERE id = ?1`,
    ['storage-key-mismatch'],
  );
  await mutateCompanyFileObjectFixture(
    companyFileDatabase(),
    "UPDATE company_file_objects SET title = '다른 정상 제목' WHERE id = ?1",
    ['metadata-title-mismatch'],
  );
  await (
    await flowDatabase()
  )
    .prepare(
      'INSERT INTO consulting_flows (case_id, partner_id, revision, payload, updated_at) VALUES (?1, ?2, 1, ?3, ?4)',
    )
    .bind(
      'inventory-flow',
      member.id,
      JSON.stringify({
        ...newConsultingFlow(
          'inventory-flow',
          '가상 보관기업',
          member.id,
          member.name,
        ),
        revision: 1,
        updatedAt: date,
        files: [{ id: 'derived-file', intakeFileId: 'flow-linked' }],
        ai: { enabled: false, sourceText: 'PRIVATE_TRANSCRIPT' },
      }),
      date,
    )
    .run();
  const all = await page('?status=all');
  assert.deepEqual(
    Object.fromEntries(all.items.map((item) => [item.id, item.status])),
    {
      'unlinked-legacy': 'unlinked',
      'storage-key-mismatch': 'inconsistent',
      'metadata-title-mismatch': 'inconsistent',
      'metadata-ledger-missing': 'inconsistent',
      'staged-only': 'unlinked',
      'pending-record': 'pending',
      'flow-reserved': 'pending',
      'metadata-missing': 'inconsistent',
      'integrity-missing': 'inconsistent',
      'integrity-mime-mismatch': 'inconsistent',
      'flow-linked': 'linked',
      'document-linked': 'linked',
      'deletion-incomplete': 'deleted',
      'deleted-reference': 'deleted',
    },
  );
  assert.equal(all.items.find((f) => f.id === 'flow-linked')?.flowLinked, true);
  assert.equal(
    all.items.find((f) => f.id === 'document-linked')?.documentLinked,
    true,
  );
  const pending = all.items.find((f) => f.id === 'pending-record')!;
  assert.equal(pending.source, 'company');
  assert.equal(pending.fileName, null);
  assert.match(pending.uploader, /inventory@example.invalid/);
  const flowPending = all.items.find((f) => f.id === 'flow-reserved')!;
  assert.equal(flowPending.source, 'flow');
  assert.equal(flowPending.company, '예약 가상기업');
  assert.equal(flowPending.assignedTrainee, member.name);
  assert.equal(flowPending.partnerMemberId, member.id);
  assert.equal(flowPending.uploader, FLOW_ADMIN_COMMAND_ACTOR_NAME);
  assert.equal(flowPending.title, '상담 FLOW 미완료 첨부');
  assert.deepEqual(
    (await page()).items.map((item) => item.id),
    ['unlinked-legacy', 'staged-only'],
  );
  assert.equal((await page('?status=deleted')).items.length, 2);
  assert.doesNotMatch(
    JSON.stringify(all),
    /PRIVATE_|storage_key|owner_key|company-source\/|consulting-flow\/|sourceText|request_key|command_id|actor_key|fingerprint/,
  );
});

void test('keyset pagination has no duplicates or missing same-time rows; cursors remain bound to their filter', async () => {
  await seed();
  for (let index = 0; index < 32; index++)
    await file(`page-file-${String(index).padStart(2, '0')}`, 'ready');
  const first = await page();
  assert.equal(first.items.length, 25);
  assert.ok(first.nextCursor);
  await file('page-file-new', 'ready'); // Newer ID at the same timestamp cannot shift the second page.
  const second = await page(`?cursor=${first.nextCursor}`);
  assert.equal(second.items.length, 7);
  assert.equal(second.nextCursor, null);
  assert.equal(
    new Set([...first.items, ...second.items].map((f) => f.id)).size,
    32,
  );
  assert.equal(
    (await list(request(`?status=pending&cursor=${first.nextCursor}`))).status,
    400,
  );
  for (const query of [
    '?status=__proto__',
    '?status=invalid',
    `?status=${'x'.repeat(21)}`,
    '?status=all&status=unlinked',
    '?cursor=!!!',
    '?cursor=one&cursor=two',
    `?cursor=${'A'.repeat(601)}`,
  ])
    assert.equal((await list(request(query))).status, 400);
});

void test('source-qualified cursors retain both sides of a raw ID collision across pages', async () => {
  const caseId = 'inventory-collision-pagination-case';
  const collisionId = 'm-collision-page-file';
  await seed(
    [],
    [
      {
        id: caseId,
        company: '충돌 페이지기업',
        trainee: member.name,
        partnerMemberId: member.id,
      },
    ],
  );
  for (let index = 0; index < 24; index++)
    await file(`z-page-file-${String(index).padStart(2, '0')}`, 'ready');
  await file(collisionId, 'ready');
  await completedFlowFile(collisionId, caseId);
  await file('a-page-tail', 'ready');

  const first = await page('?status=all');
  assert.equal(first.items.length, 25);
  assert.ok(first.nextCursor);
  const lastFirstPageItem = first.items.at(-1);
  assert.deepEqual(
    lastFirstPageItem && {
      id: lastFirstPageItem.id,
      source: lastFirstPageItem.source,
      idCollision: lastFirstPageItem.idCollision,
      status: lastFirstPageItem.status,
    },
    {
      id: collisionId,
      source: 'flow',
      idCollision: true,
      status: 'inconsistent',
    },
  );
  const second = await page(`?status=all&cursor=${first.nextCursor}`);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(
    second.items.map(({ id, source, idCollision, status }) => ({
      id,
      source,
      idCollision,
      status,
    })),
    [
      {
        id: collisionId,
        source: 'company',
        idCollision: true,
        status: 'inconsistent',
      },
      {
        id: 'a-page-tail',
        source: 'company',
        idCollision: false,
        status: 'unlinked',
      },
    ],
  );
  assert.equal(
    new Set(
      [...first.items, ...second.items].map(
        (item) => `${item.source}:${item.id}`,
      ),
    ).size,
    27,
  );
});

void test('presence uses metadata-only R2 head; size and object-integrity mismatches do not mutate records or expose keys', async () => {
  await seed();
  await file('presence-present', 'ready');
  await file('presence-mismatch', 'ready');
  await file('presence-missing', 'ready');
  await file(
    'presence-missing-integrity',
    'ready',
    true,
    undefined,
    true,
    null,
  );
  await file('presence-mime-mismatch', 'ready');
  const bucket = companyFileBucket();
  const metadata = { httpMetadata: { contentType: 'text/plain' } };
  const stored = await bucket.put(
    'company-source/presence-etag-tampered',
    'GOOD',
    metadata,
  );
  await file('presence-etag-tampered', 'ready', true, undefined, true, {
    validationMode: 'etag',
    r2Etag: stored.etag,
  });
  await bucket.put('company-source/presence-present', 'TEST', metadata);
  await bucket.put('company-source/presence-mismatch', 'LONGER', metadata);
  await bucket.put(
    'company-source/presence-missing-integrity',
    'TEST',
    metadata,
  );
  await bucket.put('company-source/presence-mime-mismatch', 'TEST', {
    httpMetadata: { contentType: 'text/markdown' },
  });
  await bucket.put('company-source/presence-etag-tampered', 'EVIL', metadata);
  const before = await readPortalState();
  const originalGet = bucket.get.bind(bucket),
    originalPut = bucket.put.bind(bucket),
    originalDelete = bucket.delete.bind(bucket);
  const noBody = async (): Promise<never> => {
    throw new Error('Inventory must not read file bodies or mutate R2');
  };
  bucket.get = noBody;
  bucket.put = noBody;
  bucket.delete = noBody;
  try {
    for (const [
      id,
      exists,
      matches,
      integrityMode,
      integrityProof,
      integrityMatches,
    ] of [
      ['presence-present', true, true, 'metadata', 'metadata', true],
      ['presence-mismatch', true, false, 'metadata', 'metadata', false],
      ['presence-missing', false, null, null, null, null],
      ['presence-missing-integrity', true, true, null, null, false],
      ['presence-mime-mismatch', true, true, 'metadata', 'metadata', false],
      ['presence-etag-tampered', true, true, 'etag', 'etag', false],
    ] as const) {
      const response = await presence(request(), {
        params: Promise.resolve({ id }),
      });
      assert.equal(response.status, 200);
      const value = await readFileInventoryPresenceResponse(response, id);
      assert.equal(value.exists, exists);
      assert.equal(value.sizeMatches, matches);
      assert.equal(value.integrityMode, integrityMode);
      assert.equal(value.integrityProof, integrityProof);
      assert.equal(value.integrityMatches, integrityMatches);
      assert.doesNotMatch(
        JSON.stringify(value),
        /company-source|storage_key|TEST|LONGER/,
      );
      assert.match(response.headers.get('cache-control')!, /private, no-store/);
    }
    assert.equal(
      (await page('?status=all')).items.filter(
        (item) => item.source === 'company' && item.id.startsWith('presence-'),
      ).length,
      6,
    );
  } finally {
    bucket.get = originalGet;
    bucket.put = originalPut;
    bucket.delete = originalDelete;
  }
  assert.deepEqual(await readPortalState(), before);
  assert.equal(
    (
      await companyFileDatabase()
        .prepare('SELECT COUNT(*) AS count FROM company_file_objects')
        .first<{ count: number }>()
    )?.count,
    6,
  );
});

void test('presence rejects a cross-file storage key before probing R2', async () => {
  await seed();
  await file('presence-key-mismatch', 'ready');
  await mutateCompanyFileObjectFixture(
    companyFileDatabase(),
    `UPDATE company_file_objects
      SET storage_key = 'company-source/foreign-private-object' WHERE id = ?1`,
    ['presence-key-mismatch'],
  );
  const bucket = companyFileBucket();
  const originalHead = bucket.head.bind(bucket);
  let headCalls = 0;
  bucket.head = async (...args: Parameters<R2Bucket['head']>) => {
    headCalls++;
    return originalHead(...args);
  };
  try {
    const response = await presence(request(), {
      params: Promise.resolve({ id: 'presence-key-mismatch' }),
    });
    assert.equal(response.status, 503);
    assert.match(await response.text(), /무결성/);
    assert.equal(headCalls, 0);
  } finally {
    bucket.head = originalHead;
  }
});

void test('presence rejects company metadata drift before probing R2', async () => {
  await seed();
  await file('presence-metadata-mismatch', 'ready');
  await mutateCompanyFileObjectFixture(
    companyFileDatabase(),
    "UPDATE company_file_objects SET title = '다른 정상 제목' WHERE id = ?1",
    ['presence-metadata-mismatch'],
  );
  const bucket = companyFileBucket();
  const originalHead = bucket.head.bind(bucket);
  let headCalls = 0;
  bucket.head = async (...args: Parameters<R2Bucket['head']>) => {
    headCalls++;
    return originalHead(...args);
  };
  try {
    const response = await presence(request(), {
      params: Promise.resolve({ id: 'presence-metadata-mismatch' }),
    });
    assert.equal(response.status, 503);
    assert.match(await response.text(), /무결성/);
    assert.equal(headCalls, 0);
  } finally {
    bucket.head = originalHead;
  }
});

void test('pending-only reservations can be checked without inventing file metadata; storage errors are not reported as absence', async () => {
  await seed();
  await file('pending-only-presence', 'pending', false);
  const bucket = companyFileBucket();
  await bucket.put('company-source/pending-only-presence', 'INCOMPLETE');
  const result = (await (
    await presence(request(), {
      params: Promise.resolve({ id: 'pending-only-presence' }),
    })
  ).json()) as InventoryPresence;
  assert.equal(result.exists, true);
  assert.equal(result.expectedSizeBytes, null);
  assert.equal(result.sizeMatches, null);
  assert.equal(result.integrityMode, null);
  assert.equal(result.integrityProof, null);
  assert.equal(result.integrityMatches, null);
  const originalHead = bucket.head.bind(bucket);
  bucket.head = async () => {
    throw new Error('PRIVATE_STORAGE_ERROR');
  };
  try {
    const response = await presence(request(), {
      params: Promise.resolve({ id: 'pending-only-presence' }),
    });
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /PRIVATE_|exists/);
  } finally {
    bucket.head = originalHead;
  }
  assert.equal(
    (
      await presence(request(), {
        params: Promise.resolve({ id: 'unknown-inventory-id' }),
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await presence(request(), {
        params: Promise.resolve({ id: '../private' }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await presence(request(), {
        params: Promise.resolve({ id: 'x'.repeat(200) }),
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await presence(request(), {
        params: Promise.resolve({ id: 'x'.repeat(201) }),
      })
    ).status,
    400,
  );
});

void test('pending FLOW reservations expose safe inventory metadata and exact-size R2 presence only', async () => {
  const caseId = 'pending-flow-inventory-case';
  await seed(
    [],
    [
      {
        id: caseId,
        company: 'FLOW 예약기업',
        trainee: member.name,
        partnerMemberId: member.id,
      },
    ],
  );
  await flowReservation('pending-flow-presence', caseId, `member:${member.id}`);
  const pending = await page('?status=pending');
  assert.deepEqual(pending.items, [
    {
      id: 'pending-flow-presence',
      source: 'flow',
      idCollision: false,
      fileName: 'pending-flow-presence.txt',
      company: 'FLOW 예약기업',
      title: '상담 FLOW 미완료 첨부',
      category: 'report',
      sizeBytes: 4,
      createdAt: date,
      assignedTrainee: member.name,
      partnerMemberId: member.id,
      uploader: `${member.name} · ${member.email}`,
      caseId,
      documentLinked: false,
      flowLinked: false,
      integrityProof: null,
      status: 'pending',
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(pending),
    /consulting-flow\/|command_id|actor_key|fingerprint/,
  );
  await companyFileBucket().put(
    'consulting-flow/pending-flow-presence',
    'TEST',
  );
  const response = await presence(request(), {
    params: Promise.resolve({ id: 'pending-flow-presence' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(
    {
      ...(await readFileInventoryPresenceResponse(
        response,
        'pending-flow-presence',
      )),
      checkedAt: date,
    },
    {
      id: 'pending-flow-presence',
      exists: true,
      sizeBytes: 4,
      expectedSizeBytes: 4,
      sizeMatches: true,
      integrityMode: null,
      integrityProof: null,
      integrityMatches: null,
      checkedAt: date,
    },
  );
});

void test('completed FLOW files remain visible and support metadata-only R2 presence checks', async () => {
  const caseId = 'completed-flow-inventory-case';
  await seed(
    [],
    [
      {
        id: caseId,
        company: '완료 FLOW 재고기업',
        trainee: member.name,
        partnerMemberId: member.id,
      },
    ],
  );
  await completedFlowFile('completed-flow-presence', caseId);
  const linked = await page('?status=linked');
  assert.deepEqual(linked.items, [
    {
      id: 'completed-flow-presence',
      source: 'flow',
      idCollision: false,
      fileName: 'completed-flow-presence.txt',
      company: '완료 FLOW 재고기업',
      title: '상담 FLOW 보관 첨부',
      category: 'report',
      sizeBytes: 4,
      createdAt: date,
      assignedTrainee: member.name,
      partnerMemberId: member.id,
      uploader: '이전 계정 · 확인 필요',
      caseId,
      documentLinked: false,
      flowLinked: true,
      integrityProof: 'metadata',
      status: 'linked',
    },
  ]);
  const bucket = companyFileBucket();
  const originalGet = bucket.get.bind(bucket);
  let headCalls = 0;
  const originalHead = bucket.head.bind(bucket);
  bucket.get = async () => {
    throw new Error('Inventory presence must not read FLOW file bodies');
  };
  bucket.head = async (...args: Parameters<R2Bucket['head']>) => {
    headCalls++;
    return originalHead(...args);
  };
  try {
    const response = await presence(request(), {
      params: Promise.resolve({ id: 'completed-flow-presence' }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(
      {
        ...(await readFileInventoryPresenceResponse(
          response,
          'completed-flow-presence',
        )),
        checkedAt: date,
      },
      {
        id: 'completed-flow-presence',
        exists: true,
        sizeBytes: 4,
        expectedSizeBytes: 4,
        sizeMatches: true,
        integrityMode: 'metadata',
        integrityProof: 'metadata',
        integrityMatches: true,
        checkedAt: date,
      },
    );
    assert.equal(headCalls, 1);
  } finally {
    bucket.get = originalGet;
    bucket.head = originalHead;
  }
});

void test('completed FLOW owner-key drift stays inconsistent and fails before R2 access', async () => {
  const caseId = 'completed-flow-owner-drift-case';
  const fileId = 'completed-flow-owner-drift';
  await seed(
    [],
    [
      {
        id: caseId,
        company: '소유 원장 손상기업',
        trainee: member.name,
        partnerMemberId: member.id,
      },
    ],
  );
  await completedFlowFile(fileId, caseId, 'consulting-flow/wrong-owner-key');
  const inconsistent = await page('?status=inconsistent');
  const item = inconsistent.items.find((candidate) => candidate.id === fileId);
  assert.equal(item?.source, 'flow');
  assert.equal(item?.status, 'inconsistent');
  assert.equal(item?.flowLinked, true);
  assert.equal(item?.integrityProof, null);

  const bucket = companyFileBucket();
  const originalHead = bucket.head.bind(bucket);
  let headCalls = 0;
  bucket.head = async (...args: Parameters<R2Bucket['head']>) => {
    headCalls++;
    return originalHead(...args);
  };
  try {
    const response = await presence(request(), {
      params: Promise.resolve({ id: fileId }),
    });
    assert.equal(response.status, 503, await response.clone().text());
    assert.deepEqual(await response.json(), {
      error: '저장된 상담 FLOW 첨부 원장의 무결성을 확인할 수 없습니다.',
    });
    assert.equal(headCalls, 0);
  } finally {
    bucket.head = originalHead;
  }
});

void test('completed FLOW case drift, missing payload and cross-FLOW duplicate stay inconsistent and fail before R2 access', async () => {
  const ownerDriftFlowCaseId = 'completed-flow-owner-case-drift-source';
  const ownerDriftLedgerCaseId = 'completed-flow-owner-case-drift-target';
  const missingPayloadCaseId = 'completed-flow-missing-payload-case';
  const duplicateOwnerCaseId = 'completed-flow-duplicate-owner-case';
  const duplicateOtherCaseId = 'completed-flow-duplicate-other-case';
  const ownerDriftId = 'completed-flow-owner-case-drift';
  const missingPayloadId = 'completed-flow-missing-payload';
  const duplicateId = 'completed-flow-cross-flow-duplicate';
  await seed(
    [],
    [
      ownerDriftFlowCaseId,
      ownerDriftLedgerCaseId,
      missingPayloadCaseId,
      duplicateOwnerCaseId,
      duplicateOtherCaseId,
    ].map((id) => ({
      id,
      company: `FLOW 재고 감사 ${id}`,
      trainee: member.name,
      partnerMemberId: member.id,
    })),
  );
  await completedFlowFile(
    ownerDriftId,
    ownerDriftFlowCaseId,
    undefined,
    ownerDriftLedgerCaseId,
  );
  await completedFlowFile(missingPayloadId, missingPayloadCaseId);
  const duplicateFile = await completedFlowFile(
    duplicateId,
    duplicateOwnerCaseId,
  );
  const beforePayloadCorruption = await page('?status=all');
  const db = await flowDatabase();
  const missingPayloadRow = await db
    .prepare('SELECT payload FROM consulting_flows WHERE case_id = ?1')
    .bind(missingPayloadCaseId)
    .first<{ payload: string }>();
  assert.ok(missingPayloadRow);
  const missingPayloadFlow = JSON.parse(missingPayloadRow.payload);
  missingPayloadFlow.revision = 2;
  missingPayloadFlow.updatedAt = '2026-08-31T00:00:00.001Z';
  missingPayloadFlow.files = [];
  await mutateConsultingFlowFixture(
    db,
    `UPDATE consulting_flows
      SET revision = 2, payload = ?2, updated_at = ?3 WHERE case_id = ?1`,
    [
      missingPayloadCaseId,
      JSON.stringify(missingPayloadFlow),
      missingPayloadFlow.updatedAt,
    ],
  );
  const duplicateFlow = {
    ...newConsultingFlow(
      duplicateOtherCaseId,
      '중복 FLOW payload 감사기업',
      member.id,
      member.name,
    ),
    revision: 1,
    updatedAt: date,
    files: [duplicateFile],
  };
  await db
    .prepare(
      'INSERT INTO consulting_flows (case_id, partner_id, revision, payload, updated_at) VALUES (?1, ?2, 1, ?3, ?4)',
    )
    .bind(duplicateOtherCaseId, member.id, JSON.stringify(duplicateFlow), date)
    .run();

  const inconsistent = await page('?status=inconsistent');
  assert.equal(
    inconsistent.integrityCoverage.metadata,
    beforePayloadCorruption.integrityCoverage.metadata - 2,
  );
  assert.equal(
    inconsistent.integrityCoverage.unavailable,
    beforePayloadCorruption.integrityCoverage.unavailable + 2,
  );
  assert.deepEqual(
    inconsistent.items
      .filter((item) =>
        [ownerDriftId, missingPayloadId, duplicateId].includes(item.id),
      )
      .map(({ id, source, status, integrityProof }) => ({
        id,
        source,
        status,
        integrityProof,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [duplicateId, missingPayloadId, ownerDriftId].sort().map((id) => ({
      id,
      source: 'flow',
      status: 'inconsistent',
      integrityProof: null,
    })),
  );
  assert.doesNotMatch(
    JSON.stringify(inconsistent.items),
    /consulting-flow\/|storage_key/,
  );

  const bucket = companyFileBucket();
  const originalHead = bucket.head.bind(bucket);
  let headCalls = 0;
  bucket.head = async (...args: Parameters<R2Bucket['head']>) => {
    headCalls++;
    return originalHead(...args);
  };
  try {
    for (const id of [ownerDriftId, missingPayloadId, duplicateId]) {
      const response = await presence(request(), {
        params: Promise.resolve({ id }),
      });
      assert.equal(response.status, 503, await response.clone().text());
      assert.deepEqual(await response.json(), {
        error: '저장된 상담 FLOW 첨부 원장의 무결성을 확인할 수 없습니다.',
      });
    }
    assert.equal(headCalls, 0);
  } finally {
    bucket.head = originalHead;
  }
});

void test('completed FLOW payloads with a missing owner ledger stay visible, unavailable and fail before R2 access', async () => {
  const caseId = 'completed-flow-missing-owner-case';
  const fileId = 'completed-flow-missing-owner';
  await seed(
    [],
    [
      {
        id: caseId,
        company: 'FLOW 소유 원장 누락기업',
        trainee: member.name,
        partnerMemberId: member.id,
      },
    ],
  );
  await completedFlowFile(fileId, caseId);
  const beforeOwnerDeletion = await page('?status=all');
  const db = await flowDatabase();
  await deleteFlowFileLedgerFixture(db, 'consulting_flow_file_owners', fileId);
  const duplicateCaseId = 'completed-flow-missing-owner-duplicate-case';
  const duplicateFlow = {
    ...newConsultingFlow(
      duplicateCaseId,
      'FLOW 소유 원장 누락 중복기업',
      member.id,
      member.name,
    ),
    revision: 1,
    updatedAt: date,
    files: [
      {
        id: fileId,
        key: `consulting-flow/${fileId}`,
        name: `${fileId}.txt`,
        contentType: 'text/plain',
        size: 4,
        purpose: 'report',
        createdAt: date,
      },
    ],
  };
  await db
    .prepare(
      'INSERT INTO consulting_flows (case_id, partner_id, revision, payload, updated_at) VALUES (?1, ?2, 1, ?3, ?4)',
    )
    .bind(duplicateCaseId, member.id, JSON.stringify(duplicateFlow), date)
    .run();

  const inconsistent = await page('?status=inconsistent');
  assert.equal(
    inconsistent.integrityCoverage.metadata,
    beforeOwnerDeletion.integrityCoverage.metadata - 1,
  );
  assert.equal(
    inconsistent.integrityCoverage.unavailable,
    beforeOwnerDeletion.integrityCoverage.unavailable + 1,
  );
  const matchingItems = inconsistent.items.filter(
    (candidate) => candidate.source === 'flow' && candidate.id === fileId,
  );
  assert.equal(matchingItems.length, 1);
  const item = matchingItems[0];
  assert.deepEqual(
    item && {
      id: item.id,
      source: item.source,
      status: item.status,
      flowLinked: item.flowLinked,
      integrityProof: item.integrityProof,
    },
    {
      id: fileId,
      source: 'flow',
      status: 'inconsistent',
      flowLinked: true,
      integrityProof: null,
    },
  );
  assert.doesNotMatch(
    JSON.stringify(item),
    /consulting-flow\/|storage_key|TEST|fingerprint/,
  );

  const bucket = companyFileBucket();
  const originalHead = bucket.head.bind(bucket);
  let headCalls = 0;
  bucket.head = async (...args: Parameters<R2Bucket['head']>) => {
    headCalls++;
    return originalHead(...args);
  };
  try {
    const response = await presence(request(), {
      params: Promise.resolve({ id: fileId }),
    });
    assert.equal(response.status, 503, await response.clone().text());
    assert.deepEqual(await response.json(), {
      error: '저장된 상담 FLOW 첨부 원장의 무결성을 확인할 수 없습니다.',
    });
    assert.equal(headCalls, 0);
  } finally {
    bucket.head = originalHead;
  }
});

void test('company and FLOW records sharing one raw ID stay visible as distinct inconsistent items', async () => {
  const caseId = 'inventory-cross-source-id-collision-case';
  const fileId = 'inventory-cross-source-id-collision';
  await seed(
    [],
    [
      {
        id: caseId,
        company: '식별값 충돌기업',
        trainee: member.name,
        partnerMemberId: member.id,
      },
    ],
  );
  await file(fileId, 'ready');
  const beforeCollision = await page('?status=all');
  await completedFlowFile(fileId, caseId);
  const collisionPage = await page('?status=all');
  assert.equal(
    collisionPage.integrityCoverage.metadata,
    beforeCollision.integrityCoverage.metadata - 1,
  );
  assert.equal(
    collisionPage.integrityCoverage.unavailable,
    beforeCollision.integrityCoverage.unavailable + 2,
  );
  const collidedItems = collisionPage.items.filter(
    (item) => item.id === fileId,
  );
  assert.equal(collidedItems.length, 2);
  assert.equal(
    collidedItems.every((item) => item.idCollision),
    true,
  );
  assert.deepEqual(
    collidedItems
      .map(({ id, source, status }) => ({ id, source, status }))
      .sort((left, right) => left.source.localeCompare(right.source)),
    [
      { id: fileId, source: 'company', status: 'inconsistent' },
      { id: fileId, source: 'flow', status: 'inconsistent' },
    ],
  );
});

void test('refreshing the inventory reflects newly linked files without altering uploads or making deletion decisions', async () => {
  await seed();
  await file('newly-linked-file', 'ready', true, 'case-draft-pending');
  assert.equal((await page()).items.length, 1);
  const state = (await readPortalState()) as { companyDocuments: unknown[] };
  state.companyDocuments = [
    { storageFileId: 'newly-linked-file', caseId: 'case-draft-pending' },
  ];
  await writePortalState(state);
  assert.equal((await page()).items.length, 0);
  assert.equal((await page('?status=linked')).items[0].id, 'newly-linked-file');
  const row = await companyFileDatabase()
    .prepare(
      'SELECT status FROM company_file_upload_requests WHERE file_id = ?1',
    )
    .bind('newly-linked-file')
    .first<{ status: string }>();
  assert.equal(row?.status, 'ready');
});
