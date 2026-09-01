import { recordBelongsToCase } from './application-case-links';

type Member = { id: string; name: string; status: string };
type CaseRecord = { id: string; company: string; trainee: string; partnerMemberId?: string };
type DiagnosisDocument = {
  company: string;
  assignedTrainee: string;
  caseId?: string;
  partnerMemberId?: string;
  status: string;
};

/** Select evidence by the stored case/account link; never by company name alone. */
export function diagnosisDocumentsForCase<T extends DiagnosisDocument>(
  caseId: string,
  documents: T[],
  cases: CaseRecord[],
  members: Member[],
) {
  const selected = cases.find(item => item.id === caseId);
  if (!selected) return [];
  return documents.filter(document =>
    (document.status === '제출완료' || document.status === '검토완료')
    && recordBelongsToCase(document, document.assignedTrainee, selected, cases, members),
  );
}

export function hasOpenDiagnosisReviewTask(
  tasks: Array<{ caseId?: string; related: string; status: string }>,
  caseId: string,
) {
  return tasks.some(task =>
    task.caseId === caseId
    && task.related === 'AI 진단 사전점검'
    && task.status !== '완료',
  );
}
