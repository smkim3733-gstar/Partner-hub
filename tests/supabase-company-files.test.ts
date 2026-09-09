import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { postgresRuntimeFixture, postgresTestOrigin as origin } from './supabase-runtime-fixture';
import { hashPassword } from '../lib/password-crypto';
import { objects } from './runtime-mock.mjs';

const { GET, DELETE } = await import('../app/api/files/[id]/route');
const { mutatePortalState, readPortalStateSnapshot } = await import('../lib/portal-state');
const { requirePortalUser } = await import('../lib/portal-auth');
const { loginPassword } = await import('../lib/password-handlers');
const { storeCompanyUpload } = await import('../lib/company-upload-store');
const { companyFileBucket, ensureCompanyFileTables, findCompanyFile, isCompanyFileIntakeVisible } = await import('../lib/company-files');
const { currentFileAccess, fileStateGuard, fileUnlinkedGuard } = await import('../lib/company-file-access');
const { checkNewCompanyDocumentFileProvenance } = await import('../lib/company-document-file-provenance');

const children = ['company_file_object_integrity', 'company_file_object_checksums', 'company_file_storage_keys',
  'company_file_metadata', 'company_file_assignments', 'company_file_case_links'];
const bytes = new TextEncoder().encode('%PDF-1.7\nsynthetic original\n%%EOF').buffer;

void test('PostgreSQL bootstrap CAS binds the proposed payload consistently with provenance guards', async (t) => {
  const { db } = await postgresRuntimeFixture(t);
  await ensureCompanyFileTables(db);
  await assert.rejects(mutatePortalState(() => ({ companyDocuments: [{ storageFileId: 'missing-original' }] }),
    undefined, undefined, () => ['company_document_file_provenance']), { kind: 'cas_exhausted' });
  assert.equal((await readPortalStateSnapshot()).payload, null);
  await mutatePortalState(() => ({ companyDocuments: [] }), undefined, undefined, () => ['company_document_file_provenance']);
  assert.deepEqual((await readPortalStateSnapshot()).state, { companyDocuments: [] });
});

async function setup(t: TestContext) {
  const fixture = await postgresRuntimeFixture(t);
  const { db } = fixture;
  t.after(() => objects.clear());
  await ensureCompanyFileTables(db);
  const permissions = { collaborationApply: true, ownCases: true, fileUpload: true, quoteContract: false, sharedSchedule: true };
  const members = ['file-owner', 'file-peer'].map((id) => ({ id, name: `가상 ${id}`,
    email: `${id}@example.test`, status: '활성', permissions }));
  const state = { version: 1, consultationNumber: 0, members,
    cases: [{ id: 'case-draft-files-001', company: '가상 기업', trainee: members[0].name, partnerMemberId: members[0].id }],
    tasks: [], timeline: [], schedule: [], companyDocuments: [] as unknown[] };
  await mutatePortalState(() => state);
  const request = (method: string, cookie = '') => new Request(`${origin}/api/files/synthetic`, {
    method, headers: { origin, cookie },
  });
  const cookies: string[] = [];
  for (const member of members) {
    await db.prepare('INSERT INTO portal_password_accounts VALUES (?1, ?2, ?3, ?4, ?5, ?5)')
      .bind(member.id, member.email, hashPassword('Synthetic file password!'), `credential-${member.id}`, new Date().toISOString()).run();
    const response = await loginPassword(new Request(`${origin}/api/password/login`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ email: member.email, password: 'Synthetic file password!' }),
    }));
    assert.equal(response.status, 200, await response.clone().text());
    cookies.push(response.headers.get('set-cookie')!.split(';')[0]);
  }
  const user = await requirePortalUser(request('GET', cookies[0]), state);
  const authorize = async () => (await currentFileAccess(request('GET', cookies[0]), user)).payload;
  const bucket = companyFileBucket(); // Deliberately in-memory bytes, NOT real Supabase Storage HTTP.
  const metadata = { originalName: 'original.pdf', company: '가상 기업', category: '사업자등록증', title: '합성 원본',
    assignedTrainee: members[0].name, partnerMemberId: members[0].id, caseId: 'case-draft-files-001',
    contentType: 'application/pdf', sizeBytes: bytes.byteLength };
  const upload = (key: string) => storeCompanyUpload(db, bucket, user, key, metadata, bytes, [], authorize);
  return { ...fixture, state, request, cookies, user, authorize, bucket, metadata, upload };
}

