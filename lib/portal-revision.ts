function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, stable(item)]),
    );
  return value;
}

/** Login counters are display metadata, never an editable business record. */
export async function portalRevision(state: unknown): Promise<string> {
  const data =
    state && typeof state === 'object' && !Array.isArray(state)
      ? ({ ...state } as Record<string, unknown>)
      : state;
  if (
    data &&
    typeof data === 'object' &&
    'members' in data &&
    Array.isArray(data.members)
  )
    data.members = data.members.map((member) => {
      if (!member || typeof member !== 'object') return member;
      const { lastLoginAt: _last, loginCount: _count, ...rest } = member;
      return rest;
    });
  const bytes = new TextEncoder().encode(JSON.stringify(stable(data)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
