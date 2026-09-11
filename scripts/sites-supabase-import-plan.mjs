import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { newConsultingFlow } from '../lib/consulting-flow.ts';
import { hasStoredConsultingFlowStructure } from '../lib/consulting-flow-shape.ts';
import { parseApplicationDraft } from '../lib/application-draft.ts';
import { caseRecordStateError } from '../lib/case-record-integrity.ts';
import { relatedRecordStateError } from '../lib/related-record-integrity.ts';
import { timelineRecordStateError } from '../lib/timeline-record-integrity.ts';
import { operationalRecordStateError } from '../lib/operational-record-integrity.ts';
import { diagnosisAssessmentStateError } from '../lib/diagnosis-assessment.ts';
import {
  PORTAL_OWNER_EMAIL,
  isValidLoginEmail,
  normalizeLoginEmail,
} from '../lib/member-email.ts';
import {
  readSitesImportSource,
  importRequired,
  SitesImportError,
} from './sites-supabase-import-source.mjs';

export { SitesImportError } from './sites-supabase-import-source.mjs';
export const sitesImportAppOrigin = 'https://partner-hub-gamma-five.vercel.app';
export const sitesImportProjectRef = 'yievsveuxjnbygatvjtb';
const plans = new WeakMap();
const payloadHash = (payload) =>
  createHash('sha256').update(payload, 'utf8').digest('hex');
const preservedAuth = [
  'standalone_admin_accounts',
  'standalone_admin_sessions',
  'standalone_admin_audit',
  'standalone_admin_recovery_audit',
  'portal_auth_limits',
];
const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value);
const canonicalTime = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;

// Locate one object in already-validated, duplicate-key-free JSON. Change only
// that receipt's bytes; every byte outside it (including audit text) is retained.
function replaceReceipt(payload, commandId, replacement) {
  let position = 0;
  let span;
  const whitespace = () => {
    while (/\s/.test(payload[position] ?? '') && position < payload.length)
      position++;
  };
  const string = () => {
    const start = position++;
    while (position < payload.length) {
      const char = payload[position++];
      if (char === '\\') position++;
      else if (char === '"') return JSON.parse(payload.slice(start, position));
    }
    throw new SitesImportError('source-json-span-invalid');
  };
  const value = (path, depth) => {
    importRequired(depth <= 100, 'source-json-depth-exceeded');
    whitespace();
    const start = position;
    if (payload[position] === '{') {
      position++;
      whitespace();
      while (payload[position] !== '}') {
        const key = string();
        whitespace();
        importRequired(payload[position++] === ':', 'source-json-span-invalid');
        value([...path, key], depth + 1);
        whitespace();
        if (payload[position] !== ',') break;
        position++;
        whitespace();
      }
      importRequired(payload[position++] === '}', 'source-json-span-invalid');
    } else if (payload[position] === '[') {
      position++;
      whitespace();
      let index = 0;
      while (payload[position] !== ']') {
        value([...path, index++], depth + 1);
        whitespace();
        if (payload[position] !== ',') break;
        position++;
        whitespace();
      }
      importRequired(payload[position++] === ']', 'source-json-span-invalid');
    } else if (payload[position] === '"') string();
    else {
      while (position < payload.length && !/[\s,}\]]/.test(payload[position]))
        position++;
    }
    if (
      path.length === 2 &&
      path[0] === 'commandReceipts' &&
      path[1] === commandId
    )
      span = [start, position];
  };
  value([], 0);
  whitespace();
  importRequired(
    position === payload.length && span,
    'source-json-span-invalid',
  );
  return (
    payload.slice(0, span[0]) +
    JSON.stringify(replacement) +
    payload.slice(span[1])
  );
}

