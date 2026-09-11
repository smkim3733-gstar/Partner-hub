import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  backupDay,
  summarizeRetention,
  validateScheduledSuccess,
  safeScheduledError,
} from '../scripts/supabase-backup-schedule-policy.mjs';

function reports(objects = 0) {
  const common = {
    archiveSha256: 'a'.repeat(64),
    source: {
      projectRef: 'yievsveuxjnbygatvjtb',
      appOrigin: 'https://partner-hub-gamma-five.vercel.app',
      schema: 'partner_hub',
      commit: 'b'.repeat(40),
      pgDumpVersion: 'pg_dump (PostgreSQL) 17.11',
    },
    databaseTables: 38,
    databaseRows: 5,
    storageObjects: objects,
    storageBytes: objects * 100,
    sourceWrites: 0,
    separateDeviceKeyCopyVerified: false,
    storageLinkCheck: {
      versionCount: objects,
      activeHeadCount: objects,
      tombstoneHeadCount: 0,
      matchedObjects: objects,
      extraObjects: 0,
      totalReferencedBytes: objects * 100,
    },
  };
  return {
    created: {
      ...structuredClone(common),
      status: 'created-unverified',
      restoreVerified: false,
      startedAt: '2020-01-01T00:00:00.000Z',
      completedAt: '2020-01-01T00:01:00.000Z',
      archiveFile: 'synthetic-private-path',
      keyFile: 'synthetic-private-key-path',
    },
    verified: {
      ...structuredClone(common),
      status: 'verified-local-postgresql',
      verifiedAt: '2020-01-01T00:02:00.000Z',
      schemaAndPermissionsEqual: true,
      tableContentsEqual: true,
      localRestorePlaintextRemoved: true,
      remoteRestoreSupported: false,
      supabaseStorageRestoreVerified: false,
      storageCheck:
        objects === 0
          ? 'empty-inventory-verified-no-file-restore-claim'
          : 'local-byte-restore-verified',
    },
  };
}

void test('daily keys use Korean midnight and reject invalid clocks', () => {
  assert.equal(backupDay(new Date('2026-09-11T14:59:59.999Z')), '2026-09-11');
  assert.equal(backupDay('2026-09-11T15:00:00.000Z'), '2026-09-12');
  assert.equal(backupDay(Date.parse('2026-12-31T15:00:00.000Z')), '2027-01-01');
  for (const invalid of [
    new Date(NaN),
    NaN,
    Infinity,
    null,
    '',
    '2026-02-30T00:00:00.000Z',
  ]) {
    assert.throws(() => backupDay(invalid), /backup-scheduled-clock-invalid/);
  }
});

void test('retention counts thirty-day boundary and retains older verified runs without deleting', () => {
  const now = new Date('2026-09-11T12:00:00.000Z');
  const success = (completedAt: string) => ({
    status: 'verified',
    completedAt,
    archiveSha256: 'a'.repeat(64),
  });
  const runs = [
    success(now.toISOString()),
    success(new Date(now.getTime() - 30 * 86400000).toISOString()),
    success(new Date(now.getTime() - 30 * 86400000 - 1).toISOString()),
    success(new Date(now.getTime() + 1).toISOString()),
    success('invalid'),
    { ...success(now.toISOString()), archiveSha256: 'invalid' },
    { status: 'failed', completedAt: now.toISOString() },
    { status: 'created-unverified', completedAt: now.toISOString() },
    null,
  ];
  const before = structuredClone(runs);
  assert.deepEqual(summarizeRetention(runs, now), {
    recentVerified: 2,
    olderVerifiedRetained: 1,
    failed: 6,
    automaticDeletion: false,
    retentionDays: 30,
  });
  assert.deepEqual(runs, before);
  assert.throws(
    () => summarizeRetention({}, now),
    /backup-scheduled-inventory-invalid/,
  );
});

