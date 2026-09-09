import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { postgresRuntimeFixture } from './supabase-runtime-fixture';
import { flowFileLedgerSql } from '../lib/consulting-flow-file-sql';
import { newConsultingFlow, type FlowFile } from '../lib/consulting-flow';
import { MAX_FLOW_UPLOAD_BYTES } from '../lib/consulting-flow-upload-policy';
const { reserveFlowUploads, readFlowFileObjectIntegrity, flowDatabase } = await import('../lib/consulting-flow-store');

const time = '2026-09-09T13:00:00.000Z';
const later = '2026-09-09T13:01:00.000Z';
const caseId = 'synthetic-flow-case';
const actorKey = 'admin:primary';
const commandId = 'synthetic-flow-command-001';
const fingerprint = 'a'.repeat(64);
const sha = 'b'.repeat(64);
const file = (id = 'synthetic-flow-file', overrides: Partial<FlowFile> = {}): FlowFile => ({
  id, key: `consulting-flow/${id}`, name: 'synthetic.pdf', contentType: 'application/pdf',
  size: 4, purpose: 'source', createdAt: time, ...overrides,
});
const request = (uploads: Array<{ slot: 'file' | 'audio'; file: FlowFile }>, overrides = {}) => ({ caseId, actorKey, commandId, fingerprint, uploads, ...overrides });
type Fixture = Awaited<ReturnType<typeof postgresRuntimeFixture>>;

// Deliberately isolated ledger harness, NOT the production FLOW root or its
// command/actor/domain guard. Never applied remotely or included in migrations.
// The application flowDatabase() must still reject this incomplete root.
async function ledgerHarness(fixture: Fixture) {
  await fixture.engine.exec(`CREATE TABLE partner_hub.consulting_flows (
    case_id text PRIMARY KEY, partner_id text NOT NULL, revision bigint NOT NULL, payload text NOT NULL, updated_at text NOT NULL);
    GRANT SELECT, INSERT, UPDATE ON partner_hub.consulting_flows TO service_role;`);
  await assert.rejects(flowDatabase(), /OPERATION_FAILED/);
}
function snapshot(files: FlowFile[], id = commandId) {
  return { ...newConsultingFlow(caseId, '가상기업', 'synthetic-partner', '가상담당'), revision: 1, updatedAt: time, files,
    commandIds: [id], commandReceipts: { [id]: { actorKey, fingerprint } },
    recordings: files.length === 2 ? [{ id: `${id}-recording`, fileId: files[0].id, audioFileId: files[1].id }] : [] };
}
function claims(db: D1Database, item: FlowFile, payload: string) {
  const sql = flowFileLedgerSql(db);
  const metadata = [item.id, caseId, item.key, item.name, item.contentType, item.size, item.createdAt, item.purpose,
    item.intakeFileId ?? null, item.intakeSourceHash ?? null, item.sourceReviewedAt ?? null, item.sourceReviewedBy ?? null, 1, payload];
  return [
    db.prepare(sql.claimOwner).bind(item.id, caseId, item.key, item.createdAt, 1, payload),
    db.prepare(sql.claimMetadata).bind(...metadata),
    db.prepare(sql.claimIntegrity).bind(...metadata, 'synthetic-etag'),
    db.prepare(sql.claimChecksum).bind(item.id, sha, 'synthetic-etag', item.contentType),
  ];
}
function commitLedgerRows(db: D1Database, files: FlowFile[], payload = JSON.stringify(snapshot(files)), id = commandId) {
  return [
    db.prepare('INSERT INTO consulting_flows (case_id,partner_id,revision,payload,updated_at) VALUES (?1,?2,1,?3,?4)')
      .bind(caseId, 'synthetic-partner', payload, time),
    ...files.flatMap((item) => [
      ...claims(db, item, payload),
      db.prepare('INSERT INTO consulting_flow_upload_completions (file_id,command_id) VALUES (?1,?2)').bind(item.id, id),
      db.prepare("UPDATE consulting_flow_upload_requests SET status='ready' WHERE file_id=?1 AND status='pending'").bind(item.id),
    ]),
  ];
}

