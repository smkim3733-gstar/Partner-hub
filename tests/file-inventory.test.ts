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
import type { InventoryPage, InventoryPresence } from '../lib/file-inventory';
import {
  readFileInventoryPageResponse,
  readFileInventoryPresenceResponse,
} from '../lib/file-inventory-response';

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
async function seed(documents: unknown[] = []) {
  const db = companyFileDatabase();
  await ensureCompanyFileTables(db);
  await flowDatabase();
  await db.batch([
    db.prepare('DELETE FROM company_file_objects'),
    db.prepare('DELETE FROM company_file_upload_requests'),
    db.prepare('DELETE FROM consulting_flows'),
  ]);
  await writePortalState({
    version: 1,
    members: [member],
    companyDocuments: documents,
    cases: [],
    timeline: [],
    tasks: [],
    schedule: [],
  });
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

void test('actual document and intake references distinguish linked files from staged, incomplete and deletion records', async () => {
  await seed([
    { storageFileId: 'document-linked' },
    { storageFileId: 'deleted-reference' },
  ]);
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
  await companyFileDatabase()
    .prepare(`UPDATE company_file_objects
      SET storage_key = 'company-source/another-file' WHERE id = ?1`)
    .bind('storage-key-mismatch')
    .run();
  await companyFileDatabase()
    .prepare(
      "UPDATE company_file_objects SET title = '다른 정상 제목' WHERE id = ?1",
    )
    .bind('metadata-title-mismatch')
    .run();
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
        files: [{ id: 'derived-file', intakeFileId: 'flow-linked' }],
        ai: { sourceText: 'PRIVATE_TRANSCRIPT' },
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
  assert.equal(pending.fileName, null);
  assert.match(pending.uploader, /inventory@example.invalid/);
  assert.deepEqual(
    (await page()).items.map((item) => item.id),
    ['unlinked-legacy', 'staged-only'],
  );
  assert.equal((await page('?status=deleted')).items.length, 2);
  assert.doesNotMatch(
    JSON.stringify(all),
    /PRIVATE_|storage_key|owner_key|company-source\/|sourceText|request_key|fingerprint/,
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
    for (const [id, exists, matches, integrityMode, integrityMatches] of [
      ['presence-present', true, true, 'metadata', true],
      ['presence-mismatch', true, false, 'metadata', false],
      ['presence-missing', false, null, null, null],
      ['presence-missing-integrity', true, true, null, false],
      ['presence-mime-mismatch', true, true, 'metadata', false],
      ['presence-etag-tampered', true, true, 'etag', false],
    ] as const) {
      const response = await presence(request(), {
        params: Promise.resolve({ id }),
      });
      assert.equal(response.status, 200);
      const value = await readFileInventoryPresenceResponse(response, id);
      assert.equal(value.exists, exists);
      assert.equal(value.sizeMatches, matches);
      assert.equal(value.integrityMode, integrityMode);
      assert.equal(value.integrityMatches, integrityMatches);
      assert.doesNotMatch(
        JSON.stringify(value),
        /company-source|storage_key|TEST|LONGER/,
      );
      assert.match(response.headers.get('cache-control')!, /private, no-store/);
    }
    assert.equal((await page('?status=all')).items.length, 6);
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
  await companyFileDatabase()
    .prepare(`UPDATE company_file_objects
      SET storage_key = 'company-source/foreign-private-object' WHERE id = ?1`)
    .bind('presence-key-mismatch')
    .run();
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
  await companyFileDatabase()
    .prepare(
      "UPDATE company_file_objects SET title = '다른 정상 제목' WHERE id = ?1",
    )
    .bind('presence-metadata-mismatch')
    .run();
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
