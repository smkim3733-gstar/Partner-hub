import { consultingFlowsNoDeleteTriggerSql } from '../db/schema';

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
