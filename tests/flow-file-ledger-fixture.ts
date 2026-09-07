import {
  consultingFlowFileMetadataNoDeleteTriggerSql,
  consultingFlowFileObjectChecksumsNoDeleteTriggerSql,
  consultingFlowFileObjectChecksumsNoUpdateTriggerSql,
  consultingFlowFileObjectIntegrityNoDeleteTriggerSql,
  consultingFlowFileOwnersNoDeleteTriggerSql,
} from '../db/schema';

const deleteTriggers = {
  consulting_flow_file_owners: consultingFlowFileOwnersNoDeleteTriggerSql,
  consulting_flow_file_metadata: consultingFlowFileMetadataNoDeleteTriggerSql,
  consulting_flow_file_object_integrity:
    consultingFlowFileObjectIntegrityNoDeleteTriggerSql,
  consulting_flow_file_object_checksums:
    consultingFlowFileObjectChecksumsNoDeleteTriggerSql,
} as const;

/** Remove one synthetic ledger row, then immediately restore its runtime guard. */
export async function deleteFlowFileLedgerFixture(
  db: D1Database,
  table: keyof typeof deleteTriggers,
  fileId: string,
) {
  const trigger = `${table}_no_delete`;
  await db.prepare(`DROP TRIGGER IF EXISTS ${trigger}`).run();
  try {
    return await db
      .prepare(`DELETE FROM ${table} WHERE file_id = ?1`)
      .bind(fileId)
      .run();
  } finally {
    await db.prepare(deleteTriggers[table]).run();
  }
}

/** Build a deliberate checksum-drift fixture, then restore its immutable guard. */
export async function mutateFlowFileChecksumFixture(
  db: D1Database,
  fileId: string,
  sha256: string,
) {
  await db
    .prepare(
      'DROP TRIGGER IF EXISTS consulting_flow_file_object_checksums_no_update',
    )
    .run();
  try {
    return await db
      .prepare(
        'UPDATE consulting_flow_file_object_checksums SET sha256 = ?1 WHERE file_id = ?2',
      )
      .bind(sha256, fileId)
      .run();
  } finally {
    await db.prepare(consultingFlowFileObjectChecksumsNoUpdateTriggerSql).run();
  }
}
