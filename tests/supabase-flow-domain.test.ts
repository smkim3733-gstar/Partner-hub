import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  FLOW_OBJECT_KEYS,
  hasStoredConsultingFlowStructure,
} from '../lib/consulting-flow-shape';
import {
  storedFlowFileExtensionRules,
  storedFlowFileMaxBytes,
  flowUploadPurpose,
} from '../lib/consulting-flow-upload-policy';
import { uploadFileFormat } from '../lib/upload-file-formats';
import { safeFileName } from '../lib/company-file-policy';
import {
  manualFlowScenario,
  manualFlowCommand,
  manualFlowStamp,
} from './supabase-flow-manual-fixture';
import { type ConsultingFlow, type FlowFile } from '../lib/consulting-flow';
import { postgresFixture } from './supabase-postgres-fixture';

type Engine = Awaited<ReturnType<typeof postgresFixture>>['engine'];
const raw = (value: unknown) => JSON.stringify(value);
async function domain(engine: Engine, value: unknown) {
  return (
    await engine.query<{ valid: boolean }>(
      'SELECT partner_hub.flow_domain_valid($1::json) AS valid',
      [raw(value)],
    )
  ).rows[0].valid;
}
async function compare(
  engine: Engine,
  value: unknown,
  expected: boolean,
  label: string,
) {
  assert.equal(
    hasStoredConsultingFlowStructure(value),
    expected,
    `TypeScript ${label}`,
  );
  assert.equal(await domain(engine, value), expected, `PostgreSQL ${label}`);
}
const file = (purpose: string, name: string): FlowFile => ({
  id: 'synthetic-file',
  purpose,
  name,
  contentType:
    uploadFileFormat(name.split('.').at(-1)!.toLowerCase())?.contentType ??
    'text/plain',
  size: 100,
  key: 'consulting-flow/synthetic-file',
  createdAt: manualFlowStamp,
});

void test('native stored-domain catalog matches every non-projected TypeScript object whitelist', async (t) => {
  const { engine, close } = await postgresFixture();
  t.after(close);
  const rules = (
    await engine.query<{ rules: Record<string, Record<string, string>> }>(
      'SELECT partner_hub.flow_shape_rules() AS rules',
    )
  ).rows[0].rules;
  const expected = Object.fromEntries(
    Object.entries(FLOW_OBJECT_KEYS).filter(
      ([key]) => !key.startsWith('projected'),
    ),
  );
  assert.deepEqual(Object.keys(rules).sort(), Object.keys(expected).sort());
  for (const [kind, fields] of Object.entries(expected))
    assert.deepEqual(Object.keys(rules[kind]).sort(), [...fields].sort(), kind);
});

void test('actual application FLOW snapshots pass full stored field, reference and state validation', async (t) => {
  const { engine, close } = await postgresFixture();
  t.after(close);
  const { transitions } = await manualFlowScenario(engine);
  for (const transition of transitions) {
    await compare(
      engine,
      transition.previous,
      true,
      `${transition.commandId} before`,
    );
    await compare(
      engine,
      transition.proposed,
      true,
      `${transition.commandId} after`,
    );
  }
  const original = transitions.find(
    (x) => x.command.type === 'save_transcript',
  )!;
  const attachment = file(
    flowUploadPurpose(original.command)!,
    'synthetic.txt',
  );
  const uploaded = manualFlowCommand(
    original.previous,
    original.command,
    original.actor,
    'synthetic-transcript-domain',
    manualFlowStamp,
    attachment,
  );
  await compare(
    engine,
    uploaded.proposed,
    true,
    'dedicated transcript attachment',
  );
  assert.equal(
    (
      await engine.query<{ valid: boolean }>(
        'SELECT partner_hub.flow_command_effect_transition_valid($1,$2,$3,$4,$5,$6) AS valid',
        [
          raw(uploaded.previous),
          raw(uploaded.proposed),
          uploaded.proposed.caseId,
          uploaded.proposed.partnerId,
          uploaded.proposed.revision,
          uploaded.proposed.updatedAt,
        ],
      )
    ).rows[0].valid,
    true,
  );
  const wrong = structuredClone(uploaded.proposed);
  wrong.files.at(-1)!.purpose = 'recording';
  assert.equal(
    (
      await engine.query<{ valid: boolean }>(
        'SELECT partner_hub.flow_command_effect_transition_valid($1,$2,$3,$4,$5,$6) AS valid',
        [
          raw(uploaded.previous),
          raw(wrong),
          wrong.caseId,
          wrong.partnerId,
          wrong.revision,
          wrong.updatedAt,
        ],
      )
    ).rows[0].valid,
    false,
    'recording purpose cannot bypass transcript receipt',
  );
});