void test('PostgreSQL FLOW reservations reuse exact pending keys, scope identity and keep root writes closed', async (t) => {
  const { db, engine } = await postgresRuntimeFixture(t);
  await engine.exec('SET ROLE service_role');
  const input = request([{ slot: 'file', file: file() }]);
  assert.equal((await reserveFlowUploads(input)).get('file')!.id, file().id);
  assert.equal((await reserveFlowUploads(input)).get('file')!.id, file().id);
  const retried = await reserveFlowUploads(request([{ slot: 'file', file: file('unused-new-id', { createdAt: later }) }], { commandId: 'synthetic-retry-command' }));
  assert.equal(retried.get('file')!.id, file().id);
  assert.equal(retried.get('file')!.createdAt, later);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM consulting_flow_upload_requests').first('n'), 1);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM consulting_flow_upload_command_keys').first('n'), 1);
  for (const altered of [
    request([{ slot: 'file', file: file('other', { name: 'changed.pdf' }) }]),
    request([{ slot: 'file', file: file() }], { fingerprint: 'c'.repeat(64) }),
    request([{ slot: 'audio', file: file() }]),
    request([{ slot: 'file', file: file('huge', { size: MAX_FLOW_UPLOAD_BYTES + 1 }) }]),
    request([{ slot: 'file', file: file('bad', { key: 'somewhere-else' }) }]),
  ]) await assert.rejects(reserveFlowUploads(altered));
  await reserveFlowUploads(request([{ slot: 'file', file: file('other-actor') }], { actorKey: 'member:synthetic-partner' }));
  await reserveFlowUploads(request([{ slot: 'file', file: file('other-case') }], { caseId: 'synthetic-other-case' }));
  assert.equal(await db.prepare('SELECT count(*) AS n FROM consulting_flow_upload_requests').first('n'), 3);
  await assert.rejects(flowDatabase(), /OPERATION_FAILED/);
  await assert.rejects(db.prepare("UPDATE consulting_flow_upload_requests SET status='ready' WHERE file_id=?1").bind(file().id).run(), /OPERATION_FAILED/);
  assert.equal(await db.prepare("SELECT to_regclass('partner_hub.consulting_flows')::text AS name").first('name'), null);
  await engine.exec('RESET ROLE');
  await engine.exec('ALTER TABLE partner_hub.consulting_flow_upload_command_keys DISABLE TRIGGER consulting_flow_upload_command_keys_guard');
  await assert.rejects(reserveFlowUploads(input), /OPERATION_FAILED/);
});

void test('PostgreSQL FLOW direct reservation envelopes and cross-slot fingerprint guard reject malformed writes atomically', async (t) => {
  const { db, engine } = await postgresRuntimeFixture(t);
  const base = { case_id: caseId, actor_key: actorKey, command_id: commandId, slot: 'file', fingerprint,
    file_id: file().id, storage_key: file().key, original_name: file().name, content_type: file().contentType,
    size_bytes: 4, purpose: 'source', intake_file_id: null, intake_source_hash: null,
    source_reviewed_at: null, source_reviewed_by: null, created_at: time, status: 'pending' };
  const columns = Object.keys(base);
  const insert = (patch: Record<string, unknown>) => db.prepare(`INSERT INTO consulting_flow_upload_requests
    (${columns.join(',')}) VALUES (${columns.map((_, i) => `?${i + 1}`).join(',')})`).bind(...Object.values({ ...base, ...patch })).run();
  await engine.exec('SET ROLE service_role');
  for (const patch of [
    { case_id: '' }, { case_id: 'bad case' }, { actor_key: 'member:' }, { actor_key: 'admin:other' },
    { command_id: 'short' }, { command_id: 'bad command' }, { fingerprint: 'A'.repeat(64) },
    { slot: 'other' }, { file_id: 'bad/id' }, { storage_key: 'consulting-flow/wrong' },
    { original_name: '' }, { original_name: '가'.repeat(301) }, { content_type: '' },
    { size_bytes: 0 }, { size_bytes: 1.5 }, { size_bytes: MAX_FLOW_UPLOAD_BYTES + 1 },
    { purpose: 'source_archived' }, { slot: 'audio' }, { intake_file_id: 'partial' },
    { created_at: '2026-02-30T00:00:00.000Z' }, { created_at: '2026-09-09T13:00:00Z' }, { status: 'ready' },
  ]) await assert.rejects(insert(patch), /OPERATION_FAILED/, JSON.stringify(patch));
  assert.equal(await db.prepare('SELECT count(*) AS n FROM consulting_flow_upload_command_keys').first('n'), 0);
  await insert({ purpose: 'recording', original_name: 'synthetic.txt', content_type: 'text/plain' });
  await assert.rejects(insert({ slot: 'audio', file_id: 'audio', storage_key: 'consulting-flow/audio', purpose: 'recording',
    original_name: 'synthetic.mp3', content_type: 'audio/mpeg', fingerprint: 'c'.repeat(64) }), /OPERATION_FAILED/);
  await insert({ slot: 'audio', file_id: 'audio', storage_key: 'consulting-flow/audio', purpose: 'recording',
    original_name: 'synthetic.mp3', content_type: 'audio/mpeg' });
  await assert.rejects(insert({ command_id: 'competing-command', file_id: 'competing', storage_key: 'consulting-flow/competing' }), /OPERATION_FAILED/);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM consulting_flow_upload_command_keys').first('n'), 1);
  await assert.rejects(db.prepare("UPDATE consulting_flow_upload_command_keys SET fingerprint=?1").bind('d'.repeat(64)).run(), /OPERATION_FAILED/);
  await assert.rejects(db.prepare("UPDATE consulting_flow_upload_requests SET original_name='changed.txt'").run(), /OPERATION_FAILED/);
  for (const table of ['consulting_flow_upload_requests', 'consulting_flow_upload_command_keys']) {
    await assert.rejects(db.prepare(`DELETE FROM ${table}`).run(), /OPERATION_FAILED/);
    await assert.rejects(engine.exec(`TRUNCATE partner_hub.${table}`), /permission denied/);
  }
});

