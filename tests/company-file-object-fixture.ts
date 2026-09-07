import {
  companyFileObjectChecksumsNoUpdateTriggerSql,
  companyFileObjectsNoUpdateTriggerSql,
} from '../db/schema';

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

/** Build a deliberate checksum-drift fixture, then restore its immutable guard. */
export async function mutateCompanyFileChecksumFixture(
  db: D1Database,
  fileId: string,
  sha256: string,
) {
  await db
    .prepare('DROP TRIGGER IF EXISTS company_file_object_checksums_no_update')
    .run();
  try {
    return await db
      .prepare(
        'UPDATE company_file_object_checksums SET sha256 = ?1 WHERE file_id = ?2',
      )
      .bind(sha256, fileId)
      .run();
  } finally {
    await db.prepare(companyFileObjectChecksumsNoUpdateTriggerSql).run();
  }
}
