import {
  companyFileBucket,
  companyFileObjectMatchesIntegrity,
  findCompanyFile,
  isCompanyFileIntakeVisible,
  readCompanyFileObjectIntegrity,
} from './company-files';
import { diagnosisDocumentsForCase } from './diagnosis-preflight';

type Member = { id: string; name: string; status: string };
type CaseRecord = {
  id: string;
  company: string;
  trainee: string;
  partnerMemberId?: string;
};
type DiagnosisDocument = {
  company: string;
  assignedTrainee: string;
  caseId?: string;
  partnerMemberId?: string;
  category: string;
  status: string;
  storageFileId?: string;
};
type Assessment = {
  caseId: string;
  company: string;
  level: string;
  identityStatus: string;
  hasConsultationEvidence: boolean;
  privacyMasked: boolean;
  personalDataConsent: boolean;
  thirdPartyAiConsent: boolean;
  transcriptConsent: boolean;
};

type DiagnosisState = {
  members: Member[];
  cases: CaseRecord[];
  companyDocuments: DiagnosisDocument[];
  diagnosisAssessments: Assessment[];
};

export type StepZeroPreflight = {
  eligible: boolean;
  reason?: string;
};

function stateArrays(rawState: unknown): DiagnosisState | null {
  if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState))
    return null;
  const state = rawState as Record<string, unknown>;
  if (
    !Array.isArray(state.members) ||
    !Array.isArray(state.cases) ||
    !Array.isArray(state.companyDocuments) ||
    !Array.isArray(state.diagnosisAssessments)
  )
    return null;
  return state as unknown as DiagnosisState;
}

/** Recheck the current persisted state and stored objects immediately before a paid AI call. */
export async function stepZeroPreflight(
  rawState: unknown,
  caseId: string,
  company: string,
): Promise<StepZeroPreflight> {
  const state = stateArrays(rawState);
  if (!state)
    return { eligible: false, reason: '사전점검 데이터가 완전하지 않습니다.' };

  const matchingCases = state.cases.filter(
    (item) => item?.id === caseId && item.company === company,
  );
  const matchingAssessments = state.diagnosisAssessments.filter(
    (item) => item?.caseId === caseId && item.company === company,
  );
  if (matchingCases.length !== 1 || matchingAssessments.length !== 1)
    return {
      eligible: false,
      reason: '현재 진행과 사전판정을 하나로 확인할 수 없습니다.',
    };

  const selectedCase = matchingCases[0];
  const assessment = matchingAssessments[0];
  const consentReady =
    assessment.level === 'A' &&
    assessment.identityStatus === '일치' &&
    assessment.hasConsultationEvidence === true &&
    assessment.privacyMasked === true &&
    assessment.personalDataConsent === true &&
    assessment.thirdPartyAiConsent === true &&
    assessment.transcriptConsent === true;
  if (!consentReady)
    return {
      eligible: false,
      reason: '현재 판정과 필수 동의를 다시 확인해 주세요.',
    };

  const evidence = diagnosisDocumentsForCase(
    caseId,
    state.companyDocuments,
    state.cases,
    state.members,
  );
  const stored = await Promise.all(
    evidence.map(async (document) => {
      const fileId = document.storageFileId!;
      const row = await findCompanyFile(fileId);
      if (
        !row ||
        !(await isCompanyFileIntakeVisible(fileId)) ||
        row.company !== selectedCase.company ||
        row.case_id !== selectedCase.id ||
        row.category !== document.category ||
        row.partner_member_id == null ||
        row.partner_member_id !== selectedCase.partnerMemberId
      )
        return null;
      const integrity = await readCompanyFileObjectIntegrity(row);
      const object = await companyFileBucket().head(row.storage_key);
      if (!object || !companyFileObjectMatchesIntegrity(row, object, integrity))
        return null;
      return document.category;
    }),
  );
  const categories = new Set(
    stored.filter((item): item is string => item != null),
  );
  if (
    !categories.has('사업자등록증') ||
    (!categories.has('크레탑') && !categories.has('재무제표'))
  )
    return {
      eligible: false,
      reason:
        '이 진행에 연결된 사업자등록증과 재무·신용 원본을 다시 확인해 주세요.',
    };

  return { eligible: true };
}