function restoreLegacyOwnerReceipt(flow) {
  const stored = JSON.parse(flow.payload);
  const transformations = [];
  const commandId = stored.commandIds?.[0];
  const receipt = stored.commandReceipts?.[commandId];
  if (object(receipt) && receipt.actorKey === `admin:${PORTAL_OWNER_EMAIL}`) {
    const audit = stored.audit?.[0];
    importRequired(
      flow.revision === BigInt(1) &&
        stored.revision === 1 &&
        stored.commandIds?.length === 1 &&
        stored.audit?.length === 1 &&
        Object.keys(stored.commandReceipts).length === 1 &&
        Object.keys(receipt)
          .sort((a, b) => a.localeCompare(b))
          .join(',') === 'actorKey,fingerprint',
      'source-legacy-receipt-ambiguous',
    );
    importRequired(
      audit?.id === commandId &&
        audit.actor === '김성민 대표' &&
        audit.action === 'set_ai_policy' &&
        audit.at === flow.updated_at &&
        /^[a-f0-9]{64}$/.test(receipt.fingerprint),
      'source-legacy-receipt-evidence-invalid',
    );
    importRequired(
      stored.ai?.enabled === true && stored.ai.sourceText === '',
      'source-legacy-receipt-scope-invalid',
    );
    const replacement = {
      ...receipt,
      actorKey: 'admin:primary',
      actor: audit.actor,
      action: audit.action,
    };
    const payload = replaceReceipt(flow.payload, commandId, replacement);
    transformations.push({
      table: 'consulting_flows',
      conversion: 'legacy-owner-receipt-v1',
      fields: [
        'single-receipt.actorKey',
        'single-receipt.actor',
        'single-receipt.action',
      ],
      evidence: 'unique-command-id-matched-audit-and-fixed-owner',
      sourcePayloadSha256: payloadHash(flow.payload),
      targetPayloadSha256: payloadHash(payload),
    });
    return {
      flow: { ...flow, payload },
      stored: JSON.parse(payload),
      transformations,
    };
  }
  return { flow, stored, transformations };
}

function validatePortal(state) {
  importRequired(
    object(state) &&
      state.version === 1 &&
      Number.isSafeInteger(state.consultationNumber) &&
      state.consultationNumber >= 0,
    'source-portal-envelope-invalid',
  );
  for (const key of [
    'timeline',
    'schedule',
    'tasks',
    'companyDocuments',
    'cases',
    'members',
  ]) {
    importRequired(
      Array.isArray(state[key]) && state[key].every(object),
      'source-portal-collections-invalid',
    );
    if (key !== 'timeline')
      importRequired(
        state[key].every(
          (row) =>
            typeof row.id === 'string' &&
            row.id.trim() === row.id &&
            row.id.length > 0,
        ) &&
          new Set(state[key].map((row) => row.id)).size === state[key].length,
        'source-portal-identities-invalid',
      );
  }
  importRequired(
    state.membersRevision === undefined ||
      (Number.isSafeInteger(state.membersRevision) &&
        state.membersRevision >= 0),
    'source-member-revision-invalid',
  );
  importRequired(
    state.members.every((member) => isValidLoginEmail(member.email)) &&
      new Set(state.members.map((member) => normalizeLoginEmail(member.email)))
        .size === state.members.length,
    'source-member-email-ambiguous',
  );
  importRequired(
    caseRecordStateError(state.cases, state.members) === null &&
      timelineRecordStateError(state.timeline, state.cases) === null &&
      operationalRecordStateError(
        state.tasks,
        state.companyDocuments,
        state.schedule,
      ) === null &&
      relatedRecordStateError(
        state.tasks,
        state.companyDocuments,
        state.schedule,
        state.cases,
        state.members,
      ) === null &&
      diagnosisAssessmentStateError(state.diagnosisAssessments, state.cases) ===
        null,
    'source-portal-references-invalid',
  );
  // This scope imports no bytes. A file reference must not be orphaned merely
  // because the known file-ledger tables happen to contain zero rows.
  const references = (value) =>
    object(value)
      ? Object.entries(value).some(
          ([key, item]) =>
            (/^(?:fileId|fileIds|storageKey|audioFileId|attachmentIds)$/.test(
              key,
            ) &&
              item &&
              (!Array.isArray(item) || item.length > 0)) ||
            references(item),
        )
      : Array.isArray(value) && value.some(references);
  importRequired(
    !references(state),
    'source-file-references-require-full-import',
  );
}

