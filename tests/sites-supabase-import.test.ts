import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { test, type TestContext } from 'node:test';
import { newConsultingFlow } from '../lib/consulting-flow';
import { emptyApplicationDetails } from '../lib/application-details';
import { PORTAL_OWNER_EMAIL } from '../lib/member-email';
import { manualFlowCommand } from './supabase-flow-manual-fixture';
import { postgresFixture } from './supabase-postgres-fixture';
import {
  createSitesSupabaseImportPlan,
  applySitesSupabaseImport,
  sitesImportAppOrigin,
  sitesImportProjectRef,
} from '../scripts/sites-supabase-import-plan.mjs';

const stamp = '2026-09-11T00:00:00.000Z';
const marker = 'PRIVATE-SOURCE-MUST-NOT-APPEAR-IN-REPORTS';
const sourceMigrations = readdirSync(new URL('../drizzle/', import.meta.url))
  .filter((name) => /^\d.*\.sql$/.test(name))
  .sort((a, b) => a.localeCompare(b))
  .map((name) =>
    readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'),
  );
const hash = (path: string) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

function sourceFixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'partner-hub-import-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'source.sqlite');
  const state = {
    version: 1,
    consultationNumber: 1,
    members: [
      {
        id: 'preserved-partner',
        name: '원본담당',
        email: 'source@example.invalid',
        status: '활성',
        permissions: {
          ownCases: true,
          collaborationApply: true,
          fileUpload: true,
          quoteContract: false,
          sharedSchedule: true,
        },
      },
    ],
    cases: [
      {
        id: 'preserved-case',
        company: '원본기업',
        trainee: '원본담당',
        partnerMemberId: 'preserved-partner',
      },
    ],
    tasks: [],
    timeline: [],
    schedule: [],
    companyDocuments: [],
  };
  const draft = {
    companyName: '원본기업',
    applicantName: '원본담당',
    applicantType: '한기평 컨설턴트',
    partnerMemberId: 'preserved-partner',
    selectedServices: ['정책자금'],
    details: { ...emptyApplicationDetails(), message: marker },
    step: 1,
    hasLocalAttachments: false,
  };
  const baseline = newConsultingFlow(
    'preserved-case',
    '원본기업',
    'preserved-partner',
    '원본담당',
  );
  const final = manualFlowCommand(
    baseline,
    { type: 'save_source', sourceText: marker.repeat(8), privacyMasked: true },
    { id: 'source-admin', role: 'admin', name: '김성민 대표' },
    'preserved-command',
    stamp,
  ).proposed;
  const portalText = JSON.stringify(state, null, 2) + '\n';
  const draftText = JSON.stringify(draft, null, 1) + '\n';
  const flowText = JSON.stringify(final, null, 2) + '\n';
  const db = new DatabaseSync(path);
  for (const sql of sourceMigrations) db.exec(sql);
  db.exec('BEGIN');
  db.prepare('INSERT INTO portal_state VALUES(?,?,?)').run(
    'keve-partner-hub',
    portalText,
    stamp,
  );
  db.prepare('INSERT INTO application_drafts VALUES(?,?,?,?,?)').run(
    `admin:${PORTAL_OWNER_EMAIL}`,
    1,
    'preserved-draft-1',
    draftText,
    stamp,
  );
  db.prepare('INSERT INTO consulting_flows VALUES(?,?,?,?,?)').run(
    final.caseId,
    final.partnerId,
    0,
    JSON.stringify(baseline),
    '',
  );
  db.prepare(
    'UPDATE consulting_flows SET revision=1,payload=?,updated_at=? WHERE case_id=?',
  ).run(flowText, stamp, final.caseId);
  db.prepare(
    'INSERT INTO portal_chatgpt_identity_bindings VALUES(?,?,?,?,?)',
  ).run('owner', 'primary', 'a'.repeat(64), stamp, stamp);
  db.exec('COMMIT');
  db.close();
  return { path, portalText, draftText, flowText, final, state, draft };
}

// Only corrupt synthetic fixtures; restore the exact trusted trigger definitions
// so the importer must detect bad data rather than just a different schema.
function corruptFixture(path: string, edit: (db: DatabaseSync) => void) {
  const db = new DatabaseSync(path);
  const triggers = db
    .prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger'")
    .all() as { name: string; sql: string }[];
  db.exec('BEGIN');
  for (const row of triggers) db.exec(`DROP TRIGGER "${row.name}"`);
  edit(db);
  for (const row of triggers) db.exec(row.sql);
  db.exec('COMMIT');
  db.close();
}