void test('native stored-domain rejects malformed fields, null optionals, unknown keys and collection overflow', async (t) => {
  const { engine, close } = await postgresFixture();
  t.after(close);
  const { flow } = await manualFlowScenario(engine);
  const mutations: Array<[string, (s: ConsultingFlow) => void]> = [
    [
      'root unknown',
      (s) => {
        Object.assign(s, { unknown: true });
      },
    ],
    [
      'report unknown',
      (s) => {
        Object.assign(s.reports[0], { unknown: true });
      },
    ],
    [
      'file unknown',
      (s) => {
        Object.assign(s.files[0], { unknown: true });
      },
    ],
    [
      'meeting unknown',
      (s) => {
        Object.assign(s.meetings[0], { unknown: true });
      },
    ],
    [
      'recording unknown',
      (s) => {
        Object.assign(s.recordings[0], { unknown: true });
      },
    ],
    [
      'request unknown',
      (s) => {
        Object.assign(s.requests[0], { unknown: true });
      },
    ],
    [
      'payment unknown',
      (s) => {
        Object.assign(s.payments[0], { unknown: true });
      },
    ],
    [
      'job unknown',
      (s) => {
        Object.assign(s.jobs[0], { unknown: true });
      },
    ],
    [
      'audit unknown',
      (s) => {
        Object.assign(s.audit[0], { unknown: true });
      },
    ],
    [
      'analysis unknown',
      (s) => {
        Object.assign(s.analysis, { unknown: true });
      },
    ],
    [
      'ai unknown',
      (s) => {
        Object.assign(s.ai, { unknown: true });
      },
    ],
    [
      'decision unknown',
      (s) => {
        Object.assign(s.decision!, { unknown: true });
      },
    ],
    [
      'contract unknown',
      (s) => {
        Object.assign(s.contract!, { unknown: true });
      },
    ],
    [
      'aftercare unknown',
      (s) => {
        Object.assign(s.aftercare!, { unknown: true });
      },
    ],
    [
      'receipt unknown',
      (s) => {
        Object.assign(Object.values(s.commandReceipts!)[0], { unknown: true });
      },
    ],
    [
      'null optional',
      (s) => {
        Object.assign(s.reports[0], { fileId: null });
      },
    ],
    [
      'null contract',
      (s) => {
        Object.assign(s, { contract: null });
      },
    ],
    [
      'null collection',
      (s) => {
        Object.assign(s, { files: null });
      },
    ],
    [
      'blank identity',
      (s) => {
        s.partnerId = '\u3000';
      },
    ],
    [
      'oversize body',
      (s) => {
        s.reports[0].body = '가'.repeat(80001);
      },
    ],
    [
      'negative revision',
      (s) => {
        s.revision = -1;
      },
    ],
    [
      'unsafe revision',
      (s) => {
        s.revision = 9007199254740992;
      },
    ],
    [
      'duplicate report',
      (s) => {
        s.reports.push(s.reports[0]);
      },
    ],
    [
      'duplicate command',
      (s) => {
        s.commandIds.push(s.commandIds[0]);
      },
    ],
    [
      'too many meetings',
      (s) => {
        s.meetings = Array.from({ length: 2001 }, (_, n) => ({
          ...s.meetings[0],
          id: `synthetic-${n}`,
        }));
      },
    ],
  ];
  for (const [label, edit] of mutations) {
    const changed = structuredClone(flow);
    edit(changed);
    await compare(engine, changed, false, label);
  }
  for (const value of [null, [], {}, 'bad', 1])
    await compare(engine, value, false, 'non-root');
});

