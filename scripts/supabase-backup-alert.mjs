// Local preparation only. This module has no mail/network transport.
import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Confirmed by the operator on 2026-10-21. Authentication is not configured.
export const BACKUP_ALERT_MAIL = Object.freeze({
  fromName: '주식회사 한국기업가치평가원',
  from: 'smkim3733@naver.com',
  to: 'smkim3733@naver.com',
});

const hour = 3_600_000;
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value))
    return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function buildBackupAlert(report, { synthetic = false } = {}) {
  const checkedAt = timestamp(report.checkedAt);
  if (!checkedAt) throw new Error('backup-alert-time-invalid');
  const startedAt = timestamp(report.lastAttempt?.startedAt);
  const lastSuccessAt = timestamp(report.lastSuccess?.completedAt);
  let code;
  let reason;
  let anchor;
  switch (report.health) {
    case 'healthy':
    case 'needs-first-run':
      return null;
    case 'last-run-failed':
      code = 'BACKUP_FAILED';
      reason =
        '최근 백업 실행이 실패했습니다. 마지막 정상 백업을 보존하고 실행 기록을 확인하세요.';
      anchor = startedAt ?? 'unknown-attempt';
      break;
    case 'backup-overdue':
      code = 'BACKUP_OVERDUE';
      reason =
        '정상 백업 시각이 36시간을 초과했거나 시각 정보가 유효하지 않습니다. 예약 실행 상태를 확인하세요.';
      anchor = lastSuccessAt ?? 'unknown-success';
      break;
    case 'run-incomplete': {
      const runningStartedAt =
        report.activeRun === undefined
          ? startedAt
          : timestamp(report.activeRun?.startedAt);
      // A normal in-progress backup must not be reported as a failure.
      if (
        runningStartedAt &&
        Date.parse(checkedAt) >= Date.parse(runningStartedAt) &&
        Date.parse(checkedAt) - Date.parse(runningStartedAt) < 2 * hour
      )
        return null;
      code = 'BACKUP_RUN_REVIEW';
      reason =
        '백업이 2시간 이상 진행 중이거나 실행 시각을 확인할 수 없습니다. 잠금과 프로세스를 확인하고 잠금을 임의로 삭제하지 마세요.';
      anchor = runningStartedAt ?? 'unknown-running-attempt';
      break;
    }
    case 'check-failed':
      code = 'BACKUP_CHECK_FAILED';
      reason =
        '백업 명령 또는 상태 확인을 완료하지 못했습니다. 로컬 실행 기록을 확인하세요.';
      anchor = 'until-recovery';
      break;
    default:
      throw new Error('backup-alert-health-invalid');
  }
  const incidentId = createHash('sha256')
    .update(JSON.stringify([synthetic, BACKUP_ALERT_MAIL, code, anchor]))
    .digest('hex');
  return {
    incidentId,
    code,
    checkedAt,
    synthetic,
    message: {
      ...BACKUP_ALERT_MAIL,
      subject: `${synthetic ? '[시험]' : '[점검 필요]'} Partner Hub 백업 알림`,
      text: [
        synthetic
          ? '가상 상황으로 만든 시험 알림입니다. 실제 장애가 아닙니다.'
          : 'Partner Hub 백업 점검이 필요합니다.',
        `점검 시각(UTC): ${checkedAt}`,
        `알림 코드: ${code}`,
        `마지막 정상 백업(UTC): ${lastSuccessAt ?? '확인되지 않음'}`,
        reason,
      ].join('\n'),
    },
  };
}

async function readState(file) {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 8192)
      throw new Error('backup-alert-state-invalid');
    const state = JSON.parse(await readFile(file, 'utf8'));
    if (
      state.version !== 1 ||
      (state.incidentId !== null && !/^[a-f0-9]{64}$/.test(state.incidentId))
    )
      throw new Error('backup-alert-state-invalid');
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// directory must be the scheduler's protected, non-synced control directory.
// This state records preparation only, never delivery or recipient receipt.
export async function prepareBackupAlert(report, directory, options = {}) {
  const alert = buildBackupAlert(report, options);
  const base = {
    mode: 'local-preview',
    transportConfigured: false,
    sent: false,
    receiptVerified: false,
  };
  const prefix = options.synthetic
    ? 'synthetic-alert-preview'
    : 'alert-preview';
  const stateFile = path.join(directory, `${prefix}.json`);
  const lockFile = path.join(directory, `${prefix}.lock`);
  let lock;
  try {
    lock = await open(lockFile, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') return { ...base, status: 'preparation-busy' };
    throw error;
  }
  let temporary;
  try {
    const previous = await readState(stateFile);
    if (!alert && (report.health !== 'healthy' || !previous?.incidentId))
      return { ...base, status: 'not-required' };
    if (alert && previous?.incidentId === alert.incidentId)
      return {
        ...base,
        status: 'already-prepared',
        incidentId: alert.incidentId,
      };
    temporary = `${stateFile}.${randomUUID()}.partial`;
    await writeFile(
      temporary,
      JSON.stringify(
        {
          version: 1,
          incidentId: alert?.incidentId ?? null,
          checkedAt: report.checkedAt,
          ...base,
          alert,
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    await rename(temporary, stateFile);
    temporary = undefined;
    return {
      ...base,
      status: alert ? 'prepared' : 'cleared-after-healthy',
      alert,
    };
  } finally {
    if (temporary) await rm(temporary, { force: true });
    await lock.close();
    await rm(lockFile);
  }
}
