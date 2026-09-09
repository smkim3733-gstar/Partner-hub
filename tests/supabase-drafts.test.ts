import assert from 'node:assert/strict';
import { test } from 'node:test';
import { postgresFixture } from './supabase-postgres-fixture';
import { postgresRuntimeFixture, postgresTestOrigin as origin } from './supabase-runtime-fixture';
import { hashPassword } from '../lib/password-crypto';
import { emptyApplicationDetails } from '../lib/application-details';

const { GET, PUT, DELETE } = await import('../app/api/application-draft/route');
const { readPortalState, mutatePortalState } = await import('../lib/portal-state');
const { applicationDraftDatabase, assertNewDraftCases } = await import('../lib/application-draft-store');
const { requirePortalUser } = await import('../lib/portal-auth');
const { loginPassword } = await import('../lib/password-handlers');

async function draftResponse(response: Response) {
  return await response.json() as {
    revision: number;
    draft: { partnerMemberId: string; applicantName: string } | null;
  };
}

void test('PostgreSQL draft lifecycle preserves owner, exact revision, tombstones and schema guards', async (t) => {
  const f = await postgresFixture();
  t.after(f.close);
  const db = f.db;
  await db.prepare('INSERT INTO application_drafts VALUES (?1, 1, ?2, ?3, ?4)')
    .bind('member:test', 'draft-first-001', '{"draft":1}', '2026-09-09T00:00:00.000Z').run();
  for (const mutation of [
    "owner_key = 'member:other'",
    "revision = 3, payload = '{}'",
    "revision = 2, draft_id = 'another-live-id', payload = '{}'",
    'revision = 2',
    "revision = 2, payload = '[]'",
    "revision = 2, payload = '{}', updated_at = '2026-02-30T00:00:00.000Z'",
  ]) await assert.rejects(db.prepare(`UPDATE application_drafts SET ${mutation}`).run(), /OPERATION_FAILED/);
  await assert.rejects(db.prepare('DELETE FROM application_drafts').run(), /OPERATION_FAILED/);
  await db.prepare('UPDATE application_drafts SET revision = 2, payload = NULL').run();
  await assert.rejects(db.prepare("UPDATE application_drafts SET revision = 3, payload = '{}'").run(), /OPERATION_FAILED/);
  await db.prepare("UPDATE application_drafts SET revision = 3, draft_id = 'draft-second-002', payload = '{}'").run();
  assert.equal(await db.prepare('SELECT revision FROM application_drafts').first('revision'), 3);
  await assert.rejects(db.prepare("INSERT INTO application_drafts VALUES ('member:peer', 1, 'draft-null-001', NULL, '2026-09-09T00:00:00.000Z')").run(), /OPERATION_FAILED/);
  await assert.rejects(db.prepare("INSERT INTO application_drafts VALUES ('member:peer', 1, 'draft-second-002', '{}', '2026-09-09T00:00:00.000Z')").run(), /OPERATION_FAILED/);
  assert.equal(await db.prepare('SELECT partner_hub.assert_draft_schema() AS ready').first('ready'), 1);
  await f.engine.exec('ALTER TABLE partner_hub.application_drafts DISABLE TRIGGER application_drafts_guard');
  await assert.rejects(db.prepare('SELECT partner_hub.assert_draft_schema() AS ready').first(), /OPERATION_FAILED/);
});