async function targetFixture(
  t: TestContext,
  hook?: (query: string) => void | Promise<void>,
) {
  const fixture = await postgresFixture({ flowRoot: true });
  t.after(() => fixture.close());
  const client = {
    async begin(
      callback: (tx: {
        unsafe: (
          query: string,
          values?: unknown[],
        ) => Promise<Record<string, unknown>[]>;
      }) => Promise<void>,
    ) {
      return fixture.engine.transaction(async (tx) =>
        callback({
          async unsafe(query, values = []) {
            await hook?.(query);
            return (await tx.query<Record<string, unknown>>(query, values))
              .rows;
          },
        }),
      );
    },
  };
  return { ...fixture, client };
}

const confirmation = (plan: { sourceFileSha256: string }) => ({
  appOrigin: sitesImportAppOrigin,
  projectRef: sitesImportProjectRef,
  confirmedOrigin: sitesImportAppOrigin,
  sourceFileSha256: plan.sourceFileSha256,
  sourcePreservedAndFrozen: true,
  sourceStorageInventoryEmpty: true,
  backendEnabled: '0',
});

void test('scoped plan preserves source bytes and excludes Sites identity without leaking private data', async (t) => {
  const source = sourceFixture(t);
  const before = hash(source.path);
  const plan = await createSitesSupabaseImportPlan(source.path);
  assert.equal(plan.importedRows, 3);
  assert.equal(plan.sourceRows, 4);
  assert.equal(plan.sourceFileSha256, before);
  assert.equal(plan.migrationReady, false);
  assert.equal(
    plan.exclusions.reduce(
      (n: number, entry: { rows: number }) => n + entry.rows,
      0,
    ),
    1,
  );
  assert.doesNotMatch(
    JSON.stringify(plan),
    new RegExp(marker + '|source@example|원본기업|preserved-command'),
  );
  assert.equal(hash(source.path), before);
});

void test('actual PostgreSQL guards restore exact revision-one source text and preserve existing target authentication', async (t) => {
  const source = sourceFixture(t);
  const before = hash(source.path);
  const plan = await createSitesSupabaseImportPlan(source.path);
  const target = await targetFixture(t);
  await target.engine.query(
    "INSERT INTO partner_hub.standalone_admin_accounts VALUES('primary-admin',$1,'김성민 대표','private-password-hash','target-v1',1,$2,$2)",
    [PORTAL_OWNER_EMAIL, stamp],
  );
  await target.engine.query(
    "INSERT INTO partner_hub.standalone_admin_audit VALUES('target-audit','primary-admin','provision',$1)",
    [stamp],
  );
  await target.engine.query(
    "INSERT INTO partner_hub.portal_auth_limits VALUES('private-auth-limit',1,123456789)",
  );
  const authBefore = (
    await target.engine.query(
      'SELECT * FROM partner_hub.standalone_admin_accounts',
    )
  ).rows;
  const result = await applySitesSupabaseImport(
    plan,
    target.client,
    confirmation(plan),
  );
  assert.equal(result.targetWritten, true);
  assert.equal(result.authPreserved, true);
  assert.equal(result.activationPerformed, false);
  assert.equal(result.migrationReady, false);
  assert.equal(
    (
      await target.engine.query<{ payload: string }>(
        'SELECT payload FROM partner_hub.portal_state',
      )
    ).rows[0].payload,
    source.portalText,
  );
  assert.equal(
    (
      await target.engine.query<{ payload: string }>(
        'SELECT payload FROM partner_hub.application_drafts',
      )
    ).rows[0].payload,
    source.draftText,
  );
  const flow = (
    await target.engine.query<{ payload: string; revision: bigint }>(
      'SELECT payload,revision FROM partner_hub.consulting_flows',
    )
  ).rows[0];
  assert.equal(flow.payload, source.flowText);
  assert.equal(flow.revision, BigInt(1));
  assert.deepEqual(
    JSON.parse(flow.payload).commandReceipts,
    source.final.commandReceipts,
  );
  assert.deepEqual(
    (
      await target.engine.query(
        'SELECT * FROM partner_hub.standalone_admin_accounts',
      )
    ).rows,
    authBefore,
  );
  assert.equal(
    (
      await target.engine.query<{ n: bigint }>(
        'SELECT count(*) AS n FROM partner_hub.portal_chatgpt_identity_bindings',
      )
    ).rows[0].n,
    BigInt(0),
  );
  assert.equal(hash(source.path), before);
  // Exact repeat must not manufacture another command or overwrite live data.
  await assert.rejects(
    () => applySitesSupabaseImport(plan, target.client, confirmation(plan)),
    /target-business-data-not-empty/,
  );
  assert.equal(
    (
      await target.engine.query<{ payload: string }>(
        'SELECT payload FROM partner_hub.consulting_flows',
      )
    ).rows[0].payload,
    source.flowText,
  );
});