export async function createSitesSupabaseImportPlan(sourcePath) {
  try {
    const source = await readSitesImportSource(sourcePath);
    const { portal_state: portal, application_drafts: draft } = source.rows;
    const { flow, stored, transformations } = restoreLegacyOwnerReceipt(
      source.rows.consulting_flows,
    );
    importRequired(
      portal.id === 'keve-partner-hub' &&
        canonicalTime(portal.updated_at) &&
        typeof portal.payload === 'string' &&
        Buffer.byteLength(portal.payload) <= 900000,
      'source-portal-row-invalid',
    );
    const state = JSON.parse(portal.payload);
    validatePortal(state);
    importRequired(
      draft.revision === BigInt(1) &&
        typeof draft.payload === 'string' &&
        /^[A-Za-z0-9-]{10,80}$/.test(draft.draft_id) &&
        canonicalTime(draft.updated_at),
      'source-draft-history-not-supported',
    );
    const draftValue = parseApplicationDraft(JSON.parse(draft.payload));
    importRequired(
      !draftValue.hasLocalAttachments,
      'source-draft-local-files-not-recoverable',
    );
    importRequired(
      draft.owner_key === `admin:${PORTAL_OWNER_EMAIL}` ||
        state.members.some(
          (member) => draft.owner_key === `member:${member.id}`,
        ),
      'source-draft-owner-unresolved',
    );
    importRequired(
      flow.revision === BigInt(1) &&
        stored.revision === 1 &&
        stored.commandIds?.length === 1 &&
        stored.audit?.length === 1 &&
        hasStoredConsultingFlowStructure(stored),
      'source-flow-history-not-supported',
    );
    const commandId = stored.commandIds[0];
    const receipt = stored.commandReceipts?.[commandId];
    const audit = stored.audit[0];
    importRequired(
      object(receipt) &&
        Object.keys(stored.commandReceipts).length === 1 &&
        audit.id === commandId &&
        receipt.actor === audit.actor &&
        receipt.action === audit.action &&
        typeof receipt.action === 'string' &&
        /^[a-f0-9]{64}$/.test(receipt.fingerprint) &&
        ((receipt.actorKey === 'admin:primary' &&
          receipt.actor === '김성민 대표') ||
          (receipt.actorKey === `member:${stored.partnerId}` &&
            receipt.actor === stored.partnerName)),
      'source-flow-receipt-identity-unresolved',
    );
    importRequired(
      stored.caseId === flow.case_id &&
        stored.partnerId === flow.partner_id &&
        stored.updatedAt === flow.updated_at &&
        canonicalTime(flow.updated_at),
      'source-flow-envelope-invalid',
    );
    importRequired(
      stored.files.length === 0 &&
        stored.recordings.length === 0 &&
        stored.jobs.length === 0,
      'source-flow-files-or-jobs-not-supported',
    );
    importRequired(
      state.cases.filter((row) => row.id === flow.case_id).length === 1 &&
        state.members.filter((row) => row.id === flow.partner_id).length === 1,
      'source-flow-assignment-unresolved',
    );
    const member = state.members.find((row) => row.id === flow.partner_id);
    const caseRow = state.cases.find((row) => row.id === flow.case_id);
    importRequired(
      member.name === stored.partnerName &&
        caseRow.partnerMemberId === flow.partner_id,
      'source-flow-assignment-mismatch',
    );
    const baseline = JSON.stringify(
      newConsultingFlow(
        stored.caseId,
        stored.company,
        stored.partnerId,
        stored.partnerName,
      ),
    );
    const summary = Object.freeze({
      format: 'partner-hub-sites-supabase-import-v1',
      scope: 'three-business-rows-revision-one-no-files',
      sourceFileSha256: source.fileSha256,
      sourceDataSha256: source.report.dataSha256,
      sourceSchemaSha256: source.report.schemaSha256,
      sourceRows: 4,
      importedRows: 3,
      exclusions: source.exclusions,
      transformations,
      draftOwnerMapping: 'unchanged',
      flowPayloadSha256: {
        source: payloadHash(source.rows.consulting_flows.payload),
        target: payloadHash(flow.payload),
      },
      migrationReady: false,
      targetWritten: false,
      unverified: [
        'source-export-provenance-and-write-freeze',
        'complete-source-storage-inventory',
        'target-schema-and-guard-validation',
        'standalone-login-and-vercel-cutover',
      ],
    });
    plans.set(summary, {
      source,
      baseline,
      targetRows: { ...source.rows, consulting_flows: flow },
    });
    return summary;
  } catch (error) {
    if (error instanceof SitesImportError) throw error;
    throw new SitesImportError('source-domain-validation-failed');
  }
}

