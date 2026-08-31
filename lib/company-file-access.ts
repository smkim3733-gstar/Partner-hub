import { portalStateId } from '@/db/schema';
import { CompanyFileError } from './company-files';
import { requirePortalUser, type PortalUser } from './portal-auth';
import { readPortalStateSnapshot } from './portal-state';

export async function currentFileAccess(
  request: Request,
  expected: PortalUser,
) {
  const snapshot = await readPortalStateSnapshot();
  const user = await requirePortalUser(request, snapshot.state);
  if (
    user.id !== expected.id ||
    user.memberId !== expected.memberId ||
    user.role !== expected.role
  )
    throw new CompanyFileError(
      '계정이 변경되었습니다. 다시 로그인해 주세요.',
      403,
    );
  return { ...snapshot, user };
}

// IS also compares NULL, preserving the existing administrator bootstrap path.
export function fileStateGuard(payloadParameter: string) {
  return `(SELECT payload FROM portal_state WHERE id = '${portalStateId}') IS ${payloadParameter}`;
}

export function fileStateConflict() {
  return new CompanyFileError(
    '처리 중 계정 또는 운영 정보가 변경되었습니다. 최신 상태에서 다시 시도해 주세요.',
    409,
  );
}
