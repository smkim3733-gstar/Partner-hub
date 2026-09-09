import 'server-only';
import { nextBackendConfig } from './next-backend-config.server';
import {
  nextBackendRequestAllowed,
  nextBackendRequiresDirectTransfer,
} from './next-backend-config';
import { privateJsonResponse } from './private-response';

export function serverRequestGate(request: Request): Response | null {
  let config;
  try {
    config = nextBackendConfig();
  } catch {
    return privateJsonResponse(
      {
        code: 'MIGRATION_BACKEND_NOT_CONFIGURED',
        error:
          '운영 연결 설정을 확인해야 합니다. 기존 운영 사이트를 이용해 주세요.',
      },
      { status: 503 },
    );
  }
  if (!nextBackendRequestAllowed(request, config))
    return privateJsonResponse(
      { error: '설정된 보안 사이트에서 다시 요청해 주세요.' },
      { status: 403 },
    );
  if (nextBackendRequiresDirectTransfer(request)) {
    // File bytes never use Vercel Functions' capped browser request/response.
    // The byte-owning Worker invokes the same business handlers directly.
    return privateJsonResponse(
      {
        code: 'FILE_TRANSFER_REQUIRED',
        error: '화면의 파일 전송 기능으로 다시 요청해 주세요.',
      },
      { status: 400 },
    );
  }
  return null;
}
