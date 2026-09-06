export type FlowCommandPendingRetry = {
  key: string;
  id: string;
};

type RetryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const STORAGE_KEY = 'partner-hub:consulting-flow:pending-upload:v1';
const MAX_STORED_BYTES = 512;

type StoredRetry = FlowCommandPendingRetry & { caseId: string };

function validStoredRetry(value: unknown): value is StoredRetry {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<StoredRetry>;
  return (
    typeof item.caseId === 'string' &&
    /^[A-Za-z0-9_-]{1,120}$/.test(item.caseId) &&
    typeof item.key === 'string' &&
    /^[0-9a-f]{64}$/.test(item.key) &&
    typeof item.id === 'string' &&
    /^[A-Za-z0-9_-]{8,100}$/.test(item.id)
  );
}

function readStoredRetry(storage: RetryStorage): StoredRetry | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    if (raw.length > MAX_STORED_BYTES) {
      storage.removeItem(STORAGE_KEY);
      return null;
    }
    const value: unknown = JSON.parse(raw);
    if (!validStoredRetry(value)) {
      storage.removeItem(STORAGE_KEY);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

/**
 * Restores only opaque idempotency metadata for an identical attachment retry.
 * Command text and file bytes remain outside browser storage.
 */
export function restoreFlowCommandPendingRetry(
  storage: RetryStorage | undefined,
  caseId: string,
  key: string,
): FlowCommandPendingRetry | null {
  if (!storage) return null;
  const value = readStoredRetry(storage);
  return value?.caseId === caseId && value.key === key
    ? { key: value.key, id: value.id }
    : null;
}

export function rememberFlowCommandPendingRetry(
  storage: RetryStorage | undefined,
  caseId: string,
  retry: FlowCommandPendingRetry,
) {
  if (!storage || !validStoredRetry({ caseId, ...retry })) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ caseId, ...retry }));
    return true;
  } catch {
    return false;
  }
}

export function clearFlowCommandPendingRetry(
  storage: RetryStorage | undefined,
  caseId: string,
  retry: FlowCommandPendingRetry,
) {
  if (!storage) return false;
  const value = readStoredRetry(storage);
  if (
    !value ||
    value.caseId !== caseId ||
    value.key !== retry.key ||
    value.id !== retry.id
  )
    return false;
  try {
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