void test('native file format, MIME, size, key and Unicode filename checks match stored upload policy', async (t) => {
  const { engine, close } = await postgresFixture();
  t.after(close);
  const { transitions } = await manualFlowScenario(engine);
  const initial = transitions[0].previous;
  for (const rule of storedFlowFileExtensionRules) {
    const attachment = file(rule.purpose, `synthetic.${rule.extension}`);
    const maximum = storedFlowFileMaxBytes(rule.purpose, attachment.name)!;
    for (const size of [1, maximum, 0, maximum + 1])
      await compare(
        engine,
        { ...initial, files: [{ ...attachment, size }] },
        size > 0 && size <= maximum,
        `${rule.purpose}/${rule.extension}/${size}`,
      );
    await compare(
      engine,
      {
        ...initial,
        files: [{ ...attachment, contentType: 'application/x-wrong' }],
      },
      false,
      `${rule.purpose}/${rule.extension}/MIME`,
    );
  }
  for (const name of [
    '정상.pdf',
    '한글🙂.pdf',
    'UPPER.PDF',
    '../x.pdf',
    'a\\b.pdf',
    ' x.pdf',
    'x.pdf ',
    'x\u007f.pdf',
    'x\u0001.pdf',
    '가.pdf',
    '가'.repeat(177) + '.pdf',
  ]) {
    await compare(
      engine,
      { ...initial, files: [file('report', name)] },
      name === safeFileName(name),
      `name ${raw(name)}`,
    );
  }
  await compare(
    engine,
    { ...initial, files: [{ ...file('report', 'ok.pdf'), key: 'wrong/key' }] },
    false,
    'key bound to ID',
  );
  await compare(
    engine,
    { ...initial, files: [file('recording', 'wrong.pdf')] },
    false,
    'purpose mismatch',
  );
});

void test('native domain rejects orphan references and inconsistent document, meeting, deposit and aftercare state', async (t) => {
  const { engine, close } = await postgresFixture();
  t.after(close);
  const { flow } = await manualFlowScenario(engine);
  const edits: Array<[string, (s: ConsultingFlow) => void]> = [
    [
      'analysis wrong stage',
      (s) => {
        s.analysis.reportId = s.reports.find((x) => x.stage === 2)!.id;
      },
    ],
    [
      'source report',
      (s) => {
        s.reports[1].sourceReportId = 'missing';
      },
    ],
    [
      'source recording',
      (s) => {
        s.reports.find((x) => x.stage === 4)!.sourceRecordingId = 'missing';
      },
    ],
    [
      'decision reference',
      (s) => {
        s.reports.find((x) => x.stage === 5)!.decisionId = 'missing';
      },
    ],
    [
      'report attachment',
      (s) => {
        s.reports[0].fileId = 'missing';
      },
    ],
    [
      'decision report',
      (s) => {
        s.decision!.reportId = s.reports[0].id;
      },
    ],
    [
      'contract meeting',
      (s) => {
        s.contract!.meetingId = s.meetings[0].id;
      },
    ],
    [
      'contract report',
      (s) => {
        s.contract!.reportId = s.reports[0].id;
      },
    ],
    [
      'contract file',
      (s) => {
        s.contract!.signedFileId = s.files[0].id;
      },
    ],
    [
      'recording meeting',
      (s) => {
        s.recordings[0].meetingId = 'missing';
      },
    ],
    [
      'recording file',
      (s) => {
        s.recordings[0].audioFileId = 'missing';
      },
    ],
    [
      'request file',
      (s) => {
        s.requests[0].fileId = 'missing';
      },
    ],
    [
      'job report',
      (s) => {
        s.jobs.at(-1)!.sourceReportId = 'missing';
      },
    ],
    [
      'job recording',
      (s) => {
        s.jobs.at(-1)!.sourceRecordingId = 'missing';
      },
    ],
    [
      'receipt command',
      (s) => {
        s.commandIds.shift();
      },
    ],
    [
      'meeting backwards',
      (s) => {
        s.meetings[0].endsAt = s.meetings[0].startsAt;
      },
    ],
    [
      'false completion',
      (s) => {
        s.meetings[0].completedAt = manualFlowStamp;
      },
    ],
    [
      'verification missing',
      (s) => {
        delete s.requests[0].verifiedAt;
      },
    ],
    [
      'review before receipt',
      (s) => {
        s.requests[0].reviewedAt = '2020-01-01T00:00:00.000Z';
      },
    ],
    [
      'future payment',
      (s) => {
        s.payments[0].receivedAt = '2099-01-01';
      },
    ],
    [
      'missing execution',
      (s) => {
        delete s.executionStartedAt;
      },
    ],
    [
      'incomplete deposit',
      (s) => {
        s.payments[0].amountWon = 1;
      },
    ],
    [
      'aftercare before execution',
      (s) => {
        s.aftercare!.at = '2020-01-01T00:00:00.000Z';
      },
    ],
  ];
  for (const [label, edit] of edits) {
    const changed = structuredClone(flow);
    edit(changed);
    await compare(engine, changed, false, label);
  }
});

