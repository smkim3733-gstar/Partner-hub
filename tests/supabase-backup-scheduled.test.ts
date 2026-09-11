import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { scheduledBackup } from '../scripts/supabase-backup-scheduled.mjs';

// Every dependency capable of touching production is replaced. Files contain
// synthetic reports only and live under a fresh OS temporary directory.
const source = {
  projectRef: 'yievsveuxjnbygatvjtb',
  appOrigin: 'https://partner-hub-gamma-five.vercel.app',
  schema: 'partner_hub',
  commit: 'a'.repeat(40),
  pgDumpVersion: 'pg_dump (PostgreSQL) 17.6',
};
const storageLinkCheck = {
  versionCount: 0,
  activeHeadCount: 0,
  tombstoneHeadCount: 0,
  matchedObjects: 0,
  extraObjects: 0,
  totalReferencedBytes: 0,
};

async function fixture(
  run: (fx: Awaited<ReturnType<typeof createFixture>>) => Promise<void>,
) {
  const fx = await createFixture();
  try {
    await run(fx);
  } finally {
    const resolved = path.resolve(fx.root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(
      path.basename(resolved).startsWith('partner-backup-scheduled-test-'),
    );
    await rm(resolved, { recursive: true, force: true });
  }
}

async function createFixture() {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'partner-backup-scheduled-test-'),
  );
  const backupRoot = path.join(root, 'archives');
  const keyRoot = path.join(root, 'keys');
  const config = {
    command: 'run',
    pgBin: path.join(root, 'synthetic-pg-bin'),
    backupRoot,
    keyRoot,
  };
  let current = new Date('2024-01-01T15:05:00.000Z');
  let createCalls = 0;
  let verifyCalls = 0;
  let validateCalls = 0;
  let beforeCreate: (() => Promise<void>) | undefined;
  let verifyFailure: Error | undefined;
  let validationFailure: Error | undefined;
  let cleanup = true;
  const dependencies = {
    now: () => new Date(current),
    protect: async (directory: string) => {
      assert.equal(directory, path.join(backupRoot, 'schedule'));
    },
    create: async (args: string[], options: { reportResult: boolean }) => {
      createCalls++;
      assert.deepEqual(args, [
        '--pg-bin',
        config.pgBin,
        '--backup-dir',
        backupRoot,
        '--key-dir',
        keyRoot,
      ]);
      assert.equal(options.reportResult, false);
      await beforeCreate?.();
      return {
        status: 'created-unverified',
        restoreVerified: false,
        startedAt: current.toISOString(),
        completedAt: current.toISOString(),
        source,
        archiveSha256: 'b'.repeat(64),
        archiveFile: path.join(backupRoot, 'synthetic.phbackup'),
        keyFile: path.join(keyRoot, 'synthetic.key'),
        databaseTables: 38,
        databaseRows: 1,
        storageObjects: 0,
        storageBytes: 0,
        storageLinkCheck,
        sourceWrites: 0,
        separateDeviceKeyCopyVerified: false,
      };
    },
    verify: async (args: string[], options: { reportResult: boolean }) => {
      verifyCalls++;
      assert.deepEqual(args, [
        '--pg-bin',
        config.pgBin,
        '--archive',
        path.join(backupRoot, 'synthetic.phbackup'),
        '--key-file',
        path.join(keyRoot, 'synthetic.key'),
      ]);
      assert.equal(options.reportResult, false);
      if (verifyFailure) throw verifyFailure;
      return {
        status: 'verified-local-postgresql',
        verifiedAt: current.toISOString(),
        source,
        archiveSha256: 'b'.repeat(64),
        databaseTables: 38,
        databaseRows: 1,
        storageObjects: 0,
        storageBytes: 0,
        storageLinkCheck,
        sourceWrites: 0,
        schemaAndPermissionsEqual: true,
        tableContentsEqual: true,
        localRestorePlaintextRemoved: cleanup,
        remoteRestoreSupported: false,
        supabaseStorageRestoreVerified: false,
        separateDeviceKeyCopyVerified: false,
        storageCheck: 'empty-inventory-verified-no-file-restore-claim',
      };
    },
    validateStored: async (
      saved: Record<string, unknown>,
      archives: string,
      keys: string,
    ) => {
      validateCalls++;
      assert.equal(saved.status, 'verified');
      assert.equal(archives, backupRoot);
      assert.equal(keys, keyRoot);
      if (validationFailure) throw validationFailure;
    },
  };
  return {
    root,
    config,
    dependencies,
    run: () => scheduledBackup(config, dependencies),
    status: () =>
      scheduledBackup({ ...config, command: 'status' }, dependencies),
    counts: () => ({ createCalls, verifyCalls, validateCalls }),
    time: (value: string) => {
      current = new Date(value);
    },
    delayCreate: (handler: () => Promise<void>) => {
      beforeCreate = handler;
    },
    failVerification: (error: Error) => {
      verifyFailure = error;
    },
    failStoredValidation: (error: Error | undefined) => {
      validationFailure = error;
    },
    cleanup: (value: boolean) => {
      cleanup = value;
    },
    records: async () => {
      const directory = path.join(backupRoot, 'schedule');
      const names = (await readdir(directory)).filter((name) =>
        /^run-.+\.json$/.test(name),
      );
      return await Promise.all(
        names.map(
          async (name) =>
            JSON.parse(
              await readFile(path.join(directory, name), 'utf8'),
            ) as Record<string, unknown>,
        ),
      );
    },
  };
}