void test('PostgreSQL FLOW file claims, completion and pending promotion commit atomically using application SQL', async (t) => {
  const fixture = await postgresRuntimeFixture(t);
  const { db, engine } = fixture;
  await ledgerHarness(fixture);
  await engine.exec('SET ROLE service_role');
  const item = file();
  await reserveFlowUploads(request([{ slot: 'file', file: item }]));
  await assert.rejects(db.batch([...commitLedgerRows(db, [item]), db.prepare('INSERT INTO consulting_flow_file_object_checksums VALUES (?1,?2)').bind(item.id, sha)]), /OPERATION_FAILED/);
  for (const table of ['consulting_flows','consulting_flow_file_owners','consulting_flow_file_metadata',
    'consulting_flow_file_object_integrity','consulting_flow_file_object_checksums','consulting_flow_upload_completions'])
    assert.equal(await db.prepare(`SELECT count(*) AS n FROM ${table}`).first('n'), 0);
  assert.equal(await db.prepare('SELECT status FROM consulting_flow_upload_requests').first('status'), 'pending');
  await db.batch(commitLedgerRows(db, [item])).catch(() => { throw fixture.lastQueryError(); });
  assert.equal(await db.prepare('SELECT status FROM consulting_flow_upload_requests').first('status'), 'ready');
  assert.deepEqual(await readFlowFileObjectIntegrity(caseId, item), { validationMode: 'etag', etag: 'synthetic-etag', contentType: 'application/pdf', sha256: sha });
  await assert.rejects(readFlowFileObjectIntegrity('other-case', item));
  for (const patch of [{ key: 'different-key' }, { name: 'different.pdf' }, { size: 5 }, { createdAt: later },
    { contentType: 'text/plain' }, { purpose: 'source_archived' }, { intakeFileId: 'unrecorded' }])
    await assert.rejects(readFlowFileObjectIntegrity(caseId, { ...item, ...patch }));
  await assert.rejects(reserveFlowUploads(request([{ slot: 'file', file: item }])));
  await assert.rejects(db.prepare("UPDATE consulting_flow_upload_requests SET status='pending'").run(), /OPERATION_FAILED/);
  for (const table of ['consulting_flow_file_owners','consulting_flow_file_object_integrity','consulting_flow_file_object_checksums','consulting_flow_upload_completions'])
    await assert.rejects(db.prepare(`UPDATE ${table} SET file_id=file_id`).run(), /OPERATION_FAILED/);
  await engine.exec('RESET ROLE');
  for (const table of ['consulting_flow_file_owners','consulting_flow_file_metadata','consulting_flow_file_object_integrity',
    'consulting_flow_file_object_checksums','consulting_flow_upload_requests','consulting_flow_upload_command_keys','consulting_flow_upload_completions']) {
    await assert.rejects(db.prepare(`DELETE FROM ${table}`).run(), /OPERATION_FAILED/);
    for (const role of ['anon','authenticated']) {
      await engine.exec(`SET ROLE ${role}`);
      await assert.rejects(engine.exec(`SELECT * FROM partner_hub.${table}`), /permission denied/);
      await engine.exec('RESET ROLE');
    }
  }
});