void test('scheduled success requires matched creation, local restore and cleanup, and returns no private paths', () => {
  for (const objects of [0, 2]) {
    const { created, verified } = reports(objects);
    const result = validateScheduledSuccess(created, verified);
    assert.equal(result.status, 'verified');
    assert.equal(result.completedAt, verified.verifiedAt);
    assert.equal(result.storageObjects, objects);
    assert.equal(result.sourceWrites, 0);
    assert.equal(result.supabaseStorageRestoreVerified, false);
    assert.equal(result.remoteRestoreSupported, false);
    assert.equal(result.separateDeviceKeyCopyVerified, false);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-private/);
  }
});

void test('scheduled success rejects mismatched target/hash/count, missing proof, future times and invalid storage claims', () => {
  const mutations: Array<(fx: ReturnType<typeof reports>) => void> = [
    (fx) => {
      fx.created.status = 'verified';
    },
    (fx) => {
      fx.verified.status = 'restore-different';
    },
    (fx) => {
      fx.created.restoreVerified = true;
    },
    (fx) => {
      fx.verified.source.projectRef = 'anotherproject';
    },
    (fx) => {
      fx.created.source.appOrigin = 'https://example.invalid';
    },
    (fx) => {
      fx.verified.source.schema = 'public';
    },
    (fx) => {
      fx.verified.source.commit = 'c'.repeat(40);
    },
    (fx) => {
      fx.verified.archiveSha256 = 'b'.repeat(64);
    },
    (fx) => {
      fx.created.databaseTables = fx.verified.databaseTables = 37;
    },
    (fx) => {
      fx.verified.databaseRows++;
    },
    (fx) => {
      fx.verified.storageBytes++;
    },
    (fx) => {
      fx.created.sourceWrites = 1;
    },
    (fx) => {
      fx.verified.sourceWrites = 1;
    },
    (fx) => {
      fx.verified.schemaAndPermissionsEqual = false;
    },
    (fx) => {
      fx.verified.tableContentsEqual = false;
    },
    (fx) => {
      fx.verified.localRestorePlaintextRemoved = false;
    },
    (fx) => {
      fx.verified.remoteRestoreSupported = true;
    },
    (fx) => {
      fx.verified.supabaseStorageRestoreVerified = true;
    },
    (fx) => {
      fx.verified.storageCheck = 'local-byte-restore-verified';
    },
    (fx) => {
      fx.verified.storageLinkCheck.matchedObjects++;
    },
    (fx) => {
      fx.created.startedAt = '2020-01-01T00:03:00.000Z';
    },
    (fx) => {
      fx.verified.verifiedAt = '2999-01-01T00:00:00.000Z';
    },
  ];
  for (const mutate of mutations) {
    const fx = reports();
    mutate(fx);
    assert.throws(
      () => validateScheduledSuccess(fx.created, fx.verified),
      (error: Error & { backupCode?: string }) => {
        assert.match(error.backupCode ?? '', /^backup-scheduled-/);
        assert.equal(error.message, error.backupCode);
        return true;
      },
    );
  }
  const missing = reports();
  Reflect.deleteProperty(missing.verified, 'localRestorePlaintextRemoved');
  assert.throws(
    () => validateScheduledSuccess(missing.created, missing.verified),
    /verification-incomplete/,
  );
});

void test('scheduled errors preserve only safe machine codes and redact diagnostics', () => {
  assert.equal(
    safeScheduledError({
      backupCode: 'backup-local-cleanup-failed',
      message: 'private SQL',
    }),
    'backup-local-cleanup-failed',
  );
  assert.equal(
    safeScheduledError({
      name: 'SupabaseFingerprintError',
      code: 'data-byte-limit',
    }),
    'data-byte-limit',
  );
  for (const message of [
    'BACKUP_ARCHIVE_INVALID',
    'SUPABASE_BACKUP_STORAGE_FAILED',
    'SUPABASE_BACKUP_STORAGE_LINKS_FAILED',
  ]) {
    assert.equal(safeScheduledError(new Error(message)), message);
  }
  for (const error of [
    new Error('postgres://user:private-password@host private SQL'),
    { backupCode: 'private-password' },
    { backupCode: 'backup-failed private-password' },
    { name: 'SupabaseFingerprintError', code: 'private value' },
    null,
    undefined,
  ])
    assert.equal(safeScheduledError(error), 'backup-failed-redacted');
});
