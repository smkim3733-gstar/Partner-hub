import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backupTarget,
  assertBackupSource,
  assertBackupMarker,
  assertBackupPayload,
} from '../scripts/supabase-backup-target.mjs';
import { createBackup } from '../scripts/supabase-backup.mjs';

const verification = backupTarget('verification');
const production = backupTarget();
const config = {
  projectRef: verification.projectRef,
  appOrigin: verification.appOrigin,
  supabaseUrl: `https://${verification.projectRef}.supabase.co`,
  storageBucket: verification.storageBucket!,
  secretKey: 'sb_secret_synthetic_backup_only',
  databaseUrl: `postgresql://postgres.${verification.projectRef}:synthetic-only@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`,
};

void test('backup profiles cannot redirect verification to production or another project', () => {
  assert.doesNotThrow(() => assertBackupSource(config, verification));
  assert.throws(() => backupTarget('arbitrary'), /backup-scope-invalid/);
  assert.throws(
    () => assertBackupSource(config, production),
    /target-mismatch/,
  );
  for (const patch of [
    { projectRef: production.projectRef },
    { appOrigin: production.appOrigin },
    { supabaseUrl: `https://${production.projectRef}.supabase.co` },
    { storageBucket: 'partner-hub-private' },
    {
      databaseUrl: config.databaseUrl.replace(
        verification.projectRef,
        production.projectRef,
      ),
    },
    {
      databaseUrl: config.databaseUrl.replace(
        'pooler.supabase.com',
        'untrusted.invalid',
      ),
    },
    { databaseUrl: config.databaseUrl.replace(':6543/', ':5432/') },
  ])
    assert.throws(
      () => assertBackupSource({ ...config, ...patch }, verification),
      /target-mismatch/,
    );
});

void test('verification cannot inherit an operator connection and production cannot take a source override', async () => {
  // A nonexistent pg-bin proves rejection occurs before opening any DB or tool.
  const args = ['--pg-bin', 'nonexistent-synthetic-tools'];
  await assert.rejects(
    createBackup(args, { scope: 'verification' }),
    /verification-config-required/,
  );
  await assert.rejects(
    createBackup(args, { sourceConfig: config }),
    /source-override-rejected/,
  );
  await assert.rejects(
    createBackup(args, {
      scope: 'verification',
      sourceConfig: { ...config, projectRef: production.projectRef },
    }),
    /target-mismatch/,
  );
});

void test('restore requires the selected archive identity, purpose and verification bucket', () => {
  const payload = {
    format: 'partner-hub-backup-v1',
    source: { ...verification, schema: 'partner_hub' },
    database: { serverVersion: '17.6' },
    storage: { bucket: { id: verification.storageBucket } },
  };
  assert.doesNotThrow(() => assertBackupPayload(payload, verification));
  assert.throws(
    () => assertBackupPayload(payload, production),
    /payload-invalid/,
  );
  for (const source of [
    { ...payload.source, projectRef: production.projectRef },
    { ...payload.source, purpose: undefined },
    { ...payload.source, appOrigin: production.appOrigin },
  ])
    assert.throws(
      () => assertBackupPayload({ ...payload, source }, verification),
      /payload-invalid/,
    );
  assert.throws(
    () =>
      assertBackupPayload(
        { ...payload, storage: { bucket: { id: 'partner-hub-private' } } },
        verification,
      ),
    /payload-invalid/,
  );
  // Existing production archives need no new purpose field.
  assert.doesNotThrow(() =>
    assertBackupPayload(
      {
        ...payload,
        source: { ...production, schema: 'partner_hub' },
      },
      production,
    ),
  );
});

void test('a label cannot substitute for the singleton verification marker in the snapshot', async () => {
  const marker = {
    project_ref: verification.projectRef,
    purpose: verification.purpose,
  };
  for (const rows of [
    [],
    [marker, marker],
    [{ ...marker, project_ref: production.projectRef }],
    [{ ...marker, purpose: 'production' }],
  ]) {
    await assert.rejects(
      assertBackupMarker({ unsafe: async () => rows }, verification),
      /marker-mismatch/,
    );
  }
  await assertBackupMarker({ unsafe: async () => [marker] }, verification);
  await assertBackupMarker(
    {
      unsafe: async () => {
        throw new Error('Legacy production does not have this marker');
      },
    },
    production,
  );
});