void test('PostgreSQL FLOW paired recording receipts bind both slots after a different command retry', async (t) => {
  const fixture = await postgresRuntimeFixture(t);
  const { db } = fixture;
  await ledgerHarness(fixture);
  const files = [file('transcript-file', { name: 'synthetic.txt', contentType: 'text/plain', purpose: 'recording' }),
    file('audio-file', { name: 'synthetic.mp3', contentType: 'audio/mpeg', purpose: 'recording' })];
  await reserveFlowUploads(request([{ slot: 'file', file: files[0] }, { slot: 'audio', file: files[1] }]));
  const retryId = 'synthetic-new-command';
  const state = snapshot(files, retryId);
  const badStates = [
    { ...state, commandIds: [commandId] },
    { ...state, commandReceipts: { [retryId]: { actorKey: 'member:other', fingerprint } } },
    { ...state, commandReceipts: { [retryId]: { actorKey, fingerprint: 'c'.repeat(64) } } },
    { ...state, recordings: [] },
    { ...state, recordings: [{ ...state.recordings[0], id: `${commandId}-recording` }] },
    { ...state, recordings: [{ ...state.recordings[0], fileId: 'wrong-file' }] },
    { ...state, recordings: [{ ...state.recordings[0], audioFileId: 'wrong-audio' }] },
  ];
  for (const changed of badStates) {
    await assert.rejects(db.batch(commitLedgerRows(db, files, JSON.stringify(changed), retryId)), /OPERATION_FAILED/);
    assert.equal(await db.prepare('SELECT count(*) AS n FROM consulting_flow_upload_completions').first('n'), 0);
    assert.equal(await db.prepare("SELECT count(*) AS n FROM consulting_flow_upload_requests WHERE status='pending'").first('n'), 2);
  }
  await db.batch(commitLedgerRows(db, files, JSON.stringify(state), retryId)).catch(() => { throw fixture.lastQueryError(); });
  assert.equal(await db.prepare("SELECT count(*) AS n FROM consulting_flow_upload_requests WHERE status='ready'").first('n'), 2);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM consulting_flow_upload_completions WHERE command_id=?1').bind(retryId).first('n'), 2);
});

