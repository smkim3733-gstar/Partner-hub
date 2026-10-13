// Operator-only policy. No credentials, database writes or global network calls.
import { createHash, randomUUID } from 'node:crypto';

export const cleanupLimits = Object.freeze({
  rows: 10_000,
  candidates: 20,
  planAgeMs: 900_000,
});
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const version =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const staging =
  /^partner-hub\/staging\/v1\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys) =>
  record(v) &&
  Object.keys(v).sort().join(',') ===
    [...keys].sort((a, b) => a.localeCompare(b)).join(',');
export function cleanupError(code) {
  return new Error(`CLEANUP_${code}`);
}
function requireValue(ok, code = 'INVALID_INPUT') {
  if (!ok) throw cleanupError(code);
}
export const cleanupHash = (v) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
const interrupted = (signal) => {
  if (signal?.aborted) throw cleanupError('INTERRUPTED');
};

export function cleanupTarget(target) {
  requireValue(
    exact(target, ['projectRef', 'bucket']) &&
      typeof target.projectRef === 'string' &&
      typeof target.bucket === 'string' &&
      /^[a-z0-9]{20}$/.test(target.projectRef) &&
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(target.bucket),
    'INVALID_TARGET',
  );
  return { projectRef: target.projectRef, bucket: target.bucket };
}

export function cleanupSnapshot(snapshot) {
  requireValue(
    exact(snapshot, ['target', 'now', 'rows']) &&
      Number.isSafeInteger(snapshot.now) &&
      snapshot.now > 0 &&
      Array.isArray(snapshot.rows) &&
      snapshot.rows.length <= cleanupLimits.rows,
  );
  const target = cleanupTarget(snapshot.target),
    ids = new Set(),
    paths = new Map();
  const rows = snapshot.rows
    .map((r) => {
      requireValue(
        exact(r, [
          'id',
          'file_path',
          'audio_path',
          'created_at',
          'expires_at',
          'retain_until',
        ]) &&
          typeof r.id === 'string' &&
          uuid.test(r.id) &&
          !ids.has(r.id) &&
          Number.isSafeInteger(r.created_at) &&
          r.created_at > 0 &&
          r.created_at <= snapshot.now &&
          Number.isSafeInteger(r.expires_at) &&
          Number.isSafeInteger(r.retain_until) &&
          r.expires_at === r.created_at + 600_000 &&
          r.retain_until === r.expires_at + 7_380_000 &&
          (r.file_path !== null || r.audio_path !== null) &&
          r.file_path !== r.audio_path,
        'INVALID_RESERVATION',
      );
      ids.add(r.id);
      const row = {
        id: r.id,
        file_path: r.file_path,
        audio_path: r.audio_path,
        created_at: r.created_at,
        expires_at: r.expires_at,
        retain_until: r.retain_until,
      };
      for (const slot of ['file', 'audio']) {
        const path = row[`${slot}_path`];
        requireValue(
          path === null || (typeof path === 'string' && staging.test(path)),
          'INVALID_PATH',
        );
        if (path !== null)
          paths.set(path, [...(paths.get(path) ?? []), { row, slot }]);
      }
      return row;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    target,
    now: snapshot.now,
    rows,
    paths,
    transfersHash: cleanupHash(rows),
  };
}

export function cleanupObject(value, path) {
  requireValue(
    exact(value, ['path', 'versionId', 'etag', 'size', 'modifiedAt']) &&
      value.path === path &&
      staging.test(path) &&
      (value.versionId === null ||
        (typeof value.versionId === 'string' &&
          version.test(value.versionId))) &&
      typeof value.etag === 'string' &&
      /^"[^"\r\n]{1,256}"$/.test(value.etag) &&
      Number.isSafeInteger(value.size) &&
      value.size >= 0 &&
      value.size <= 25 * 1024 * 1024 &&
      Number.isSafeInteger(value.modifiedAt) &&
      value.modifiedAt > 0,
    'INVALID_OBJECT',
  );
  return {
    path,
    versionId: value.versionId,
    etag: value.etag,
    size: value.size,
    modifiedAt: value.modifiedAt,
  };
}