void test('scheduled backup creates and verifies one archive before recording success', async () => {
  await fixture(async (fx) => {
    const result = await fx.run();
    assert.equal(result.status, 'verified-scheduled-backup');
    assert.equal('health' in result && result.health, 'healthy');
    assert.deepEqual(fx.counts(), {
      createCalls: 1,
      verifyCalls: 1,
      validateCalls: 0,
    });
    const runs = await fx.records();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, 'verified');
    assert.equal(runs[0].phase, 'complete');
    const files = await readdir(path.join(fx.config.backupRoot, 'schedule'));
    assert.equal(files.includes('active.lock'), false);
    assert.ok(files.every((file) => !file.endsWith('.partial')));
  });
});

void test('concurrent scheduled run cannot create or verify while first run owns lock', async () => {
  await fixture(async (fx) => {
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fx.delayCreate(async () => {
      started!();
      await gate;
    });
    const first = fx.run();
    await ready;
    try {
      await assert.rejects(fx.run(), /backup-scheduled-lock-present/);
      const status = await fx.status();
      assert.equal('health' in status && status.health, 'run-incomplete');
      assert.deepEqual(fx.counts(), {
        createCalls: 1,
        verifyCalls: 0,
        validateCalls: 0,
      });
    } finally {
      release!();
    }
    assert.equal((await first).status, 'verified-scheduled-backup');
  });
});

void test('failed later verification preserves previous lastSuccess and redacts stored failure', async () => {
  await fixture(async (fx) => {
    await fx.run();
    const before = await fx.status();
    assert.ok('lastSuccess' in before);
    fx.time('2024-01-02T15:05:00.000Z');
    fx.failVerification(
      new Error('private-database-url and private-row-contents'),
    );
    await assert.rejects(fx.run());
    const after = await fx.status();
    assert.ok('lastSuccess' in after && 'lastAttempt' in after);
    assert.deepEqual(after.lastSuccess, before.lastSuccess);
    assert.equal(after.health, 'last-run-failed');
    assert.ok(after.lastAttempt);
    assert.equal(after.lastAttempt.status, 'failed');
    assert.equal(after.lastAttempt.error, 'backup-failed-redacted');
    assert.ok(!JSON.stringify(await fx.records()).includes('private-'));
  });
});

void test('cleanup false cannot be recorded as a successful scheduled backup', async () => {
  await fixture(async (fx) => {
    fx.cleanup(false);
    await assert.rejects(fx.run(), /backup-scheduled-verification-incomplete/);
    const status = await fx.status();
    assert.ok('lastSuccess' in status && 'lastAttempt' in status);
    assert.equal(status.lastSuccess, null);
    assert.ok(status.lastAttempt);
    assert.equal(status.lastAttempt.status, 'failed');
    assert.equal(status.health, 'last-run-failed');
    assert.equal(
      (await fx.records()).filter((run) => run.status === 'verified').length,
      0,
    );
  });
});

void test('same Korean calendar day revalidates stored archive without creating another', async () => {
  await fixture(async (fx) => {
    // UTC dates differ; both instants are January 2 in Asia/Seoul.
    await fx.run();
    fx.time('2024-01-02T14:50:00.000Z');
    const result = await fx.run();
    assert.equal(result.status, 'already-verified-today');
    assert.equal('backupDay' in result && result.backupDay, '2024-01-02');
    assert.deepEqual(fx.counts(), {
      createCalls: 1,
      verifyCalls: 1,
      validateCalls: 1,
    });
    const runs = await fx.records();
    assert.equal(runs.filter((run) => run.status === 'verified').length, 1);
    assert.equal(runs.filter((run) => run.status === 'revalidated').length, 1);
    // Crossing KST midnight allows the next daily backup.
    fx.time('2024-01-02T15:01:00.000Z');
    assert.equal((await fx.run()).status, 'verified-scheduled-backup');
    assert.deepEqual(fx.counts(), {
      createCalls: 2,
      verifyCalls: 2,
      validateCalls: 1,
    });
  });
});

