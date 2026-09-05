import {
  consultingFlowsAuditAppendOnlyTriggerSql,
  consultingFlowsCommandHistoryTriggerSql,
  consultingFlowsCommandReceiptOriginTriggerSql,
  consultingFlowsCommandSemanticsTriggerSql,
  consultingFlowsNewCommandEvidenceTriggerSql,
  consultingFlowsNewCommandReceiptIdentityTriggerSql,
  consultingFlowsNewCommandMemberActorTriggerSql,
  consultingFlowsFailureEvidenceTriggerSql,
  consultingFlowsFailureHistoryTriggerSql,
  consultingFlowsJobsTransitionTriggerSql,
  consultingFlowsJobCreationAuditIdentityTriggerSql,
  consultingFlowsJobCreationCommandTriggerSql,
  consultingFlowsJobCreationOriginTriggerSql,
  consultingFlowsJobIdentityTriggerSql,
  consultingFlowsJobLifecycleTriggerSql,
  consultingFlowsJobStatusTriggerSql,
  consultingFlowsJobTransitionAuditTriggerSql,
  consultingFlowsJobTransitionTimestampTriggerSql,
  consultingFlowsNoDeleteTriggerSql,
  consultingFlowsSuccessEvidenceTriggerSql,
  consultingFlowsTransitionTriggerSql,
} from '../db/schema';

const transitionTriggers = [
  consultingFlowsTransitionTriggerSql,
  consultingFlowsAuditAppendOnlyTriggerSql,
  consultingFlowsJobsTransitionTriggerSql,
  consultingFlowsSuccessEvidenceTriggerSql,
  consultingFlowsFailureHistoryTriggerSql,
  consultingFlowsFailureEvidenceTriggerSql,
  consultingFlowsJobIdentityTriggerSql,
  consultingFlowsJobStatusTriggerSql,
  consultingFlowsJobLifecycleTriggerSql,
  consultingFlowsJobTransitionTimestampTriggerSql,
  consultingFlowsJobTransitionAuditTriggerSql,
  consultingFlowsJobCreationOriginTriggerSql,
  consultingFlowsJobCreationAuditIdentityTriggerSql,
  consultingFlowsCommandHistoryTriggerSql,
  consultingFlowsJobCreationCommandTriggerSql,
  consultingFlowsNewCommandEvidenceTriggerSql,
  consultingFlowsCommandReceiptOriginTriggerSql,
  consultingFlowsCommandSemanticsTriggerSql,
  consultingFlowsNewCommandReceiptIdentityTriggerSql,
  consultingFlowsNewCommandMemberActorTriggerSql,
] as const;

const transitionTriggerNames = [
  'consulting_flows_transition_guard',
  'consulting_flows_audit_append_only',
  'consulting_flows_jobs_transition_guard',
  'consulting_flows_success_evidence_guard',
  'consulting_flows_failure_history_guard',
  'consulting_flows_failure_evidence_guard',
  'consulting_flows_job_identity_guard',
  'consulting_flows_job_status_guard',
  'consulting_flows_job_lifecycle_guard',
  'consulting_flows_job_transition_timestamp_guard',
  'consulting_flows_job_transition_audit_guard',
  'consulting_flows_job_creation_origin_guard',
  'consulting_flows_job_creation_audit_identity_guard',
  'consulting_flows_command_history_guard',
  'consulting_flows_job_creation_command_guard',
  'consulting_flows_new_command_evidence_guard',
  'consulting_flows_command_receipt_origin_guard',
  'consulting_flows_command_semantics_guard',
  'consulting_flows_new_command_receipt_identity_guard',
  'consulting_flows_new_command_member_actor_guard',
] as const;

/** Remove synthetic FLOW roots, then immediately restore the runtime guard. */
export async function deleteConsultingFlowFixture(
  db: D1Database,
  caseId?: string,
) {
  await db.prepare('DROP TRIGGER IF EXISTS consulting_flows_no_delete').run();
  try {
    const statement = caseId
      ? db
          .prepare('DELETE FROM consulting_flows WHERE case_id = ?1')
          .bind(caseId)
      : db.prepare('DELETE FROM consulting_flows');
    return await statement.run();
  } finally {
    await db.prepare(consultingFlowsNoDeleteTriggerSql).run();
  }
}

/** Introduce one synthetic legacy drift, then restore transition enforcement. */
export async function mutateConsultingFlowFixture(
  db: D1Database,
  sql: string,
  values: unknown[],
) {
  await db.batch(
    transitionTriggerNames.map((name) =>
      db.prepare(`DROP TRIGGER IF EXISTS ${name}`),
    ),
  );
  try {
    return await db
      .prepare(sql)
      .bind(...values)
      .run();
  } finally {
    await db.batch(transitionTriggers.map((sql) => db.prepare(sql)));
  }
}
