import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FLOW_COMMAND_EFFECT_PATHS,
  FLOW_COMMAND_EXACT_EFFECT_TRIGGERS,
  consultingFlowsInitialCommandInsertTriggerSql,
} from '../db/schema';

const project = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
type FlowAction = keyof typeof FLOW_COMMAND_EFFECT_PATHS;

const effectMigrations = {
  import_intake_source: '0077_consulting_flow_import_intake_source_effect.sql',
  save_source: '0076_consulting_flow_save_source_effect.sql',
  exclude_source: '0078_consulting_flow_exclude_source_effect.sql',
  set_ai_policy: '0071_consulting_flow_set_ai_policy_jobs.sql',
  queue_report1: '0075_consulting_flow_queue_report_job_effect.sql',
  save_report: '0079_consulting_flow_save_report_effect.sql',
  confirm_analysis: '0080_consulting_flow_confirm_analysis_effect.sql',
  book_meeting: '0081_consulting_flow_book_meeting_effect.sql',
  complete_meeting: '0082_consulting_flow_complete_meeting_effect.sql',
  cancel_meeting: '0083_consulting_flow_cancel_meeting_effect.sql',
  save_recording: '0074_consulting_flow_save_recording_effect.sql',
  save_transcript: '0072_consulting_flow_save_transcript_jobs.sql',
  retry_job: '0073_consulting_flow_retry_job_effect.sql',
  confirm_solutions: '0084_consulting_flow_confirm_solutions_effect.sql',
  request_document: '0085_consulting_flow_request_document_effect.sql',
  mark_request_sent: '0086_consulting_flow_mark_request_sent_effect.sql',
  receive_document: '0087_consulting_flow_receive_document_effect.sql',
  review_document: '0088_consulting_flow_review_document_effect.sql',
  record_contract: '0089_consulting_flow_record_contract_effect.sql',
  confirm_payment: '0090_consulting_flow_confirm_payment_effect.sql',
  start_aftercare: '0091_consulting_flow_start_aftercare_effect.sql',
} as const satisfies Record<FlowAction, string>;

function triggerName(sql: string) {
  const match = sql.match(/CREATE TRIGGER IF NOT EXISTS ([a-z0-9_]+)/);
  assert.ok(match);
  return match[1];
}

void test('every FLOW command has matching app, D1 and migration effect guards', async () => {
  const actions = Object.keys(FLOW_COMMAND_EFFECT_PATHS).sort() as FlowAction[];
  assert.equal(actions.length, 21);
  assert.deepEqual(
    Object.keys(FLOW_COMMAND_EXACT_EFFECT_TRIGGERS).sort(),
    actions,
  );
  assert.deepEqual(Object.keys(effectMigrations).sort(), actions);

  const storeSource = await readFile(
    path.join(project, 'lib', 'consulting-flow-store.ts'),
    'utf8',
  );
  const appActions = Array.from(
    storeSource.matchAll(/if \(action === '([^']+)'\)/g),
    (match) => match[1],
  ).sort();
  assert.deepEqual(appActions, actions);

  for (const action of actions) {
    const migration = await readFile(
      path.join(project, 'drizzle', effectMigrations[action]),
      'utf8',
    );
    const triggers = FLOW_COMMAND_EXACT_EFFECT_TRIGGERS[action];
    assert.ok(triggers.length > 0);
    for (const sql of triggers) {
      assert.match(sql, new RegExp(`command\\.action IS '${action}'`));
      assert.match(migration, new RegExp(`\\b${triggerName(sql)}\\b`));
    }
  }
});

void test('initial FLOW commands require the additive guarded-update migration', async () => {
  const migration = await readFile(
    path.join(
      project,
      'drizzle',
      '0092_consulting_flow_initial_command_update.sql',
    ),
    'utf8',
  );
  const name = triggerName(consultingFlowsInitialCommandInsertTriggerSql);
  assert.match(migration, new RegExp(`\\b${name}\\b`));
  assert.match(migration, /initial commands must use a guarded update/);
});