export async function planStagingCleanup(snapshot, storage, signal) {
  const s = cleanupSnapshot(snapshot);
  interrupted(signal);
  await storage.assertPrivate(signal);
  const candidates = [],
    counts = {
      reservedPaths: s.paths.size,
      unexpired: 0,
      ambiguous: 0,
      missing: 0,
      unversioned: 0,
      lateObject: 0,
      deferred: 0,
    };
  for (const [path, refs] of [...s.paths].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    interrupted(signal);
    if (refs.length !== 1) {
      counts.ambiguous++;
      continue;
    }
    const { row, slot } = refs[0];
    if (row.retain_until >= s.now) {
      counts.unexpired++;
      continue;
    }
    if (candidates.length >= cleanupLimits.candidates) {
      counts.deferred++;
      continue;
    }
    const raw = await storage.info(path, null, signal);
    interrupted(signal);
    if (raw === null) {
      counts.missing++;
      continue;
    }
    const object = cleanupObject(raw, path);
    if (object.versionId === null) {
      counts.unversioned++;
      continue;
    }
    // Preserve late or inconsistent uploads for separate review.
    if (
      object.modifiedAt < row.created_at ||
      object.modifiedAt > row.retain_until
    ) {
      counts.lateObject++;
      continue;
    }
    candidates.push({
      transferId: row.id,
      slot,
      retainUntil: row.retain_until,
      ...object,
    });
  }
  const plan = {
    format: 'partner-hub-staging-cleanup-v1',
    target: s.target,
    createdAt: s.now,
    transfersHash: s.transfersHash,
    candidates,
    counts,
  };
  return { ...plan, hash: cleanupHash(plan) };
}

export function validateCleanupPlan(input) {
  // Freeze the reviewed value against caller mutation during asynchronous I/O.
  const p = JSON.parse(JSON.stringify(input));
  requireValue(
    exact(p, [
      'format',
      'target',
      'createdAt',
      'transfersHash',
      'candidates',
      'counts',
      'hash',
    ]) &&
      p.format === 'partner-hub-staging-cleanup-v1' &&
      Number.isSafeInteger(p.createdAt) &&
      p.createdAt > 0 &&
      /^[a-f0-9]{64}$/.test(p.transfersHash) &&
      Array.isArray(p.candidates) &&
      p.candidates.length <= cleanupLimits.candidates,
    'INVALID_PLAN',
  );
  const target = cleanupTarget(p.target),
    paths = new Set();
  const candidates = p.candidates.map((c) => {
    requireValue(
      exact(c, [
        'transferId',
        'slot',
        'retainUntil',
        'path',
        'versionId',
        'etag',
        'size',
        'modifiedAt',
      ]) &&
        uuid.test(c.transferId) &&
        ['file', 'audio'].includes(c.slot) &&
        Number.isSafeInteger(c.retainUntil) &&
        c.retainUntil > 0 &&
        c.retainUntil < p.createdAt &&
        !paths.has(c.path),
      'INVALID_PLAN',
    );
    const obj = cleanupObject(
      {
        path: c.path,
        versionId: c.versionId,
        etag: c.etag,
        size: c.size,
        modifiedAt: c.modifiedAt,
      },
      c.path,
    );
    requireValue(
      obj.versionId !== null && obj.modifiedAt <= c.retainUntil,
      'INVALID_PLAN',
    );
    paths.add(c.path);
    return {
      transferId: c.transferId,
      slot: c.slot,
      retainUntil: c.retainUntil,
      ...obj,
    };
  });
  const countKeys = [
    'reservedPaths',
    'unexpired',
    'ambiguous',
    'missing',
    'unversioned',
    'lateObject',
    'deferred',
  ];
  requireValue(
    exact(p.counts, countKeys) &&
      countKeys.every(
        (k) =>
          Number.isSafeInteger(p.counts[k]) &&
          p.counts[k] >= 0 &&
          p.counts[k] <= cleanupLimits.rows * 2,
      ),
    'INVALID_PLAN',
  );
  const counts = Object.fromEntries(countKeys.map((k) => [k, p.counts[k]]));
  requireValue(
    candidates.length +
      countKeys.slice(1).reduce((n, k) => n + counts[k], 0) ===
      counts.reservedPaths,
    'INVALID_PLAN',
  );
  const plan = {
    format: p.format,
    target,
    createdAt: p.createdAt,
    transfersHash: p.transfersHash,
    candidates,
    counts,
  };
  requireValue(cleanupHash(plan) === p.hash, 'PLAN_CHANGED');
  return { ...plan, hash: p.hash };
}