void test('native AI evidence binds each observation to one canonical audit and ordered lifecycle', async (t) => {
  const { engine, close } = await postgresFixture();
  t.after(close);
  const { transitions } = await manualFlowScenario(engine);
  const success = structuredClone(
    transitions.find(
      (x) => x.command.type === 'save_report' && x.command.stage === 1,
    )!.proposed,
  );
  const completed = '2026-09-09T12:10:00.000Z';
  success.updatedAt = completed;
  const job = success.jobs[0];
  job.status = 'complete';
  job.startedAt = manualFlowStamp;
  job.completedAt = completed;
  job.reportId = success.reports[0].id;
  job.evidence = {
    auditId: `${job.id}-${completed}`,
    instructionVersion: 'synthetic-v1',
    requestedModel: 'synthetic-model',
    providerModel: 'synthetic-model',
    providerRequestId: 'synthetic-request',
    providerMessageId: 'synthetic-message',
    inputTokens: 100,
    outputTokens: 200,
    observedAt: '2026-09-09T12:05:00.000Z',
  };
  success.audit.push({
    id: job.evidence.auditId,
    at: completed,
    actor: '보고서 자동생성',
    action: 'ai_result',
    detail: '합성 성공 관측',
  });
  await compare(engine, success, true, 'success observation');
  const bad: Array<[string, (s: ConsultingFlow) => void]> = [
    [
      'missing success audit',
      (s) => {
        s.audit.pop();
      },
    ],
    [
      'wrong audit actor',
      (s) => {
        s.audit.at(-1)!.actor = '변조';
      },
    ],
    [
      'wrong audit action',
      (s) => {
        s.audit.at(-1)!.action = 'save_report';
      },
    ],
    [
      'wrong audit identifier',
      (s) => {
        s.audit.at(-1)!.id = 'wrong';
        s.jobs[0].evidence!.auditId = 'wrong';
      },
    ],
    [
      'observation after completion',
      (s) => {
        s.jobs[0].evidence!.observedAt = '2026-09-09T12:11:00.000Z';
      },
    ],
    [
      'observation before start',
      (s) => {
        s.jobs[0].evidence!.observedAt = '2026-09-09T12:00:00.000Z';
      },
    ],
    [
      'untrimmed provider ID',
      (s) => {
        s.jobs[0].evidence!.providerRequestId = ' padded';
      },
    ],
    [
      'zero token count',
      (s) => {
        s.jobs[0].evidence!.inputTokens = 0;
      },
    ],
    [
      'unknown evidence field',
      (s) => {
        Object.assign(s.jobs[0].evidence!, { extra: true });
      },
    ],
    [
      'success evidence on failed job',
      (s) => {
        s.jobs[0].status = 'failed';
        delete s.jobs[0].completedAt;
        delete s.jobs[0].reportId;
      },
    ],
  ];
  for (const [label, edit] of bad) {
    const changed = structuredClone(success);
    edit(changed);
    await compare(engine, changed, false, label);
  }
  const failed = structuredClone(success);
  const failedJob = failed.jobs[0];
  delete failedJob.evidence;
  delete failedJob.completedAt;
  delete failedJob.reportId;
  failedJob.status = 'failed';
  failed.audit.pop();
  const makeFailure = (at: string) => ({
    auditId: `${job.id}-${at}`,
    instructionVersion: 'synthetic-v1',
    requestedModel: 'synthetic-model',
    httpStatus: 503,
    providerRequestId: 'synthetic-request',
    observedAt: at,
  });
  failedJob.failureEvidenceHistory = [
    makeFailure('2026-09-09T12:02:00.000Z'),
    makeFailure('2026-09-09T12:03:00.000Z'),
  ];
  failedJob.failureEvidence = makeFailure('2026-09-09T12:04:00.000Z');
  for (const evidence of [
    ...failedJob.failureEvidenceHistory,
    failedJob.failureEvidence,
  ])
    failed.audit.push({
      id: evidence.auditId,
      at: evidence.observedAt,
      actor: '보고서 자동생성',
      action: 'ai_result',
      detail: '합성 실패 관측',
    });
  await compare(engine, failed, true, 'failure with ordered history');
  const failures: Array<[string, (s: ConsultingFlow) => void]> = [
    [
      'reordered history',
      (s) => {
        s.jobs[0].failureEvidenceHistory!.reverse();
      },
    ],
    [
      'empty history',
      (s) => {
        s.jobs[0].failureEvidenceHistory = [];
      },
    ],
    [
      'duplicate evidence audit',
      (s) => {
        s.jobs[0].failureEvidence = structuredClone(
          s.jobs[0].failureEvidenceHistory![0],
        );
      },
    ],
    [
      'invalid failure status',
      (s) => {
        s.jobs[0].failureEvidence!.httpStatus = 200;
      },
    ],
    [
      'missing historical audit',
      (s) => {
        s.audit.splice(-3, 1);
      },
    ],
    [
      'failure before job',
      (s) => {
        s.jobs[0].failureEvidenceHistory![0].observedAt =
          '2020-01-01T00:00:00.000Z';
      },
    ],
    [
      'observation after root',
      (s) => {
        s.jobs[0].failureEvidence!.observedAt = '2026-09-09T12:11:00.000Z';
      },
    ],
    [
      'failed without start',
      (s) => {
        delete s.jobs[0].startedAt;
      },
    ],
  ];
  for (const [label, edit] of failures) {
    const changed = structuredClone(failed);
    edit(changed);
    await compare(engine, changed, false, label);
  }
});

