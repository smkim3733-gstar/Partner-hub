import { companyFileObjectsNoUpdateTriggerSql } from '../db/schema';

/** Build a deliberate legacy-drift fixture without weakening the runtime guard. */
export async function mutateCompanyFileObjectFixture(
  db: D1Database,
  sql: string,
  values: readonly unknown[],
) {
  await db
    .prepare('DROP TRIGGER IF EXISTS company_file_objects_no_update')
    .run();
  try {
    return await db
      .prepare(sql)
      .bind(...values)
      .run();
  } finally {
    await db.prepare(companyFileObjectsNoUpdateTriggerSql).run();
  }
}
