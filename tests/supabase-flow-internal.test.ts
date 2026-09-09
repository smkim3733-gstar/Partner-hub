import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { postgresFixture } from './supabase-postgres-fixture';
import {
  manualFlowScenario,
  manualFlowCommand,
} from './supabase-flow-manual-fixture';
import { claimFlowJob, finishFlowJob } from '../lib/consulting-flow-jobs';
import type { ConsultingFlow, FlowActor } from '../lib/consulting-flow';

void test('native internal stage-four result binds source versions and rejects revoked AI consent', async (t) => {
  const f = await postgresFixture({ flowRoot: true });
  t.after(f.close);
  const { transitions } = await manualFlowScenario(f.engine);
  const admin: FlowActor = {
    id: 'synthetic-admin',
    role: 'admin',
    name: '김성민 대표',
  };
  const before = transitions.find(
    (item) => item.command.type === 'save_transcript',
  )!.proposed;
  const enabled = manualFlowCommand(
    before,
    {
      type: 'set_ai_policy',
      enabled: true,
      thirdPartyConsent: true,
      privacyMasked: true,
      costConsent: true,
    },
    admin,
    'internal-enable',
    '2026-09-09T12:05:00.000Z',
  ).proposed;
  const job = enabled.jobs.find((item) => item.stage === 4)!;
  const queued = manualFlowCommand(
    enabled,
    { type: 'retry_job', jobId: job.id, costConsent: true },
    admin,
    'internal-retry',
    '2026-09-09T12:06:00.000Z',
  ).proposed;
  const lease = '2026-09-09T12:07:00.000Z';
  const end = '2026-09-09T12:09:00.000Z';
  const claimed = claimFlowJob(queued, job.id, lease);
  const outcome = {
    body: '합성 AI 결과입니다. 실제 AI 제공자를 호출하지 않습니다. '.repeat(12),
    evidence: {
      instructionVersion: 'synthetic-v1',
      requestedModel: 'synthetic-model',
      providerRequestId: 'req_synthetic',
      providerModel: 'synthetic-model',
      providerMessageId: 'msg_synthetic',
      inputTokens: 1,
      outputTokens: 1,
      observedAt: end,
    },
  };
  const complete = finishFlowJob(claimed, job.id, lease, end, outcome);
  async function valid(previous: ConsultingFlow, proposed: ConsultingFlow) {
    return (
      await f.engine.query<{ valid: boolean }>(
        'SELECT partner_hub.flow_root_transition_valid($1,$2,$3,$4,$5,$6) AS valid',
        [
          JSON.stringify(previous),
          JSON.stringify(proposed),
          proposed.caseId,
          proposed.partnerId,
          proposed.revision,
          proposed.updatedAt,
        ],
      )
    ).rows[0].valid;
  }
  assert.equal(await valid(queued, claimed), true);
  assert.equal(await valid(claimed, complete), true);
  const altered = structuredClone(complete);
  altered.reports.at(-1)!.sourceReportId = 'wrong-source';
  assert.equal(await valid(claimed, altered), false);
  const revoked = manualFlowCommand(
    claimed,
    { type: 'set_ai_policy', enabled: false },
    admin,
    'internal-revoke',
    '2026-09-09T12:08:00.000Z',
  ).proposed;
  const blocked = finishFlowJob(revoked, job.id, lease, end, outcome);
  assert.equal(
    blocked.jobs.find((item) => item.id === job.id)!.status,
    'blocked',
  );
  assert.equal(await valid(revoked, blocked), true);
  const forged = {
    ...complete,
    revision: revoked.revision + 1,
    ai: revoked.ai,
    commandIds: revoked.commandIds,
    commandReceipts: revoked.commandReceipts,
    audit: [...revoked.audit, complete.audit.at(-1)!],
  };
  assert.equal(
    await valid(revoked, forged),
    false,
    'revoked consent cannot be replaced by success evidence',
  );
  const reordered = structuredClone(claimed);
  reordered.jobs.reverse();
  assert.equal(await valid(queued, reordered), false);
});

void test('native FLOW root rollback probe executes locally before remote use', async (t) => {
  const f = await postgresFixture({ flowRoot: true });
  t.after(f.close);
  await f.engine.exec(
    await readFile(
      new URL('./supabase-flow-root-rollback.sql', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(
    (
      await f.engine.query<{ count: bigint }>(
        'SELECT count(*) FROM partner_hub.consulting_flows',
      )
    ).rows[0].count,
    BigInt(0),
  );
});
