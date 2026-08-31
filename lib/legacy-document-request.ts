export type DocumentRequestItem = { name: string; required: boolean };

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value;
}

export function prepareDocumentRequest(items: DocumentRequestItem[], dueDate: string, outstandingNames: string[] = []) {
  if (!validDate(dueDate)) return { ok: false as const, field: 'dueDate' as const, error: '올바른 제출기한을 선택해 주세요.' };
  const outstanding = new Set(outstandingNames.map(name => name.trim().toLocaleLowerCase('ko-KR')));
  const normalized = new Map<string, DocumentRequestItem>();
  for (const item of items) {
    const name = item.name.trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase('ko-KR');
    const previous = normalized.get(key);
    normalized.set(key, { name: previous?.name ?? name, required: Boolean(previous?.required || item.required) });
  }
  const available = [...normalized.entries()].filter(([key]) => !outstanding.has(key)).map(([, item]) => item);
  if (!available.length) return { ok: false as const, field: 'items' as const, error: normalized.size ? '선택한 서류는 이미 제출 요청 중입니다.' : '요청할 서류를 한 건 이상 추가해 주세요.' };
  return { ok: true as const, items: available, dueDate, skippedOutstanding: normalized.size - available.length };
}
