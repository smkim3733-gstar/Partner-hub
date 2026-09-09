import 'server-only';
import { nextBackendRequestAllowed } from './next-backend-config';
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
  if (
    request.method === 'POST' &&
    /^multipart\/form-data(?:;|$)/i.test(
      request.headers.get('content-type') ?? '',
    )
  ) {
    // Browser uploads use signed staging URLs. Authorized downloads stream
    // through existing handlers and recheck the current session on every read.
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