void test('injected failure after transient baseline rolls back all business rows without changing auth', async (t) => {
  const source = sourceFixture(t);
  const plan = await createSitesSupabaseImportPlan(source.path);
  const target = await targetFixture(t, (query) => {
    if (query.startsWith('UPDATE partner_hub.consulting_flows'))
      throw new Error(marker);
  });
  await assert.rejects(
    () => applySitesSupabaseImport(plan, target.client, confirmation(plan)),
    /target-import-failed-or-outcome-unknown/,
  );
  for (const table of [
    'portal_state',
    'application_drafts',
    'consulting_flows',
  ])
    assert.equal(
      (
        await target.engine.query<{ n: bigint }>(
          `SELECT count(*) AS n FROM partner_hub.${table}`,
        )
      ).rows[0].n,
      BigInt(0),
    );
});

void test('source file changes before or during target transaction are rejected without committed writes', async (t) => {
  for (const timing of ['before', 'during']) {
    const source = sourceFixture(t);
    const plan = await createSitesSupabaseImportPlan(source.path);
    const mutate = () =>
      writeFileSync(
        source.path,
        Buffer.concat([readFileSync(source.path), Buffer.from('changed')]),
      );
    const target = await targetFixture(t, (query) => {
      if (
        timing === 'during' &&
        query.startsWith('INSERT INTO partner_hub.application_drafts')
      )
        mutate();
    });
    if (timing === 'before') mutate();
    await assert.rejects(
      () => applySitesSupabaseImport(plan, target.client, confirmation(plan)),
      /source-changed-since-plan/,
    );
    assert.equal(
      (
        await target.engine.query<{ n: bigint }>(
          'SELECT count(*) AS n FROM partner_hub.portal_state',
        )
      ).rows[0].n,
      BigInt(0),
    );
  }
});

void test('source higher revision, missing full snapshot rows, attachments, duplicate JSON and wrong identity fail closed', async (t) => {
  const corruptions: Array<
    (source: ReturnType<typeof sourceFixture>, db: DatabaseSync) => void
  > = [
    (_source, db) => db.exec('UPDATE application_drafts SET revision=2'),
    (source, db) =>
      db
        .prepare('UPDATE consulting_flows SET revision=2,payload=?')
        .run(JSON.stringify({ ...source.final, revision: 2 })),
    (_source, db) => db.exec('DELETE FROM portal_state'),
    (source, db) =>
      db
        .prepare('UPDATE application_drafts SET payload=?')
        .run(JSON.stringify({ ...source.draft, hasLocalAttachments: true })),
    (_source, db) =>
      db
        .prepare('UPDATE portal_state SET payload=?')
        .run('{"version":1,"version":2}'),
    (_source, db) =>
      db
        .prepare('UPDATE application_drafts SET owner_key=?')
        .run('admin:someone-else@example.invalid'),
    (_source, db) =>
      db
        .prepare('INSERT INTO portal_password_sessions VALUES(?,?,?,?,?)')
        .run(
          'private-session',
          'preserved-partner',
          'source@example.invalid',
          'v1',
          123,
        ),
  ];
  for (const corruption of corruptions) {
    const source = sourceFixture(t);
    corruptFixture(source.path, (db) => corruption(source, db));
    await assert.rejects(() => createSitesSupabaseImportPlan(source.path));
  }
});

