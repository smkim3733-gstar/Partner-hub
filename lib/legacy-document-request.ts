export type DocumentRequestItem = { name: string };

export const documentRequestItemNameMaxLength = 150;
export const documentRequestSuggestions = [
  '사업자등록증',
  '크레탑 기업정보',
  '최근 3개년 재무제표',
  '부가가치세 과세표준증명',
] as const;

function nameKey(name: string) {
  return name.trim().toLocaleLowerCase('ko-KR');
}

export function emptyDocumentRequestItems(): DocumentRequestItem[] {
  return [];
}

export function prepareDocumentRequestItem(
  nameInput: string,
  existingNames: string[] = [],
) {
  const name = nameInput.trim();
  if (!name)
    return { ok: false as const, field: 'name' as const, error: '추가할 서류명을 입력해 주세요.' };
  if (name.length > documentRequestItemNameMaxLength)
    return { ok: false as const, field: 'name' as const, error: `서류명은 ${documentRequestItemNameMaxLength}자 이하로 입력해 주세요.` };
  if (new Set(existingNames.map(nameKey)).has(nameKey(name)))
    return { ok: false as const, field: 'name' as const, error: '이미 추가했거나 요청 중인 서류입니다.' };
  return { ok: true as const, item: { name } };
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value;
}

export function prepareDocumentRequest(items: DocumentRequestItem[], dueDate: string, outstandingNames: string[] = []) {
  if (!validDate(dueDate)) return { ok: false as const, field: 'dueDate' as const, error: '올바른 제출기한을 선택해 주세요.' };
  const outstanding = new Set(outstandingNames.map(nameKey));
  const normalized = new Map<string, DocumentRequestItem>();
  for (const item of items) {
    const name = item.name.trim();
    if (!name) continue;
    if (name.length > documentRequestItemNameMaxLength)
      return { ok: false as const, field: 'items' as const, error: `서류명은 ${documentRequestItemNameMaxLength}자 이하로 입력해 주세요.` };
    const key = nameKey(name);
    const previous = normalized.get(key);
    normalized.set(key, { name: previous?.name ?? name });
  }
  const available = [...normalized.entries()].filter(([key]) => !outstanding.has(key)).map(([, item]) => item);
  if (!available.length) return { ok: false as const, field: 'items' as const, error: normalized.size ? '선택한 서류는 이미 제출 요청 중입니다.' : '요청할 서류를 한 건 이상 추가해 주세요.' };
  return { ok: true as const, items: available, dueDate, skippedOutstanding: normalized.size - available.length };
}
