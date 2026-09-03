import {
  isPortalStorageTelemetry,
  type PortalStorageTelemetry,
} from '@/lib/pilot-readiness';
import {
  portalConflictReceiptFrom,
  portalConflictReceiptHeaders,
} from '@/lib/portal-conflict-receipt';

export type SaveStatus = 'saving' | 'saved' | 'error';
type State = { membersRevision?: number };
type Acknowledgement = { membersRevision?: number };

export class PortalSaveError extends Error {
  constructor(
    message: string,
    readonly recoveryReceipt?: string,
  ) {
    super(message);
    this.name = 'PortalSaveError';
  }
}

export type PortalSaveAcknowledgement = {
  ok: true;
  membersRevision: number;
  stateRevision: string;
  storage?: PortalStorageTelemetry;
};

function asObject(value: unknown) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** One writer per open page. Failed snapshots stay in memory for explicit retry. */
export class PortalSaveQueue<T extends State> {
  private latest: T | null = null;
  private latestKey = '';
  private confirmedKey = '';
  private revision = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flight: Promise<void> | null = null;
  private failed = false;
  private active = true;

  constructor(
    private readonly write: (state: T) => Promise<Acknowledgement>,
    private readonly report: (status: SaveStatus, error?: string) => void,
    private readonly acknowledge: (revision: number) => void = () => {},
    private readonly delay = 700,
  ) {}

  private key(state: T) {
    // A server acknowledgement must not trigger a second save by itself.
    return JSON.stringify({ ...state, membersRevision: 0 });
  }

  initialize(state: T) {
    this.revision = state.membersRevision ?? 0;
    this.latest = structuredClone(state);
    this.latestKey = this.confirmedKey = this.key(state);
  }

  activate() {
    this.active = true;
  }
  dispose() {
    this.active = false;
    this.cancelTimer();
  }
  hasUnsavedChanges() {
    return this.flight !== null || this.latestKey !== this.confirmedKey;
  }

  update(state: T) {
    const key = this.key(state);
    this.revision = Math.max(this.revision, state.membersRevision ?? 0);
    if (key === this.latestKey) return;
    this.latest = structuredClone(state);
    this.latestKey = key;
    this.cancelTimer();
    // Even a reversion must wait for the in-flight write before it is confirmed.
    if (this.flight) {
      if (this.active && !this.failed) this.report('saving');
      return;
    }
    if (!this.hasUnsavedChanges()) {
      this.failed = false;
      if (this.active) this.report('saved');
      return;
    }
    if (this.failed) return;
    if (this.active) this.report('saving');
    this.timer = setTimeout(() => {
      void this.flush().catch(() => {});
    }, this.delay);
  }

  flush(): Promise<void> {
    this.cancelTimer();
    if (this.flight) return this.flight;
    if (!this.active)
      return Promise.reject(new Error('저장 화면이 닫혔습니다.'));
    if (!this.latest || this.latestKey === this.confirmedKey)
      return Promise.resolve();
    this.flight = this.drain().finally(() => {
      this.flight = null;
      // An edit can arrive in the microtask between the last acknowledgement
      // and this cleanup. Do not strand it without a scheduled write.
      if (this.active && !this.failed && this.latestKey !== this.confirmedKey) {
        this.report('saving');
        this.timer = setTimeout(() => {
          void this.flush().catch(() => {});
        }, this.delay);
      }
    });
    return this.flight;
  }

  private async drain() {
    this.failed = false;
    try {
      while (
        this.active &&
        this.latest &&
        this.latestKey !== this.confirmedKey
      ) {
        const state = { ...this.latest, membersRevision: this.revision };
        const key = this.latestKey;
        this.report('saving');
        const acknowledgement = await this.write(state);
        this.revision = Math.max(
          this.revision,
          acknowledgement.membersRevision ?? 0,
        );
        this.confirmedKey = key;
        if (this.active) this.acknowledge(this.revision);
      }
      if (this.active) this.report('saved');
    } catch (error) {
      this.failed = true;
      // A lost response can mean the server saved successfully. Re-confirm even
      // if the user subsequently reverts to the previously acknowledged value.
      this.confirmedKey = '';
      if (this.active)
        this.report(
          'error',
          error instanceof Error
            ? error.message
            : '운영 데이터를 저장하지 못했습니다.',
        );
      throw error;
    }
  }

  private cancelTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

export async function putPortalSnapshot<T extends State>(
  state: T,
  expectedUserId: string,
  stateRevision?: string,
  recoveryReceipt?: string,
) {
  const response = await fetch('/api/state', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      ...(stateRevision ? { 'if-match': `"${stateRevision}"` } : {}),
      ...portalConflictReceiptHeaders(recoveryReceipt),
    },
    body: JSON.stringify({ state, expectedUserId }),
  });
  let rawPayload: unknown;
  try {
    rawPayload = await response.json();
  } catch {
    throw new PortalSaveError(
      '저장 응답을 읽지 못했습니다. 현재 화면을 유지하고 같은 내용을 다시 저장해 주세요.',
    );
  }
  const payload = asObject(rawPayload);
  if (!response.ok || payload?.ok !== true)
    throw new PortalSaveError(
      (typeof payload?.error === 'string' && payload.error.trim()
        ? payload.error
        : '저장 완료 응답을 확인하지 못했습니다. 같은 내용을 다시 저장해 주세요.'),
      portalConflictReceiptFrom(payload?.recoveryReceipt),
    );
  if (
    !Number.isSafeInteger(payload.membersRevision) ||
    Number(payload.membersRevision) < 0 ||
    typeof payload.stateRevision !== 'string' ||
    !payload.stateRevision.trim() ||
    (Object.hasOwn(payload, 'storage') &&
      !isPortalStorageTelemetry(payload.storage))
  )
    throw new PortalSaveError(
      '저장 완료 응답 형식이 올바르지 않습니다. 현재 화면을 유지하고 같은 내용을 다시 저장해 주세요.',
    );
  return {
    ok: true,
    membersRevision: payload.membersRevision as number,
    stateRevision: payload.stateRevision,
    ...(Object.hasOwn(payload, 'storage')
      ? { storage: payload.storage as PortalStorageTelemetry }
      : {}),
  } satisfies PortalSaveAcknowledgement;
}