void test('PostgreSQL file ledgers preserve immutability, cascade, receipts and server-only privileges', async (t) => {
  const f = await setup(t);
  const stored = await f.upload('ledger-upload');
  for (const table of ['company_file_objects', ...children]) {
    const column = table === 'company_file_objects' ? 'id' : 'file_id';
    assert.equal(await f.db.prepare(`SELECT count(*) AS n FROM ${table}`).first('n'), 1);
    await assert.rejects(f.db.prepare(`UPDATE ${table} SET ${column} = ${column}`).run(), /OPERATION_FAILED/);
    if (table !== 'company_file_objects')
      await assert.rejects(f.db.prepare(`DELETE FROM ${table}`).run(), /OPERATION_FAILED/);
  }
  const receipt = 'company_file_upload_requests';
  for (const mutation of ["owner_key = 'other'", "file_id = 'other'", "created_at = 'other'", "fingerprint = 'other'",
    "status = 'pending'", "request_key = 'other', status = 'deleted'"])
    await assert.rejects(f.db.prepare(`UPDATE ${receipt} SET ${mutation}`).run(), /OPERATION_FAILED/);
  await f.db.prepare(`UPDATE ${receipt} SET request_key = 'migrated-key', fingerprint = 'migrated-fingerprint'`).run();
  await f.db.prepare(`UPDATE ${receipt} SET status = 'deleted'`).run();
  await f.db.prepare(`UPDATE ${receipt} SET status = 'deleted'`).run();
  await assert.rejects(f.db.prepare(`UPDATE ${receipt} SET request_key = 'revived'`).run(), /OPERATION_FAILED/);
  await assert.rejects(f.db.prepare(`DELETE FROM ${receipt}`).run(), /OPERATION_FAILED/);
  await f.db.prepare('DELETE FROM company_file_objects WHERE id = ?1').bind(stored.id).run();
  for (const table of children) assert.equal(await f.db.prepare(`SELECT count(*) AS n FROM ${table}`).first('n'), 0);
  assert.equal(await f.db.prepare(`SELECT count(*) AS n FROM ${receipt}`).first('n'), 1);
  for (const role of ['anon', 'authenticated']) {
    await f.engine.exec(`SET ROLE ${role}`);
    await assert.rejects(f.engine.query('SELECT * FROM partner_hub.company_file_objects'), /permission denied/);
    await f.engine.exec('RESET ROLE');
  }
  await f.engine.exec('SET ROLE service_role');
  assert.equal((await f.engine.query('SELECT partner_hub.assert_company_file_schema() AS ready')).rows.length, 1);
  await assert.rejects(f.engine.exec('TRUNCATE partner_hub.company_file_upload_requests'), /permission denied/);
  await f.engine.exec('RESET ROLE');
  await f.engine.exec('ALTER TABLE partner_hub.company_file_metadata DISABLE TRIGGER company_file_metadata_guard');
  await assert.rejects(ensureCompanyFileTables(f.db), /OPERATION_FAILED/);
});

