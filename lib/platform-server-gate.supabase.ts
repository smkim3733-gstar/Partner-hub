import 'server-only';
import {
  nextBackendRequestAllowed,
  nextBackendRequiresDirectTransfer,
} from './next-backend-config';
import { supabaseBackendConfig } from './supabase-backend-config.server';
import { privateJsonResponse } from './private-response';

export function serverRequestGate(request: Request): Response | null {
  let config;
  try {
    config = supabaseBackendConfig();
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
    // The direct byte owner should invoke the same business handlers through transfer routes.
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