void test('PostgreSQL FLOW imported source provenance and archive purpose preserve exact payload CAS and legacy metadata', async (t) => {
  const fixture = await postgresRuntimeFixture(t);
  const { db } = fixture;
  await ledgerHarness(fixture);
  const item = file('intake-copy', { intakeFileId: 'synthetic-original', intakeSourceHash: 'c'.repeat(64), sourceReviewedAt: time, sourceReviewedBy: '가상관리자' });
  await reserveFlowUploads(request([{ slot: 'file', file: item }]));
  const retried = await reserveFlowUploads(request([{ slot: 'file', file: { ...item, createdAt: later, sourceReviewedAt: later } }], { commandId: 'synthetic-retry-command' }));
  assert.deepEqual(retried.get('file'), item);
  const payload = JSON.stringify(snapshot([item]));
  await db.batch(commitLedgerRows(db, [item], payload)).catch(() => { throw fixture.lastQueryError(); });
  const archive = (expectedPayload: string, original = item) => db.prepare(flowFileLedgerSql(db).transitionPurpose).bind(
    original.id, caseId, original.key, original.name, original.contentType, original.size, original.createdAt, original.purpose,
    'source_archived', original.intakeFileId ?? null, original.intakeSourceHash ?? null, original.sourceReviewedAt ?? null, original.sourceReviewedBy ?? null, 1, expectedPayload);
  await assert.rejects(archive(`${payload} `).run(), /OPERATION_FAILED/);
  await assert.rejects(archive(payload, { ...item, intakeSourceHash: 'd'.repeat(64) }).run(), /OPERATION_FAILED/);
  await archive(payload).run();
  assert.equal(await db.prepare('SELECT purpose FROM consulting_flow_file_metadata WHERE file_id=?1').bind(item.id).first('purpose'), 'source_archived');
  await assert.rejects(db.prepare("UPDATE consulting_flow_file_metadata SET purpose='source' WHERE file_id=?1").bind(item.id).run(), /OPERATION_FAILED/);
  await assert.rejects(db.prepare("UPDATE consulting_flow_file_metadata SET intake_file_id=NULL WHERE file_id=?1").bind(item.id).run(), /OPERATION_FAILED/);
  const legacy = file('legacy-file');
  await db.batch([
    db.prepare('INSERT INTO consulting_flow_file_owners VALUES (?1,?2,?3,?4)').bind(legacy.id,caseId,legacy.key,time),
    db.prepare('INSERT INTO consulting_flow_file_metadata (file_id,original_name,content_type,size_bytes,purpose) VALUES (?1,?2,?3,?4,?5)').bind(legacy.id,legacy.name,legacy.contentType,legacy.size,legacy.purpose),
    db.prepare("INSERT INTO consulting_flow_file_object_integrity VALUES (?1,'metadata',NULL,?2)").bind(legacy.id,legacy.contentType),
  ]);
  assert.deepEqual(await readFlowFileObjectIntegrity(caseId, legacy), { validationMode: 'metadata', etag: null, contentType: legacy.contentType, sha256: null });
  await assert.rejects(db.prepare("INSERT INTO consulting_flow_file_object_integrity VALUES ('null-etag','etag',NULL,'application/pdf')").run(), /OPERATION_FAILED/);
});

void test('PostgreSQL FLOW ready promotion rejects malformed or partial payload proof without retaining partial rows', async (t) => {
  const fixture = await postgresRuntimeFixture(t);
  const { db } = fixture;
  await ledgerHarness(fixture);
  const item = file();
  await reserveFlowUploads(request([{ slot: 'file', file: item }]));
  const state = snapshot([item]);
  const badStates = [
    { ...state, files: null }, { ...state, files: {} }, { ...state, files: [] }, { ...state, files: [item,item] },
    ...[{ name: 'wrong.pdf' }, { size: '4' }, { purpose: 'report' }, { createdAt: later }, { intakeFileId: null }]
      .map((patch) => ({ ...state, files: [{ ...item, ...patch }] })),
    { ...state, commandIds: [commandId,commandId] },
  ];
  for (const changed of badStates) {
    await assert.rejects(db.batch(commitLedgerRows(db, [item], JSON.stringify(changed))), /OPERATION_FAILED/);
    assert.equal(await db.prepare('SELECT count(*) AS n FROM consulting_flow_file_owners').first('n'), 0);
  }
  const duplicate = JSON.stringify(state).replace('"files":', '"files":[],"files":');
  await assert.rejects(db.batch(commitLedgerRows(db, [item], duplicate)), /OPERATION_FAILED/);
  const writes = commitLedgerRows(db, [item]);
  // Remove just the checksum claim; completion alone must not make it ready.
  await assert.rejects(db.batch(writes.filter((_, index) => index !== 4)), /OPERATION_FAILED/);
  assert.equal(await db.prepare('SELECT status FROM consulting_flow_upload_requests').first('status'), 'pending');
});

void test('remote FLOW file rollback probe runs without creating a root or keeping business rows', async (t) => {
  const { db, engine } = await postgresRuntimeFixture(t);
  await engine.exec(await readFile(new URL('./supabase-flow-files-rollback.sql', import.meta.url), 'utf8'));
  for (const table of ['consulting_flow_file_owners','consulting_flow_file_metadata','consulting_flow_file_object_integrity',
    'consulting_flow_file_object_checksums','consulting_flow_upload_requests','consulting_flow_upload_command_keys','consulting_flow_upload_completions'])
    assert.equal(await db.prepare(`SELECT count(*) AS n FROM ${table}`).first('n'), 0);
});
