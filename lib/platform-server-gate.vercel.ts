import 'server-only';
import { vercelStorageConfig } from './vercel-storage-config.server';
import { nextBackendRequestAllowed } from './next-backend-config';
import { privateJsonResponse } from './private-response';
export function serverRequestGate(request: Request): Response | null {
  let config;
  try {
    config = vercelStorageConfig();
  } catch {
    return privateJsonResponse(
      {
        code: 'MIGRATION_BACKEND_NOT_CONFIGURED',
        error: 'Vercel 저장소 연결과 초기 설정이 필요합니다.',
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
  )
    return privateJsonResponse(
      {
        code: 'FILE_TRANSFER_REQUIRED',
        error: '화면의 파일 전송 기능을 이용해 주세요.',
      },
      { status: 400 },
    );
  return null;
}