void test('PostgreSQL file upload retries and authenticated downloads/deletion retain durable tombstones', async (t) => {
  const f = await setup(t);
  const stored = await f.upload('route-upload');
  assert.deepEqual(await f.upload('route-upload'), stored);
  assert.equal(objects.size, 1);
  await assert.rejects(storeCompanyUpload(f.db, f.bucket, f.user, 'route-upload', { ...f.metadata, title: 'changed' },
    bytes, [], f.authorize), { status: 409 });
  const context = { params: Promise.resolve({ id: stored.id }) };
  assert.equal((await GET(f.request('GET'), context)).status, 401);
  assert.equal((await GET(f.request('GET', f.cookies[1]), context)).status, 403);
  const downloaded = await GET(f.request('GET', f.cookies[0]), context);
  assert.equal(downloaded.status, 200, await downloaded.clone().text());
  assert.deepEqual(await downloaded.arrayBuffer(), bytes);
  assert.match(downloaded.headers.get('cache-control')!, /no-store/);
  assert.equal((await DELETE(f.request('DELETE', f.cookies[1]), context)).status, 403);
  const crossSite = f.request('DELETE', f.cookies[0]); crossSite.headers.set('origin', 'https://other.example.test');
  assert.equal((await DELETE(crossSite, context)).status, 403);
  const originalDelete = f.bucket.delete.bind(f.bucket);
  f.bucket.delete = async () => { throw new Error('synthetic uncertain storage deletion'); };
  t.after(() => { f.bucket.delete = originalDelete; });
  assert.equal((await DELETE(f.request('DELETE', f.cookies[0]), context)).status, 500);
  assert.equal(await f.db.prepare('SELECT status FROM company_file_upload_requests').first('status'), 'deleted');
  assert.equal((await GET(f.request('GET', f.cookies[0]), context)).status, 404);
  await assert.rejects(f.upload('route-upload'), { status: 409 });
  assert.equal(objects.size, 1, 'uncertain deletion must not compensate');
  f.bucket.delete = originalDelete;
  assert.equal((await DELETE(f.request('DELETE', f.cookies[0]), context)).status, 204);
  assert.equal((await DELETE(f.request('DELETE', f.cookies[0]), context)).status, 204);
  assert.equal(objects.size, 0);
  assert.equal(await findCompanyFile(stored.id), null);
  assert.equal(await f.db.prepare('SELECT status FROM company_file_upload_requests').first('status'), 'deleted');
  await assert.rejects(f.upload('route-upload'), { status: 409 });
});

void test('PostgreSQL file batch failure rolls back all ledgers without deleting uploaded bytes', async (t) => {
  const f = await setup(t);
  await f.engine.exec(`CREATE FUNCTION partner_hub.synthetic_reject_ready() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.status = 'ready' THEN RAISE EXCEPTION 'synthetic final batch failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER synthetic_reject_ready BEFORE UPDATE ON partner_hub.company_file_upload_requests
    FOR EACH ROW EXECUTE FUNCTION partner_hub.synthetic_reject_ready();`);
  await assert.rejects(f.upload('atomic-upload'), /OPERATION_FAILED/);
  for (const table of ['company_file_objects', ...children])
    assert.equal(await f.db.prepare(`SELECT count(*) AS n FROM ${table}`).first('n'), 0);
  assert.equal(await f.db.prepare('SELECT status FROM company_file_upload_requests').first('status'), 'pending');
  assert.equal(objects.size, 1, 'bytes retained for a safe retry after transaction rollback');
  await f.engine.exec('DROP TRIGGER synthetic_reject_ready ON partner_hub.company_file_upload_requests');
  const stored = await f.upload('atomic-upload');
  assert.equal(await f.db.prepare('SELECT status FROM company_file_upload_requests').first('status'), 'ready');
  assert.equal(objects.size, 1);
  const snapshot = await readPortalStateSnapshot();
  await mutatePortalState(() => ({ ...f.state, consultationNumber: 1 }));
  await assert.rejects(storeCompanyUpload(f.db, f.bucket, f.user, 'stale-upload', f.metadata, bytes, [], async () => snapshot.payload), { status: 409 });
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM company_file_upload_requests').first('n'), 1);
  assert.equal(await f.db.prepare(`SELECT count(*) AS n FROM company_file_objects WHERE ${fileStateGuard('?1', f.db)}`)
    .bind((await readPortalStateSnapshot()).payload + ' ').first('n'), 0, 'CAS preserves exact text, not JSON equivalence');
  assert.ok(await findCompanyFile(stored.id));
});

