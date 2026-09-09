import { isPostgresDatabase } from './database-dialect';

// Explicit dialect selection, not SQLite statement rewriting. Columns and bind
// positions are internal constants; no request value becomes SQL syntax.
export function flowFileLedgerSql(db: D1Database) {
  const equality = isPostgresDatabase(db) ? 'IS NOT DISTINCT FROM' : 'IS';
  // UNION resolves unknown output parameters before INSERT column context.
  // Preserve the numeric bind instead of letting PostgreSQL infer text.
  const sizeParameter = isPostgresDatabase(db) ? 'CAST(?6 AS bigint)' : '?6';
  const intake = (start: number, prefix = '') => [
    'intake_file_id', 'intake_source_hash', 'source_reviewed_at', 'source_reviewed_by',
  ].map((column, index) => `${prefix}${column} ${equality} ?${start + index}`).join(' AND ');
  return {
    claimOwner: `INSERT INTO consulting_flow_file_owners
      (file_id, case_id, storage_key, created_at)
      SELECT ?1, ?2, ?3, ?4
      WHERE EXISTS (SELECT 1 FROM consulting_flows WHERE case_id = ?2 AND revision = ?5 AND payload = ?6)
        AND NOT EXISTS (SELECT 1 FROM consulting_flow_file_owners WHERE file_id = ?1 OR storage_key = ?3)
      UNION ALL SELECT NULL, ?2, ?3, ?4
      WHERE NOT EXISTS (SELECT 1 FROM consulting_flows WHERE case_id = ?2 AND revision = ?5 AND payload = ?6)
        OR EXISTS (SELECT 1 FROM consulting_flow_file_owners WHERE (file_id = ?1 OR storage_key = ?3)
          AND NOT (file_id = ?1 AND case_id = ?2 AND storage_key = ?3 AND created_at = ?4))`,
    claimMetadata: `INSERT INTO consulting_flow_file_metadata
      (file_id, original_name, content_type, size_bytes, purpose, intake_file_id, intake_source_hash, source_reviewed_at, source_reviewed_by)
      SELECT ?1, ?4, ?5, ${sizeParameter}, ?8, ?9, ?10, ?11, ?12
      WHERE EXISTS (SELECT 1 FROM consulting_flows WHERE case_id = ?2 AND revision = ?13 AND payload = ?14)
        AND EXISTS (SELECT 1 FROM consulting_flow_file_owners
          WHERE file_id = ?1 AND case_id = ?2 AND storage_key = ?3 AND created_at = ?7)
        AND NOT EXISTS (SELECT 1 FROM consulting_flow_file_metadata WHERE file_id = ?1)
      UNION ALL SELECT NULL, ?4, ?5, ${sizeParameter}, ?8, ?9, ?10, ?11, ?12
      WHERE NOT EXISTS (SELECT 1 FROM consulting_flows WHERE case_id = ?2 AND revision = ?13 AND payload = ?14)
        OR NOT EXISTS (SELECT 1 FROM consulting_flow_file_owners
          WHERE file_id = ?1 AND case_id = ?2 AND storage_key = ?3 AND created_at = ?7)
        OR EXISTS (SELECT 1 FROM consulting_flow_file_metadata WHERE file_id = ?1
          AND NOT (original_name = ?4 AND content_type = ?5 AND size_bytes = ?6 AND purpose = ?8 AND ${intake(9)}))`,
    transitionPurpose: `INSERT INTO consulting_flow_file_metadata
      (file_id, original_name, content_type, size_bytes, purpose, intake_file_id, intake_source_hash, source_reviewed_at, source_reviewed_by)
      SELECT CASE WHEN
        EXISTS (SELECT 1 FROM consulting_flows WHERE case_id = ?2 AND revision = ?14 AND payload = ?15) AND
        EXISTS (SELECT 1 FROM consulting_flow_file_owners WHERE file_id = ?1 AND case_id = ?2 AND storage_key = ?3 AND created_at = ?7) AND
        EXISTS (SELECT 1 FROM consulting_flow_file_metadata WHERE file_id = ?1 AND original_name = ?4 AND content_type = ?5
          AND size_bytes = ?6 AND purpose = ?8 AND ${intake(10)}) THEN ?1 ELSE NULL END,
        ?4, ?5, ?6, ?9, ?10, ?11, ?12, ?13
      ON CONFLICT(file_id) DO UPDATE SET purpose = excluded.purpose`,
    claimIntegrity: `INSERT INTO consulting_flow_file_object_integrity
      (file_id, validation_mode, r2_etag, r2_content_type)
      SELECT ?1, 'etag', ?15, ?5
      WHERE EXISTS (SELECT 1 FROM consulting_flows WHERE case_id = ?2 AND revision = ?13 AND payload = ?14)
        AND EXISTS (SELECT 1 FROM consulting_flow_file_owners
          WHERE file_id = ?1 AND case_id = ?2 AND storage_key = ?3 AND created_at = ?7)
        AND EXISTS (SELECT 1 FROM consulting_flow_file_metadata WHERE file_id = ?1 AND original_name = ?4
          AND content_type = ?5 AND size_bytes = ?6 AND purpose = ?8 AND ${intake(9)})
        AND NOT EXISTS (SELECT 1 FROM consulting_flow_file_object_integrity WHERE file_id = ?1)
      UNION ALL SELECT NULL, 'etag', ?15, ?5
      WHERE NOT EXISTS (SELECT 1 FROM consulting_flows WHERE case_id = ?2 AND revision = ?13 AND payload = ?14)
        OR NOT EXISTS (SELECT 1 FROM consulting_flow_file_owners
          WHERE file_id = ?1 AND case_id = ?2 AND storage_key = ?3 AND created_at = ?7)
        OR NOT EXISTS (SELECT 1 FROM consulting_flow_file_metadata WHERE file_id = ?1 AND original_name = ?4
          AND content_type = ?5 AND size_bytes = ?6 AND purpose = ?8 AND ${intake(9)})
        OR EXISTS (SELECT 1 FROM consulting_flow_file_object_integrity WHERE file_id = ?1)`,
    claimChecksum: `INSERT INTO consulting_flow_file_object_checksums (file_id, sha256)
      SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM consulting_flow_file_object_integrity
        WHERE file_id = ?1 AND validation_mode = 'etag' AND r2_etag = ?3 AND r2_content_type = ?4)
        AND NOT EXISTS (SELECT 1 FROM consulting_flow_file_object_checksums WHERE file_id = ?1)
      UNION ALL SELECT NULL, ?2 WHERE NOT EXISTS (SELECT 1 FROM consulting_flow_file_object_integrity
        WHERE file_id = ?1 AND validation_mode = 'etag' AND r2_etag = ?3 AND r2_content_type = ?4)
        OR EXISTS (SELECT 1 FROM consulting_flow_file_object_checksums WHERE file_id = ?1)`,
    readIntegrity: `SELECT object_integrity.validation_mode, object_integrity.r2_etag,
        object_integrity.r2_content_type, object_checksum.sha256 AS r2_sha256
      FROM consulting_flow_file_owners owner
      JOIN consulting_flow_file_metadata metadata ON metadata.file_id = owner.file_id
      JOIN consulting_flow_file_object_integrity object_integrity ON object_integrity.file_id = owner.file_id
      LEFT JOIN consulting_flow_file_object_checksums object_checksum ON object_checksum.file_id = owner.file_id
      WHERE owner.file_id = ?1 AND owner.case_id = ?2 AND owner.storage_key = ?3 AND owner.created_at = ?4
        AND metadata.original_name = ?5 AND metadata.content_type = ?6 AND metadata.size_bytes = ?7
        AND metadata.purpose = ?8 AND ${intake(9, 'metadata.')}`,
  };
}