void test('native timestamp parser pins explicit ISO instants and rejects ambiguous PostgreSQL date forms', async (t) => {
  const { engine, close } = await postgresFixture();
  t.after(close);
  for (const value of [
    '2026-09-09T12:01:00.000Z',
    '2026-09-09T12:01:00.123456Z',
    '2026-09-09T12:01:00.9999999Z',
    '2026-09-09T21:01:00+09:00',
    '2026-09-09T08:01:00-04:00',
    '2024-02-29',
  ]) {
    const result = (
      await engine.query<{ epoch: string }>(
        'SELECT (extract(epoch from partner_hub.flow_shape_time($1::json))*1000)::text AS epoch',
        [raw(value)],
      )
    ).rows[0].epoch;
    assert.equal(Number(result), Date.parse(value), value);
  }
  for (const value of [
    'today',
    'now',
    'infinity',
    '-infinity',
    '09/10/2026',
    '2026-02-30',
    '2026-09-09T25:00:00Z',
    '2026-09-09T23:59:60Z',
    '',
    null,
    1,
  ]) {
    assert.equal(
      (
        await engine.query<{ value: unknown }>(
          'SELECT partner_hub.flow_shape_time($1::json) AS value',
          [raw(value)],
        )
      ).rows[0].value,
      null,
      raw(value),
    );
  }
});

void test('remote stored-domain probe retains server-only access and makes no business writes', async (t) => {
  const { engine, close } = await postgresFixture();
  t.after(close);
  await engine.exec(
    await readFile(
      new URL('./supabase-flow-domain-probe.sql', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(
    (
      await engine.query<{ count: number }>(
        'SELECT count(*)::integer AS count FROM partner_hub.portal_state',
      )
    ).rows[0].count,
    0,
  );
});