void test('same day duplicate does not claim success when stored archive validation fails', async () => {
  await fixture(async (fx) => {
    await fx.run();
    fx.failStoredValidation(new Error('synthetic corrupted archive'));
    await assert.rejects(fx.run(), /synthetic corrupted archive/);
    assert.deepEqual(fx.counts(), {
      createCalls: 1,
      verifyCalls: 1,
      validateCalls: 1,
    });
    assert.equal(
      (await readdir(path.join(fx.config.backupRoot, 'schedule'))).includes(
        'active.lock',
      ),
      false,
    );
  });
});

void test('stale lock is preserved for operator inspection and is never automatically removed', async () => {
  await fixture(async (fx) => {
    const directory = path.join(fx.config.backupRoot, 'schedule');
    await mkdir(directory, { recursive: true });
    const lock = path.join(directory, 'active.lock');
    const original = JSON.stringify({
      owner: 'synthetic-old-owner',
      pid: 999999,
      startedAt: '2020-01-01T00:00:00.000Z',
    });
    await writeFile(lock, original, { flag: 'wx' });
    await assert.rejects(fx.run(), /backup-scheduled-lock-present/);
    assert.equal(await readFile(lock, 'utf8'), original);
    assert.deepEqual(fx.counts(), {
      createCalls: 0,
      verifyCalls: 0,
      validateCalls: 0,
    });
    const status = await fx.status();
    assert.equal('health' in status && status.health, 'run-incomplete');
  });
});

void test('successful revalidation recovers a transient failure without adding another retained backup', async () => {
  await fixture(async (fx) => {
    await fx.run();
    fx.time('2024-01-01T15:06:00.000Z');
    fx.failStoredValidation(
      new Error('synthetic transient validation failure'),
    );
    await assert.rejects(fx.run());
    fx.failStoredValidation(undefined);
    fx.time('2024-01-01T15:07:00.000Z');
    const failed = await fx.status();
    assert.equal('health' in failed && failed.health, 'last-run-failed');
    fx.time('2024-01-01T15:08:00.000Z');
    assert.equal((await fx.run()).status, 'already-verified-today');
    const recovered = await fx.status();
    assert.ok('lastAttempt' in recovered && 'lastSuccess' in recovered);
    assert.equal(recovered.health, 'healthy');
    assert.equal(recovered.lastAttempt?.status, 'revalidated');
    assert.equal(recovered.lastSuccess?.status, 'verified');
    assert.equal(
      recovered.lastSuccess?.completedAt,
      '2024-01-01T15:05:00.000Z',
    );
    assert.equal(recovered.retention.recentVerified, 1);
    assert.equal(recovered.retention.failed, 1);
    assert.equal(fx.counts().createCalls, 1);
    assert.equal(fx.counts().verifyCalls, 1);
    const runs = await fx.records();
    assert.equal(runs.length, 3);
    assert.equal(runs.filter((run) => run.status === 'verified').length, 1);
    assert.ok(!JSON.stringify(recovered).includes('synthetic.key'));
    assert.ok(!JSON.stringify(recovered).includes('synthetic.phbackup'));
  });
});

void test('status validates the latest stored archive and rejects a missing or damaged artifact', async () => {
  await fixture(async (fx) => {
    await fx.run();
    fx.failStoredValidation(new Error('synthetic artifact missing'));
    await assert.rejects(fx.status(), /synthetic artifact missing/);
    assert.deepEqual(fx.counts(), {
      createCalls: 1,
      verifyCalls: 1,
      validateCalls: 1,
    });
  });
});

void test('status distinguishes no backup, healthy and overdue without running a backup', async () => {
  await fixture(async (fx) => {
    const first = await fx.status();
    assert.equal('health' in first && first.health, 'needs-first-run');
    assert.deepEqual(fx.counts(), {
      createCalls: 0,
      verifyCalls: 0,
      validateCalls: 0,
    });
    await fx.run();
    fx.time('2024-01-03T04:05:00.000Z');
    const overdue = await fx.status();
    assert.ok('health' in overdue && 'ageHours' in overdue);
    assert.equal(overdue.health, 'backup-overdue');
    assert.equal(overdue.ageHours, 37);
    assert.equal(overdue.retention.automaticDeletion, false);
    assert.equal(overdue.externalBackupCopyVerified, false);
    assert.equal(overdue.separateDeviceKeyCopyVerified, false);
    assert.deepEqual(fx.counts(), {
      createCalls: 1,
      verifyCalls: 1,
      validateCalls: 1,
    });
  });
});
