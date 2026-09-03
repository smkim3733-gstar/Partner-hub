export type PortalCaseSearchCandidate = {
  id: string;
  company: string;
};

export type PortalCaseSearchResult<T extends PortalCaseSearchCandidate> =
  | { kind: 'empty' }
  | { kind: 'none' }
  | { kind: 'ambiguous'; count: number }
  | { kind: 'match'; item: T };

function normalizeSearchText(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase('ko-KR').replace(/\s+/g, ' ');
}

function classify<T extends PortalCaseSearchCandidate>(matches: T[]): PortalCaseSearchResult<T> {
  if (matches.length === 0) return { kind: 'none' };
  if (matches.length === 1) return { kind: 'match', item: matches[0] };
  return { kind: 'ambiguous', count: matches.length };
}

export function resolvePortalCaseSearch<T extends PortalCaseSearchCandidate>(
  candidates: T[],
  query: string,
): PortalCaseSearchResult<T> {
  const needle = normalizeSearchText(query);
  if (!needle) return { kind: 'empty' };

  const byExactId = candidates.filter((candidate) => {
    const id = normalizeSearchText(candidate.id);
    return id === needle || normalizeSearchText(candidate.id.slice(-8)) === needle;
  });
  if (byExactId.length) return classify(byExactId);

  const byExactCompany = candidates.filter(
    (candidate) => normalizeSearchText(candidate.company) === needle,
  );
  if (byExactCompany.length) return classify(byExactCompany);

  const partial = candidates.filter((candidate) => {
    const id = normalizeSearchText(candidate.id);
    const company = normalizeSearchText(candidate.company);
    return id.includes(needle) || company.includes(needle);
  });
  return classify(partial);
}
