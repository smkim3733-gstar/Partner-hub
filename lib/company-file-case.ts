import { CompanyFileError } from './company-files';
import { readFlow } from './consulting-flow-store';
import { uniqueMemberIdForName } from './portal-auth';

/** Files may arrive before the new application is saved. A proposed case ID
 * grants no access: the file's company/account ACL is still checked on reads. */
export async function uploadCaseLink(
  rawCaseId: FormDataEntryValue | null,
  state: unknown,
  company: string,
  partnerMemberId: string,
) {
  if (rawCaseId === null) return null;
  if (
    typeof rawCaseId !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,120}$/.test(rawCaseId)
  )
    throw new CompanyFileError('진행번호 형식이 올바르지 않습니다.', 400);
  const item = (
    state as {
      cases?: Array<{
        id: string;
        company: string;
        trainee: string;
        partnerMemberId?: string;
      }>;
    } | null
  )?.cases?.find((item) => item.id === rawCaseId);
  const stored = await readFlow(rawCaseId);
  if (item || stored) {
    const owner =
      stored?.partnerId ??
      (item?.partnerMemberId != null
        ? item.partnerMemberId
        : uniqueMemberIdForName(state, item?.trainee ?? ''));
    if (
      (stored?.company ?? item?.company) !== company ||
      owner === null ||
      owner !== partnerMemberId
    )
      throw new CompanyFileError(
        '진행의 기업명과 담당 계정을 다시 확인해 주세요.',
        403,
      );
  }
  return rawCaseId;
}
