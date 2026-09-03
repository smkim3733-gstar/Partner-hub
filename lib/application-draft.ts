import {
  applicationCompanyMaxLength,
  applicationFields,
  applicationFieldKeys,
  applicationServices,
  type ApplicationDetails,
} from './application-details';
import {
  partnerTypeSelectionProblem,
  type PartnerType,
} from './partner-registration';

export type ApplicationDraft = {
  companyName: string;
  applicantType: string;
  applicantName: string;
  partnerMemberId: string;
  selectedServices: string[];
  details: ApplicationDetails;
  step: number;
  hasLocalAttachments: boolean;
};
export type DraftEnvelope = {
  revision: number;
  draftId: string | null;
  draft: ApplicationDraft | null;
  submittedCaseId: string | null;
  updatedAt: string | null;
};
export const draftCaseId = (id: string) => `case-draft-${id}`;
export const applicationApplicantNameMaxLength = 80;
export const emptyApplicationServices = (): string[] => [];

export type ApplicationCoreFieldsInput = {
  applicantType: string;
  applicantName: string;
  companyName: string;
  selectedServices: readonly string[];
};

export type PreparedApplicationCoreFields = {
  applicantType: PartnerType;
  applicantName: string;
  companyName: string;
  selectedServices: string[];
};

export type ApplicationCoreFieldsResult =
  | { ok: true; value: PreparedApplicationCoreFields }
  | { ok: false; step: 1 | 2 | 3; error: string };

export function prepareApplicationCoreFields(
  input: ApplicationCoreFieldsInput,
  throughStep = 3,
): ApplicationCoreFieldsResult {
  const applicantTypeProblem = partnerTypeSelectionProblem(input.applicantType);
  if (applicantTypeProblem)
    return { ok: false, step: 1, error: applicantTypeProblem };

  const applicantName = input.applicantName.trim();
  if (
    !applicantName ||
    applicantName.length > applicationApplicantNameMaxLength
  )
    return {
      ok: false,
      step: 1,
      error: `신청자 이름은 1~${applicationApplicantNameMaxLength}자로 입력해 주세요.`,
    };

  const companyName = input.companyName.trim();
  if (
    throughStep >= 2 &&
    (!companyName || companyName.length > applicationCompanyMaxLength)
  )
    return {
      ok: false,
      step: 2,
      error: `기업명은 1~${applicationCompanyMaxLength}자로 입력해 주세요.`,
    };

  const selectedServices = [...new Set(input.selectedServices)];
  if (
    throughStep >= 3 &&
    (!selectedServices.length ||
      selectedServices.some(
        (service) => !applicationServices.includes(service),
      ))
  )
    return {
      ok: false,
      step: 3,
      error: '요청서비스를 목록에서 한 개 이상 선택해 주세요.',
    };

  return {
    ok: true,
    value: {
      applicantType: input.applicantType as PartnerType,
      applicantName,
      companyName,
      selectedServices,
    },
  };
}

export function applicationApplicantTypeForForm(
  editable: boolean,
  registeredType: PartnerType,
): PartnerType | '' {
  return editable ? '' : registeredType;
}

export function applicationApplicantTypeForRestoredDraft(
  editable: boolean,
  registeredType: PartnerType,
  partnerMemberId: string,
  draftType: string,
): PartnerType | '' {
  if (!editable) return registeredType;
  return partnerMemberId.trim() && !partnerTypeSelectionProblem(draftType)
    ? (draftType as PartnerType)
    : '';
}

export function applicationApplicantTypeIsEditable(
  representativeCanEdit: boolean,
  partnerMemberId: string,
) {
  return representativeCanEdit && !partnerMemberId.trim();
}

export function applicationApplicantAccountProblem(
  partnerMemberId: string,
  applicantType: string,
  linkedMember?: {
    id: string;
    status: string;
    applicantType: PartnerType;
  },
) {
  if (!partnerMemberId.trim()) return '';
  if (!linkedMember || linkedMember.id !== partnerMemberId || linkedMember.status !== '활성')
    return '자료 공유 계정을 다시 선택해 주세요.';
  return linkedMember.applicantType === applicantType
    ? ''
    : '신청자 유형이 공유 계정의 등록 유형과 일치하지 않습니다. 계정을 다시 선택해 주세요.';
}

export function parseApplicationDraft(value: unknown): ApplicationDraft {
  const fail = () => {
    throw new Error('임시저장 입력 형식과 길이를 확인해 주세요.');
  };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail();
  const v = value as Record<string, unknown>;
  const limits = {
    companyName: applicationCompanyMaxLength,
    applicantType: 30,
    applicantName: applicationApplicantNameMaxLength,
    partnerMemberId: 120,
  };
  for (const [key, max] of Object.entries(limits))
    if (typeof v[key] !== 'string' || v[key].length > max) return fail();
  if (
    v.applicantType !== '' &&
    partnerTypeSelectionProblem(v.applicantType)
  )
    return fail();
  if (
    !Number.isInteger(v.step) ||
    Number(v.step) < 1 ||
    Number(v.step) > 4 ||
    typeof v.hasLocalAttachments !== 'boolean'
  )
    return fail();
  if (
    !Array.isArray(v.selectedServices) ||
    v.selectedServices.length > applicationServices.length ||
    v.selectedServices.some(
      (item) => typeof item !== 'string' || !applicationServices.includes(item),
    )
  )
    return fail();
  if (!v.details || typeof v.details !== 'object' || Array.isArray(v.details))
    return fail();
  const d = v.details as Record<string, unknown>;
  if (
    d.version !== 1 ||
    Object.keys(d).some(
      (key) =>
        key !== 'version' &&
        !applicationFieldKeys.includes(
          key as keyof ApplicationDetails &
            (typeof applicationFieldKeys)[number],
        ),
    )
  )
    return fail();
  // Partial numbers, dates and required fields are intentionally allowed in drafts.
  for (const key of applicationFieldKeys)
    if (
      typeof d[key] !== 'string' ||
      d[key].length > applicationFields[key].max
    )
      return fail();
  return {
    companyName: v.companyName as string,
    applicantType: v.applicantType as string,
    applicantName: v.applicantName as string,
    partnerMemberId: v.partnerMemberId as string,
    selectedServices: [...v.selectedServices] as string[],
    details: structuredClone(d) as ApplicationDetails,
    step: v.step as number,
    hasLocalAttachments: v.hasLocalAttachments as boolean,
  };
}