void test('one-command malformed effect is rejected by actual PostgreSQL guard without a bypass path', async (t) => {
  const source = sourceFixture(t);
  corruptFixture(source.path, (db) =>
    db.prepare('UPDATE consulting_flows SET payload=?').run(
      JSON.stringify({
        ...source.final,
        ai: { ...source.final.ai, enabled: true },
      }),
    ),
  );
  const plan = await createSitesSupabaseImportPlan(source.path);
  const target = await targetFixture(t);
  await assert.rejects(
    () => applySitesSupabaseImport(plan, target.client, confirmation(plan)),
    /source-flow-transition-not-restorable/,
  );
  assert.equal(
    (
      await target.engine.query<{ n: bigint }>(
        'SELECT count(*) AS n FROM partner_hub.consulting_flows',
      )
    ).rows[0].n,
    BigInt(0),
  );
});

void test('legacy owner policy receipt is enriched only from its unique audit while every other source value stays intact', async (t) => {
  const source = sourceFixture(t);
  const baseline = newConsultingFlow(
    'preserved-case',
    '원본기업',
    'preserved-partner',
    '원본담당',
  );
  const legacy = manualFlowCommand(
    baseline,
    {
      type: 'set_ai_policy',
      enabled: true,
      thirdPartyConsent: true,
      privacyMasked: true,
      costConsent: true,
    },
    { id: 'source-admin', role: 'admin', name: '김성민 대표' },
    'legacy-command',
    stamp,
  ).proposed;
  legacy.commandReceipts = {
    'legacy-command': {
      actorKey: `admin:${PORTAL_OWNER_EMAIL}`,
      fingerprint: 'a'.repeat(64),
    },
  };
  const legacyText = JSON.stringify(legacy, null, 2) + '\n';
  corruptFixture(source.path, (db) =>
    db.prepare('UPDATE consulting_flows SET payload=?').run(legacyText),
  );
  const sourceHash = hash(source.path);
  const plan = await createSitesSupabaseImportPlan(source.path);
  assert.equal(plan.transformations.length, 1);
  assert.equal(plan.draftOwnerMapping, 'unchanged');
  assert.notEqual(plan.flowPayloadSha256.source, plan.flowPayloadSha256.target);
  assert.doesNotMatch(JSON.stringify(plan), /legacy-command|smkim3733|김성민/);
  const target = await targetFixture(t);
  await applySitesSupabaseImport(plan, target.client, confirmation(plan));
  const text = (
    await target.engine.query<{ payload: string }>(
      'SELECT payload FROM partner_hub.consulting_flows',
    )
  ).rows[0].payload;
  const imported = JSON.parse(text);
  const original = JSON.parse(legacyText);
  assert.deepEqual(imported.commandReceipts['legacy-command'], {
    actorKey: 'admin:primary',
    fingerprint: 'a'.repeat(64),
    actor: original.audit[0].actor,
    action: original.audit[0].action,
  });
  delete imported.commandReceipts;
  delete original.commandReceipts;
  assert.deepEqual(imported, original);
  const oldReceipt = JSON.stringify(
    legacy.commandReceipts['legacy-command'],
    null,
    2,
  )
    .split('\n')
    .map((line, index) => (index ? '    ' + line : line))
    .join('\n');
  const expectedReceipt = JSON.stringify({
    actorKey: 'admin:primary',
    fingerprint: 'a'.repeat(64),
    actor: '김성민 대표',
    action: 'set_ai_policy',
  });
  assert.equal(text, legacyText.replace(oldReceipt, expectedReceipt));
  assert.equal(hash(source.path), sourceHash);
});

void test('legacy receipt conversion rejects foreign identities, ambiguous audit and invented evidence', async (t) => {
  for (const mutation of [
    'foreign-owner',
    'wrong-audit-id',
    'wrong-actor',
    'different-action',
    'extra-receipt-field',
  ]) {
    const source = sourceFixture(t);
    const legacy = manualFlowCommand(
      newConsultingFlow(
        'preserved-case',
        '원본기업',
        'preserved-partner',
        '원본담당',
      ),
      {
        type: 'set_ai_policy',
        enabled: true,
        thirdPartyConsent: true,
        privacyMasked: true,
        costConsent: true,
      },
      { id: 'source-admin', role: 'admin', name: '김성민 대표' },
      'legacy-command',
      stamp,
    ).proposed;
    const receipt: Record<string, string> = {
      actorKey: `admin:${PORTAL_OWNER_EMAIL}`,
      fingerprint: 'a'.repeat(64),
    };
    legacy.commandReceipts = {
      'legacy-command': receipt as NonNullable<
        typeof legacy.commandReceipts
      >[string],
    };
    if (mutation === 'foreign-owner')
      receipt.actorKey = 'admin:foreign@example.invalid';
    if (mutation === 'wrong-audit-id') legacy.audit[0].id = 'different-command';
    if (mutation === 'wrong-actor') legacy.audit[0].actor = '다른 대표';
    if (mutation === 'different-action') legacy.audit[0].action = 'save_source';
    if (mutation === 'extra-receipt-field')
      receipt.targetId = 'invented-target';
    corruptFixture(source.path, (db) =>
      db
        .prepare('UPDATE consulting_flows SET payload=?')
        .run(JSON.stringify(legacy)),
    );
    await assert.rejects(() => createSitesSupabaseImportPlan(source.path));
  }
});