async function expectedTargetTables() {
  const directory = new URL('../supabase/migrations/', import.meta.url);
  const names = (await readdir(directory))
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort((a, b) => a.localeCompare(b));
  importRequired(names.length === 19, 'target-migration-scope-changed');
  const tables = [];
  for (const name of names) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    for (const match of sql.matchAll(
      /create table (?:if not exists )?partner_hub\.([a-z_]+)\s*\(/gi,
    ))
      tables.push(match[1]);
  }
  importRequired(
    tables.length === 38 && new Set(tables).size === 38,
    'target-table-scope-changed',
  );
  return tables.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

async function authDigests(transaction) {
  const digests = [];
  for (const name of preservedAuth) {
    const rows = await transaction.unsafe(
      `SELECT encode(sha256(convert_to(coalesce(string_agg(row_value, E'\\n' ORDER BY row_value COLLATE "C"), ''), 'UTF8')), 'hex') AS digest FROM (SELECT row_to_json(t)::text AS row_value FROM partner_hub.${name} t) s`,
    );
    digests.push(rows[0].digest);
  }
  return digests.join(':');
}

// client is postgres.js (or an isolated test engine exposing its transaction
// protocol). All guards remain active. Source text is exact except for the
// explicitly reported, audit-backed legacy owner receipt conversion.
export async function applySitesSupabaseImport(plan, client, confirmation) {
  const internal = plans.get(plan);
  importRequired(internal, 'unrecognized-import-plan');
  importRequired(
    confirmation?.appOrigin === sitesImportAppOrigin &&
      confirmation.confirmedOrigin === sitesImportAppOrigin &&
      confirmation.projectRef === sitesImportProjectRef,
    'target-confirmation-mismatch',
  );
  importRequired(
    confirmation.sourceFileSha256 === plan.sourceFileSha256 &&
      confirmation.sourcePreservedAndFrozen === true &&
      confirmation.sourceStorageInventoryEmpty === true &&
      confirmation.backendEnabled === '0',
    'source-or-disabled-target-confirmation-required',
  );
  const { source, baseline, targetRows } = internal;
  const {
    portal_state: portal,
    application_drafts: draft,
    consulting_flows: flow,
  } = targetRows;
  await source.recheck();
  const tables = await expectedTargetTables();
  try {
    await client.begin(async (transaction) => {
      await transaction.unsafe('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      await transaction.unsafe("SET LOCAL statement_timeout TO '25000ms'");
      await transaction.unsafe("SET LOCAL lock_timeout TO '5000ms'");
      // Acquire write-excluding locks BEFORE the first SELECT pins the snapshot.
      // A writer that commits while we wait must be visible to the empty check.
      // No lock bypass, no retry after an unknown COMMIT outcome.
      await transaction.unsafe(
        'LOCK TABLE ' +
          tables.map((name) => `partner_hub.${name}`).join(',') +
          ' IN SHARE ROW EXCLUSIVE MODE',
      );
      const installed = await transaction.unsafe(
        "SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='partner_hub' AND c.relkind IN ('r','p') ORDER BY c.relname COLLATE \"C\"",
      );
      importRequired(
        JSON.stringify(installed.map((row) => row.relname)) ===
          JSON.stringify(tables) &&
          installed.every((row) => row.relrowsecurity),
        'target-schema-inventory-mismatch',
      );
      const roleAccess = await transaction.unsafe(
        "SELECT has_schema_privilege('anon','partner_hub','USAGE') AS anon_usage, has_schema_privilege('authenticated','partner_hub','USAGE') AS authenticated_usage",
      );
      importRequired(
        roleAccess[0].anon_usage === false &&
          roleAccess[0].authenticated_usage === false,
        'target-browser-access-not-closed',
      );
      for (const name of tables.filter(
        (name) => name !== 'schema_migrations' && !preservedAuth.includes(name),
      )) {
        const rows = await transaction.unsafe(
          `SELECT count(*)::text AS count FROM partner_hub.${name}`,
        );
        importRequired(rows[0].count === '0', 'target-business-data-not-empty');
      }
      const admin = await transaction.unsafe(
        'SELECT id,email,active FROM partner_hub.standalone_admin_accounts',
      );
      importRequired(
        admin.length <= 1 &&
          admin.every(
            (row) =>
              row.id === 'primary-admin' &&
              row.email === PORTAL_OWNER_EMAIL &&
              row.active === 1,
          ),
        'target-admin-identity-unexpected',
      );
      const originalAuth = await authDigests(transaction);
      for (const name of [
        'assert_auth_schema',
        'assert_portal_schema',
        'assert_draft_schema',
        'assert_consulting_flow_schema',
      ])
        await transaction.unsafe(`SELECT partner_hub.${name}() AS ready`);
      const valid = await transaction.unsafe(
        'SELECT partner_hub.flow_root_transition_valid($1,$2,$3,$4,$5,$6) AS valid',
        [
          baseline,
          flow.payload,
          flow.case_id,
          flow.partner_id,
          '1',
          flow.updated_at,
        ],
      );
      importRequired(
        valid[0].valid === true,
        'source-flow-transition-not-restorable',
      );
      await source.recheck();
      await transaction.unsafe(
        'INSERT INTO partner_hub.portal_state(id,payload,updated_at) VALUES ($1,$2,$3)',
        [portal.id, portal.payload, portal.updated_at],
      );
      await transaction.unsafe(
        'INSERT INTO partner_hub.application_drafts(owner_key,revision,draft_id,payload,updated_at) VALUES ($1,1,$2,$3,$4)',
        [draft.owner_key, draft.draft_id, draft.payload, draft.updated_at],
      );
      await transaction.unsafe(
        "INSERT INTO partner_hub.consulting_flows(case_id,partner_id,revision,payload,updated_at) VALUES ($1,$2,0,$3,'')",
        [flow.case_id, flow.partner_id, baseline],
      );
      const changed = await transaction.unsafe(
        'UPDATE partner_hub.consulting_flows SET revision=1,payload=$1,updated_at=$2 WHERE case_id=$3 AND revision=0 AND payload=$4 RETURNING case_id',
        [flow.payload, flow.updated_at, flow.case_id, baseline],
      );
      importRequired(changed.length === 1, 'target-flow-transition-conflict');
      await transaction.unsafe('SET CONSTRAINTS ALL IMMEDIATE');
      for (const name of [
        'portal_state',
        'application_drafts',
        'consulting_flows',
      ]) {
        const row = (
          await transaction.unsafe(`SELECT * FROM partner_hub.${name}`)
        )[0];
        importRequired(
          row &&
            Object.entries(targetRows[name]).every(([key, value]) =>
              typeof value === 'bigint'
                ? String(row[key]) === value.toString()
                : row[key] === value,
            ),
          'target-source-row-mismatch',
        );
      }
      importRequired(
        originalAuth === (await authDigests(transaction)),
        'target-auth-changed',
      );
      for (const name of tables.filter(
        (name) => name !== 'schema_migrations' && !preservedAuth.includes(name),
      )) {
        const rows = await transaction.unsafe(
          `SELECT count(*)::text AS count FROM partner_hub.${name}`,
        );
        importRequired(
          rows[0].count === (Object.hasOwn(targetRows, name) ? '1' : '0'),
          'target-unexpected-business-side-effect',
        );
      }
      await source.recheck();
    });
    return {
      ...plan,
      targetWritten: true,
      migrationReady: false,
      authPreserved: true,
      activationPerformed: false,
    };
  } catch (error) {
    if (error instanceof SitesImportError) throw error;
    throw new SitesImportError('target-import-failed-or-outcome-unknown');
  }
}