void test('PostgreSQL original provenance commit guard denies mismatches, deletion races and malformed JSON', async (t) => {
  const f = await setup(t);
  const stored = await f.upload('provenance-upload');
  assert.equal(await isCompanyFileIntakeVisible(stored.id), false);
  const document = { id: 'synthetic-document', title: '합성 원본', status: '제출완료', submittedBy: f.metadata.assignedTrainee,
    updatedAt: '방금 전', version: 'V1', sensitive: true,
    storageFileId: stored.id, fileName: f.metadata.originalName, fileSize: bytes.byteLength,
    company: f.metadata.company, category: f.metadata.category, partnerMemberId: f.metadata.partnerMemberId,
    assignedTrainee: f.metadata.assignedTrainee, caseId: f.metadata.caseId };
  const commit = (companyDocuments: unknown[]) => mutatePortalState(() => ({ ...f.state, companyDocuments }),
    undefined, undefined, () => ['company_document_file_provenance']);
  assert.deepEqual(await checkNewCompanyDocumentFileProvenance([], [document]), { requiresCommitGuard: true, error: null });
  for (const change of [{ fileName: 'other.pdf' }, { fileSize: String(bytes.byteLength) }, { fileSize: 1e100 },
    { partnerMemberId: 'file-peer' }, { caseId: null }, { category: 123 }])
    await assert.rejects(commit([{ ...document, ...change }]), { kind: 'cas_exhausted' });
  for (const malformed of [null, {}, { hidden: document }]) {
    const payload = JSON.stringify({ companyDocuments: malformed });
    assert.equal(await f.db.prepare(`SELECT count(*) AS n FROM company_file_objects f WHERE ${fileUnlinkedGuard('?1', f.db)}`)
      .bind(payload).first('n'), 0, 'malformed document collection cannot authorize deletion');
  }
  await commit([document]);
  assert.equal(await isCompanyFileIntakeVisible(stored.id), true);
  assert.equal((await DELETE(f.request('DELETE', f.cookies[0]), { params: Promise.resolve({ id: stored.id }) })).status, 409);
  await mutatePortalState(() => f.state);
  await f.db.prepare("UPDATE company_file_upload_requests SET status = 'deleted'").run();
  await assert.rejects(commit([document]), { kind: 'cas_exhausted' });
  assert.equal(await isCompanyFileIntakeVisible(stored.id), false);
  assert.notEqual((await checkNewCompanyDocumentFileProvenance([], [document])).error, null);
});

void test('PostgreSQL legacy files preserve NULL assignment/ETag access and explicit deletion receipts', async (t) => {
  const f = await setup(t);
  const id = 'legacy-postgres-file';
  const key = `synthetic/${id}`;
  await f.db.prepare(`INSERT INTO company_file_objects VALUES (?1, ?2, 'original.pdf', '가상 기업', '사업자등록증',
    '합성 원본', ?3, ?4, ?5, 'application/pdf', ?6, 'legacy timestamp')`)
    .bind(id, key, f.metadata.assignedTrainee, f.user.id, f.user.email, bytes.byteLength).run();
  await f.db.prepare(`INSERT INTO company_file_metadata SELECT id, original_name, company, category, title,
    assigned_trainee, uploaded_by_user_id, uploaded_by_email, content_type, size_bytes, created_at
    FROM company_file_objects WHERE id = ?1`).bind(id).run();
  await f.db.prepare('INSERT INTO company_file_storage_keys VALUES (?1, ?2)').bind(id, key).run();
  await f.db.prepare("INSERT INTO company_file_object_integrity VALUES (?1, 'metadata', NULL, 'application/pdf')").bind(id).run();
  await f.bucket.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' } });
  const context = { params: Promise.resolve({ id }) };
  const response = await GET(f.request('GET', f.cookies[0]), context);
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.arrayBuffer(), bytes);
  assert.equal((await GET(f.request('GET', f.cookies[1]), context)).status, 403);
  assert.equal((await DELETE(f.request('DELETE', f.cookies[0]), context)).status, 204);
  assert.equal(await f.db.prepare('SELECT status FROM company_file_upload_requests').first('status'), 'deleted');
  assert.equal(await findCompanyFile(id), null);
});

void test('PostgreSQL download rechecks account suspension after fetching private bytes', async (t) => {
  const f = await setup(t);
  const stored = await f.upload('revocation-upload');
  const originalGet = f.bucket.get.bind(f.bucket);
  t.mock.method(f.bucket, 'get', async (key: string) => {
    const object = await originalGet(key);
    await mutatePortalState(() => ({ ...f.state, members: f.state.members.map((member) =>
      member.id === f.user.memberId ? { ...member, status: '정지' } : member) }));
    return object;
  });
  const response = await GET(f.request('GET', f.cookies[0]), { params: Promise.resolve({ id: stored.id }) });
  assert.equal(response.status, 403, await response.clone().text());
  assert.equal(objects.size, 1, 'revoking access does not delete original storage');
});