void test('PostgreSQL draft HTTP routes isolate accounts, preserve retries and enforce submission revision', async (t) => {
  const { db } = await postgresRuntimeFixture(t);
  const permissions = { collaborationApply: true, ownCases: true, fileUpload: true, quoteContract: false, sharedSchedule: true };
  const members = ['draft-owner', 'draft-peer'].map((id) => ({
    id, name: `가상 ${id}`, email: `${id}@example.test`, status: '활성', permissions,
  }));
  // Exercise the PostgreSQL null-parameter type in initial portal CAS as well.
  await mutatePortalState(() => ({ version: 1, consultationNumber: 0, members,
    cases: [], tasks: [], timeline: [], schedule: [], companyDocuments: [] }));
  const password = 'Synthetic PostgreSQL draft password!';
  const request = (method: string, body?: unknown, cookie = '') => new Request(`${origin}/api/application-draft`, {
    method, headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const cookies: string[] = [];
  for (const member of members) {
    await db.prepare('INSERT INTO portal_password_accounts VALUES (?1, ?2, ?3, ?4, ?5, ?5)')
      .bind(member.id, member.email, hashPassword(password), `credential-${member.id}`, new Date().toISOString()).run();
    const response = await loginPassword(request('POST', { email: member.email, password }));
    assert.equal(response.status, 200, await response.clone().text());
    cookies.push(response.headers.get('set-cookie')!.split(';')[0]);
  }
  const draft = { companyName: '가상 작성 중 기업', applicantName: '입력된 이름', applicantType: '한기평 컨설턴트',
    partnerMemberId: 'untrusted', selectedServices: ['정책자금'], details: emptyApplicationDetails(), step: 2, hasLocalAttachments: true };
  const body = (revision: number, draftId = 'postgres-draft-001') => ({ revision, draftId, draft, expectedUserId: 'password:draft-owner' });
  assert.equal((await GET(request('GET'))).status, 401);
  assert.equal((await draftResponse(await GET(request('GET', undefined, cookies[0])))).revision, 0);
  const created = await PUT(request('PUT', body(0), cookies[0]));
  assert.equal(created.status, 200, await created.clone().text());
  const saved = await draftResponse(created);
  assert.equal(saved.revision, 1);
  assert.equal(saved.draft?.partnerMemberId, members[0].id);
  assert.equal(saved.draft?.applicantName, members[0].name);
  assert.equal((await draftResponse(await PUT(request('PUT', body(0), cookies[0])))).revision, 1, 'same content retry is stable');
  assert.equal((await draftResponse(await GET(request('GET', undefined, cookies[1])))).draft, null);
  assert.equal((await PUT(request('PUT', body(0), cookies[1]))).status, 403);
  const altered = { ...body(0), draft: { ...draft, companyName: '다른 기업' } };
  assert.equal((await PUT(request('PUT', altered, cookies[0]))).status, 409);
  const wrongOrigin = request('PUT', body(1), cookies[0]);
  wrongOrigin.headers.set('origin', 'https://other.example.test');
  assert.equal((await PUT(wrongOrigin)).status, 403);
  assert.equal((await DELETE(request('DELETE', body(1), cookies[0]))).status, 200);
  assert.equal((await PUT(request('PUT', body(2), cookies[0]))).status, 409, 'same tombstoned ID cannot revive');
  assert.equal((await PUT(request('PUT', body(2, 'postgres-draft-002'), cookies[0]))).status, 200);
  const state = await readPortalState();
  const owner = await requirePortalUser(request('GET', undefined, cookies[0]), state);
  const peer = await requirePortalUser(request('GET', undefined, cookies[1]), state);
  const next = { ...(state as Record<string, unknown>), cases: [{ id: 'case-draft-postgres-draft-002', applicationDraftRevision: 3 }] };
  const guard = (await assertNewDraftCases(state, next, owner))!;
  await assert.rejects(assertNewDraftCases(state, next, peer), { status: 403 });
  await (await applicationDraftDatabase()).prepare('UPDATE application_drafts SET revision = 4, payload = ?1 WHERE owner_key = ?2')
    .bind(JSON.stringify({ ...draft, step: 3 }), guard.ownerKey).run();
  await assert.rejects(mutatePortalState(() => next, () => guard), { kind: 'cas_exhausted' });
  assert.deepEqual(await readPortalState(), state, 'stale draft cannot commit a case');
  assert.equal(await db.prepare('SELECT revision FROM application_drafts WHERE owner_key = ?1').bind(guard.ownerKey).first('revision'), 4);
});
