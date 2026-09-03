type PortalStatePayload = {
  state?: unknown;
  error?: unknown;
};

export type PortalFlowProjectionRefreshResult<TState> =
  | { current: false }
  | { current: true; state: TState };

function asPayload(value: unknown): PortalStatePayload | null {
  return value !== null && typeof value === 'object'
    ? (value as PortalStatePayload)
    : null;
}

export class PortalFlowProjectionRefresh<TState> {
  private requestVersion = 0;

  constructor(private readonly isState: (value: unknown) => value is TState) {}

  cancel() {
    this.requestVersion += 1;
  }

  async refresh(
    request: () => Promise<Response>,
  ): Promise<PortalFlowProjectionRefreshResult<TState>> {
    const requestVersion = ++this.requestVersion;
    let response: Response;
    let rawPayload: unknown;
    try {
      response = await request();
      rawPayload = await response.json();
    } catch {
      if (requestVersion !== this.requestVersion) return { current: false };
      throw new Error('전체 진행판 응답을 읽지 못했습니다.');
    }

    if (requestVersion !== this.requestVersion) return { current: false };
    const payload = asPayload(rawPayload);
    if (!response.ok) {
      throw new Error(
        payload && typeof payload.error === 'string' && payload.error.trim()
          ? payload.error
          : '전체 진행판을 다시 불러오지 못했습니다.',
      );
    }
    if (!payload || !this.isState(payload.state))
      throw new Error('전체 진행판 응답 형식이 올바르지 않습니다.');
    return { current: true, state: payload.state };
  }
}
