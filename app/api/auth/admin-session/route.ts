import {
  PortalAccessError,
  requireAdminSessionExpiresInSeconds,
} from '@/lib/portal-auth';
import { privateJsonResponse } from '@/lib/private-response';

export const dynamic = 'force-dynamic';

// Read-only: how long the administrator login behind this request has left.
// Used by the administrator screen after the admin logs in again in another
// tab, without reloading (and losing) the work open on screen.
export async function GET(request: Request) {
  try {
    return privateJsonResponse({
      sessionExpiresInSeconds:
        await requireAdminSessionExpiresInSeconds(request),
    });
  } catch (error) {
    if (error instanceof PortalAccessError)
      return privateJsonResponse(
        { error: error.message },
        { status: error.status },
      );
    console.error(
      'Failed to read administrator session',
      error instanceof Error ? error.name : 'unknown',
    );
    return privateJsonResponse(
      { error: '로그인 상태를 확인하지 못했습니다.' },
      { status: 500 },
    );
  }
}
