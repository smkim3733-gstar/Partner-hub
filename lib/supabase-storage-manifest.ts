import { randomUUID } from 'node:crypto';
import {
  parseR2Object,
  r2PrivateKey,
  type R2WireObject,
} from './r2-http-protocol';
import {
  assertSupabaseObjectPath,
  supabaseStorageFailure,
} from './supabase-storage-http';

export type SupabaseStorageVersion = {
  revision: string;
  path: string;
  wire: R2WireObject;
};
export type SupabaseStorageHead = {
  revision: string;
  version: SupabaseStorageVersion | null;
};
export type SupabaseStorageManifest = {
  read(key: string): Promise<SupabaseStorageHead | null>;
  publish(
    key: string,
    version: SupabaseStorageVersion,
    expectedRevision: string | null | undefined,
  ): Promise<boolean>;
  remove(key: string, expectedRevision: string): Promise<boolean>;
};

export function createSupabaseStorageManifest(
  db: D1Database,
): SupabaseStorageManifest {
  return {
    async read(key) {
      r2PrivateKey(key, true);
      const row = await db
        .prepare(`SELECT h.revision, h.version_revision, v.physical_path, v.wire
        FROM storage_object_heads h LEFT JOIN storage_object_versions v
        ON v.object_key = h.object_key AND v.revision = h.version_revision
        WHERE h.object_key = ?1`)
        .bind(key)
        .first<{
          revision: string;
          version_revision: string | null;
          physical_path: string | null;
          wire: string | null;
        }>();
      if (!row) return null;
      assertSupabaseObjectPath(`partner-hub/objects/v1/${row.revision}`);
      if (row.version_revision === null)
        return { revision: row.revision, version: null };
      if (
        row.version_revision !== row.revision ||
        row.physical_path !== `partner-hub/objects/v1/${row.revision}` ||
        !row.wire
      )
        return supabaseStorageFailure();
      let wire: R2WireObject;
      try {
        wire = parseR2Object(JSON.parse(row.wire), key);
      } catch {
        return supabaseStorageFailure();
      }
      if (wire.version !== row.revision || !wire.checksums.sha256)
        return supabaseStorageFailure();
      return {
        revision: row.revision,
        version: {
          revision: row.revision,
          path: row.physical_path,
          wire,
        },
      };
    },
    async publish(key, version, expectedRevision) {
      r2PrivateKey(key);
      assertSupabaseObjectPath(version.path);
      if (version.path !== `partner-hub/objects/v1/${version.revision}`)
        return supabaseStorageFailure();
      const wire = parseR2Object(version.wire, key);
      if (wire.version !== version.revision || !wire.checksums.sha256)
        return supabaseStorageFailure();
      const statements = [
        db
          .prepare(`INSERT INTO storage_object_versions
        (object_key, revision, physical_path, wire) VALUES (?1, ?2, ?3, ?4)`)
          .bind(key, version.revision, version.path, JSON.stringify(wire)),
      ];
      // null means "still absent", undefined means an unconditional R2 put.
      // A known tombstone has a revision too, preventing delete/recreate ABA.
      statements.push(
        db
          .prepare(`INSERT INTO storage_object_heads
        (object_key, revision, version_revision) SELECT ?1, ?2, ?2${
          expectedRevision === undefined
            ? ''
            : ` WHERE (?3::text IS NULL OR EXISTS (SELECT 1 FROM storage_object_heads
            WHERE object_key = ?1 AND revision = ?3))`
        }
        ON CONFLICT (object_key) DO UPDATE SET revision = EXCLUDED.revision,
        version_revision = EXCLUDED.version_revision${
          expectedRevision === undefined
            ? ''
            : ' WHERE storage_object_heads.revision = ?3'
        }`)
          .bind(
            ...(expectedRevision === undefined
              ? [key, version.revision]
              : [key, version.revision, expectedRevision]),
          ),
      );
      const results = await db.batch(statements);
      return results[1].meta.changes === 1;
    },
    async remove(key, expectedRevision) {
      r2PrivateKey(key, true);
      const result = await db
        .prepare(`UPDATE storage_object_heads SET revision = ?1,
        version_revision = NULL WHERE object_key = ?2 AND revision = ?3`)
        .bind(randomUUID(), key, expectedRevision)
        .run();
      // Keep immutable versions and physical bytes until an explicit retention
      // cleanup. Failed writes and deletes stay recoverable for migration rollback.
      return result.meta.changes === 1;
    },
  };
}
