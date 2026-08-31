import {
  applicationFields,
  applicationFieldKeys,
  applicationServices,
  type ApplicationDetails,
} from './application-details';

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

export function parseApplicationDraft(value: unknown): ApplicationDraft {
  const fail = () => {
    throw new Error('임시저장 입력 형식과 길이를 확인해 주세요.');
  };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail();
  const v = value as Record<string, unknown>;
  const limits = {
    companyName: 100,
    applicantType: 30,
    applicantName: 80,
    partnerMemberId: 120,
  };
  for (const [key, max] of Object.entries(limits))
    if (typeof v[key] !== 'string' || v[key].length > max) return fail();
  if (
    !['한기평 컨설턴트', '타사 컨설턴트', '보험설계사', '기타'].includes(
      v.applicantType as string,
    )
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
