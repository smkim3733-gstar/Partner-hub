import { assignmentMemberId } from './assignment-display';

type Member = { id: string; name: string; status: string };
type CaseRecord = {
  id: string;
  company: string;
  trainee: string;
  partnerMemberId?: string;
};
type RelatedRecord = {
  company: string;
  caseId?: string;
  partnerMemberId?: string;
};

/** A repeat application is a separate case, even for the same company/account. */
export function prependApplicationCase<T extends { id: string }>(
  current: T[],
  created: T,
): T[] {
  return current.some((item) => item.id === created.id)
    ? current
    : [created, ...current];
}

/** Never infer one case from a company name shared by multiple applications. */
export function recordBelongsToCase(
  record: RelatedRecord,
  legacyOwner: string,
  selected: CaseRecord,
  cases: CaseRecord[],
  members: Member[],
): boolean {
  const selectedOwner = assignmentMemberId(selected, selected.trainee, members);
  const recordOwner = assignmentMemberId(record, legacyOwner, members);
  if (record.caseId != null) {
    if (record.caseId !== selected.id) return false;
    return (
      record.partnerMemberId == null ||
      (selectedOwner !== null && recordOwner === selectedOwner)
    );
  }
  if (recordOwner === null || selectedOwner !== recordOwner) return false;
  const candidates = cases.filter(
    (item) =>
      item.company === record.company &&
      assignmentMemberId(item, item.trainee, members) === recordOwner,
  );
  return candidates.length === 1 && candidates[0].id === selected.id;
}