void test('target lock conflicts and browser schema access fail without importing or retrying', async (t) => {
  const source = sourceFixture(t);
  const plan = await createSitesSupabaseImportPlan(source.path);
  let lockAttempts = 0;
  const locked = await targetFixture(t, (query) => {
    if (query.startsWith('LOCK TABLE')) {
      lockAttempts++;
      throw Object.assign(new Error('lock timeout'), { code: '55P03' });
    }
  });
  await assert.rejects(
    () => applySitesSupabaseImport(plan, locked.client, confirmation(plan)),
    /target-import-failed-or-outcome-unknown/,
  );
  assert.equal(lockAttempts, 1);
  const unsafe = await targetFixture(t);
  await unsafe.engine.exec(
    'GRANT USAGE ON SCHEMA partner_hub TO authenticated',
  );
  await assert.rejects(
    () => applySitesSupabaseImport(plan, unsafe.client, confirmation(plan)),
    /target-browser-access-not-closed/,
  );
  assert.equal(
    (
      await unsafe.engine.query<{ n: bigint }>(
        'SELECT count(*) AS n FROM partner_hub.portal_state',
      )
    ).rows[0].n,
    BigInt(0),
  );
});

void test('wrong URL, project, source digest, missing freeze and enabled backend stop before a target transaction', async (t) => {
  const source = sourceFixture(t);
  const plan = await createSitesSupabaseImportPlan(source.path);
  let calls = 0;
  const client = {
    begin() {
      calls++;
      throw new Error('must-not-connect');
    },
  };
  for (const override of [
    { confirmedOrigin: 'https://other.example.invalid' },
    { projectRef: 'abcdefghijklmnopqrst' },
    { sourceFileSha256: '0'.repeat(64) },
    { sourcePreservedAndFrozen: false },
    { sourceStorageInventoryEmpty: false },
    { backendEnabled: '1' },
  ])
    await assert.rejects(() =>
      applySitesSupabaseImport(plan, client, {
        ...confirmation(plan),
        ...override,
      }),
    );
  await assert.rejects(
    () => applySitesSupabaseImport({ ...plan }, client, confirmation(plan)),
    /unrecognized-import-plan/,
  );
  assert.equal(calls, 0);
});

void test('unknown COMMIT outcome is redacted and never automatically retried', async (t) => {
  const source = sourceFixture(t);
  const plan = await createSitesSupabaseImportPlan(source.path);
  let attempts = 0;
  const client = {
    async begin() {
      attempts++;
      throw new Error('postgres://secret ' + marker);
    },
  };
  await assert.rejects(
    () => applySitesSupabaseImport(plan, client, confirmation(plan)),
    (error: Error) =>
      error.message === 'target-import-failed-or-outcome-unknown',
  );
  assert.equal(attempts, 1);
});

void test('operator CLI plan is read-only and apply rejects pipes without exposing source text', (t) => {
  const source = sourceFixture(t);
  const before = hash(source.path);
  const plan = spawnSync(
    process.execPath,
    ['scripts/import-sites-supabase.mjs', 'plan', source.path],
    { encoding: 'utf8' },
  );
  assert.equal(plan.status, 0, plan.stderr);
  assert.doesNotMatch(
    plan.stdout + plan.stderr,
    new RegExp(marker + '|source@example'),
  );
  const apply = spawnSync(
    process.execPath,
    ['scripts/import-sites-supabase.mjs', 'apply', source.path, before],
    { encoding: 'utf8', input: sitesImportAppOrigin },
  );
  assert.equal(apply.status, 1);
  assert.match(apply.stderr, /interactive-terminal-required/);
  assert.equal(hash(source.path), before);
});
