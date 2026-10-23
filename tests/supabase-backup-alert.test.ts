import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  BACKUP_ALERT_MAIL,
  buildBackupAlert,
  prepareBackupAlert,
} from '../scripts/supabase-backup-alert.mjs';

const failed = {
  health: 'last-run-failed',
  checkedAt: '2026-10-21T02:00:00.000Z',
  lastAttempt: {
    startedAt: '2026-10-21T01:00:00.000Z',
    error: 'private-password-and-client-data',
  },
  lastSuccess: { completedAt: '2026-10-20T01:00:00.000Z' },
};

async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'partner-backup-alert-test-'),
  );
  try {
    await run(directory);
  } finally {
    assert.equal(
      path.dirname(path.resolve(directory)),
      path.resolve(os.tmpdir()),
    );
    assert.ok(
      path.basename(directory).startsWith('partner-backup-alert-test-'),
    );
    await rm(directory, { recursive: true, force: true });
  }
}

void test('confirmed recipient and sender produce a safe preview without raw errors or backup material', () => {
  const alert = buildBackupAlert({
    ...failed,
    archiveFile: 'private-archive',
    keyFile: 'private-key',
    source: 'private-url',
  });
  assert.ok(alert);
  assert.equal(alert.code, 'BACKUP_FAILED');
  assert.equal(alert.message.to, 'smkim3733@naver.com');
  assert.equal(alert.message.from, 'smkim3733@naver.com');
  assert.equal(alert.message.fromName, '주식회사 한국기업가치평가원');
  assert.equal(Object.isFrozen(BACKUP_ALERT_MAIL), true);
  assert.ok(!JSON.stringify(alert).includes('private-'));
  assert.match(alert.message.text, /2026-10-20T01:00:00.000Z/);
});

void test('healthy and first-run setup do not create failure alerts', () => {
  assert.equal(buildBackupAlert({ ...failed, health: 'healthy' }), null);
  assert.equal(
    buildBackupAlert({ ...failed, health: 'needs-first-run' }),
    null,
  );
});

void test('a running backup receives a two-hour grace period, with a review alert at the boundary', () => {
  assert.equal(buildBackupAlert({ ...failed, health: 'run-incomplete' }), null);
  assert.equal(
    buildBackupAlert({
      ...failed,
      health: 'run-incomplete',
      checkedAt: '2026-10-21T03:00:00.000Z',
    })?.code,
    'BACKUP_RUN_REVIEW',
  );
  assert.equal(
    buildBackupAlert({ ...failed, health: 'run-incomplete', lastAttempt: null })
      ?.code,
    'BACKUP_RUN_REVIEW',
  );
});

void test('overdue incident identity ignores poll times but changes with a new successful backup', () => {
  const first = buildBackupAlert({ ...failed, health: 'backup-overdue' });
  const later = buildBackupAlert({
    ...failed,
    health: 'backup-overdue',
    checkedAt: '2026-10-22T02:00:00.000Z',
  });
  const newBackup = buildBackupAlert({
    ...failed,
    health: 'backup-overdue',
    lastSuccess: { completedAt: '2026-10-21T01:00:00.000Z' },
  });
  assert.equal(first?.incidentId, later?.incidentId);
  assert.notEqual(first?.incidentId, newBackup?.incidentId);
});

void test('invalid timestamps and unknown health fail closed without echoing arbitrary input', () => {
  assert.throws(
    () => buildBackupAlert({ ...failed, checkedAt: 'private-token' }),
    /^Error: backup-alert-time-invalid$/,
  );
  assert.throws(
    () => buildBackupAlert({ ...failed, health: 'private-token' }),
    /^Error: backup-alert-health-invalid$/,
  );
  const redacted = buildBackupAlert({
    ...failed,
    lastSuccess: { completedAt: 'private-token' },
  });
  assert.ok(!JSON.stringify(redacted).includes('private-token'));
});

void test('repeated and concurrent preparation persist one draft and never claim delivery', async () => {
  await fixture(async (directory) => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => prepareBackupAlert(failed, directory)),
    );
    assert.equal(
      results.filter((item) => item.status === 'prepared').length,
      1,
    );
    for (const result of results) {
      assert.equal(result.sent, false);
      assert.equal(result.receiptVerified, false);
      assert.equal(result.transportConfigured, false);
    }
    const before = await readFile(
      path.join(directory, 'alert-preview.json'),
      'utf8',
    );
    const again = await prepareBackupAlert(
      { ...failed, checkedAt: '2026-10-21T02:15:00.000Z' },
      directory,
    );
    assert.equal(again.status, 'already-prepared');
    assert.equal(
      await readFile(path.join(directory, 'alert-preview.json'), 'utf8'),
      before,
    );
    assert.deepEqual(await readdir(directory), ['alert-preview.json']);
    assert.ok(!before.includes('private-'));
  });
});

void test('new failure is prepared and a confirmed healthy state permits a later recurrence', async () => {
  await fixture(async (directory) => {
    await prepareBackupAlert(failed, directory);
    const next = {
      ...failed,
      lastAttempt: { startedAt: '2026-10-21T01:30:00.000Z' },
    };
    assert.equal(
      (await prepareBackupAlert(next, directory)).status,
      'prepared',
    );
    assert.equal(
      (await prepareBackupAlert({ ...failed, health: 'healthy' }, directory))
        .status,
      'cleared-after-healthy',
    );
    assert.equal(
      (await prepareBackupAlert(next, directory)).status,
      'prepared',
    );
  });
});

void test('synthetic test previews cannot suppress real alerts and are explicitly labelled', async () => {
  await fixture(async (directory) => {
    const preview = await prepareBackupAlert(failed, directory, {
      synthetic: true,
    });
    assert.ok('alert' in preview && preview.alert);
    assert.match(preview.alert.message.subject, /^\[시험\]/);
    assert.match(preview.alert.message.text, /실제 장애가 아닙니다/);
    assert.equal(
      (await prepareBackupAlert(failed, directory)).status,
      'prepared',
    );
    assert.deepEqual((await readdir(directory)).sort(), [
      'alert-preview.json',
      'synthetic-alert-preview.json',
    ]);
  });
});

void test('in-progress and setup states do not erase an earlier failure preview', async () => {
  await fixture(async (directory) => {
    await prepareBackupAlert(failed, directory);
    await prepareBackupAlert(
      { ...failed, health: 'run-incomplete' },
      directory,
    );
    await prepareBackupAlert(
      { ...failed, health: 'needs-first-run' },
      directory,
    );
    assert.equal(
      (await prepareBackupAlert(failed, directory)).status,
      'already-prepared',
    );
  });
});

void test('corrupt preview state is preserved and the owned preparation lock is released', async () => {
  await fixture(async (directory) => {
    const stateFile = path.join(directory, 'alert-preview.json');
    await writeFile(stateFile, '{invalid', { flag: 'wx' });
    await assert.rejects(prepareBackupAlert(failed, directory));
    assert.equal(await readFile(stateFile, 'utf8'), '{invalid');
    assert.deepEqual(await readdir(directory), ['alert-preview.json']);
  });
});

void test('an existing preparation lock is never removed or overridden', async () => {
  await fixture(async (directory) => {
    const lock = path.join(directory, 'alert-preview.lock');
    await writeFile(lock, 'existing-owner', { flag: 'wx' });
    assert.equal(
      (await prepareBackupAlert(failed, directory)).status,
      'preparation-busy',
    );
    assert.equal(await readFile(lock, 'utf8'), 'existing-owner');
  });
});
