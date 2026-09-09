import { privateJsonResponse } from './private-response';
// No native Blob SDK, database calls or alternate file endpoint in Sites.
export async function handleBlobTransfer(_request: Request) {
  return privateJsonResponse(
    { error: '이 배포에서는 지원하지 않습니다.' },
    { status: 404 },
  );
}