function freshSnapshot(plan, value) {
  const s = cleanupSnapshot(value);
  requireValue(
    cleanupHash(s.target) === cleanupHash(plan.target) &&
      s.transfersHash === plan.transfersHash,
    'RESERVATIONS_CHANGED',
  );
  requireValue(
    s.now >= plan.createdAt &&
      s.now - plan.createdAt <= cleanupLimits.planAgeMs,
    'PLAN_EXPIRED',
  );
  for (const c of plan.candidates) {
    const refs = s.paths.get(c.path);
    requireValue(
      refs?.length === 1 &&
        refs[0].row.id === c.transferId &&
        refs[0].slot === c.slot &&
        refs[0].row.retain_until === c.retainUntil &&
        c.retainUntil < s.now &&
        c.modifiedAt >= refs[0].row.created_at,
      'RESERVATIONS_CHANGED',
    );
  }
  return s;
}

export function cleanupConfirmation(input) {
  const p = validateCleanupPlan(input);
  return `DELETE EXPIRED STAGING ${p.target.projectRef}/${p.target.bucket} ${p.hash}`;
}

export async function applyStagingCleanup(
  input,
  dependencies,
  { confirmation, signal } = {},
) {
  const plan = validateCleanupPlan(input);
  requireValue(
    confirmation === cleanupConfirmation(plan),
    'CONFIRMATION_REQUIRED',
  );
  interrupted(signal);
  // Runtime implements a DB transaction/advisory lock plus SHARE table lock.
  // No SQL deletion of application or storage rows exists in this tool.
  return dependencies.withLock(async (snapshot) => {
    freshSnapshot(plan, await snapshot());
    await dependencies.storage.assertPrivate(signal);
    interrupted(signal);
    await dependencies.journal.start(plan.hash);
    const result = {
      reviewed: plan.candidates.length,
      removed: 0,
      absent: 0,
      changed: 0,
    };
    for (const c of plan.candidates) {
      interrupted(signal);
      freshSnapshot(plan, await snapshot());
      await dependencies.storage.assertPrivate(signal);
      const current = await dependencies.storage.info(c.path, null, signal);
      if (current === null) {
        result.absent++;
        await dependencies.journal.record({
          path: c.path,
          versionId: c.versionId,
          state: 'absent',
        });
        continue;
      }
      const expected = cleanupObject(
        {
          path: c.path,
          versionId: c.versionId,
          etag: c.etag,
          size: c.size,
          modifiedAt: c.modifiedAt,
        },
        c.path,
      );
      if (
        cleanupHash(cleanupObject(current, c.path)) !== cleanupHash(expected)
      ) {
        result.changed++;
        await dependencies.journal.record({
          path: c.path,
          versionId: c.versionId,
          state: 'changed-preserved',
        });
        continue;
      }
      // A legacy provider ignoring versionId must fail this negative probe.
      let probe = randomUUID();
      while (probe === c.versionId) probe = randomUUID();
      requireValue(
        (await dependencies.storage.info(c.path, probe, signal)) === null,
        'VERSION_API_UNCONFIRMED',
      );
      const exactVersion = await dependencies.storage.info(
        c.path,
        c.versionId,
        signal,
      );
      requireValue(
        exactVersion !== null &&
          cleanupHash(cleanupObject(exactVersion, c.path)) ===
            cleanupHash(expected),
        'VERSION_CHANGED',
      );
      interrupted(signal);
      freshSnapshot(plan, await snapshot());
      // Flush intent BEFORE a request whose outcome could be lost. Never retry it.
      await dependencies.journal.record({
        path: c.path,
        versionId: c.versionId,
        state: 'attempted',
      });
      interrupted(signal);
      try {
        await dependencies.storage.removeVersion(c.path, c.versionId, signal);
        interrupted(signal);
        requireValue(
          (await dependencies.storage.info(c.path, c.versionId, signal)) ===
            null,
          'OUTCOME_UNKNOWN',
        );
        await dependencies.journal.record({
          path: c.path,
          versionId: c.versionId,
          state: 'removed',
        });
      } catch {
        throw cleanupError('OUTCOME_UNKNOWN');
      }
      result.removed++;
    }
    await dependencies.journal.record({ state: 'completed', ...result });
    return result;
  });
}
