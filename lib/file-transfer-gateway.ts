import { fileTransferPath, fileTransferMethod } from './file-transfer-contract';
import {
  assertTransferConfig,
  assertTransferTime,
  openTransferTicket,
  type FileTransferConfig,
  type TransferClaims,
} from './file-transfer-ticket';
import {
  privateJsonResponse,
  privateResponseHeaders,
} from './private-response';

export type TransferDispatch = (
  request: Request,
  claims: TransferClaims,
) => Promise<Response>;
export async function handleFileTransfer(
  request: Request,
  config: FileTransferConfig | null,
  dispatch: TransferDispatch,
) {
  const deny = (status: number) =>
    privateJsonResponse(
      { error: '파일 전송 권한 또는 저장 상태를 확인해 주세요.' },
      { status },
    );
  try {
    if (!config) return deny(503);
    assertTransferConfig(config);
  } catch {
    return deny(503);
  }
  const url = new URL(request.url);
  if (
    url.origin !== config.transferOrigin ||
    url.pathname !== fileTransferPath ||
    url.search
  )
    return deny(404);
  if (
    request.headers.get('origin') !== config.appOrigin ||
    request.headers.has('cookie')
  )
    return deny(403);
  const cors = (response: Response) => {
    const headers = privateResponseHeaders(response.headers);
    headers.delete('set-cookie');
    headers.set('access-control-allow-origin', config.appOrigin);
    headers.set(
      'access-control-expose-headers',
      'content-disposition, content-type',
    );
    headers.set('vary', 'Origin');
    return new Response(response.body, { status: response.status, headers });
  };
  const uncertain = () =>
    cors(
      privateJsonResponse(
        {
          error:
            '전송 결과를 확인하지 못했습니다. 같은 파일·자료정보로 저장 상태를 다시 확인해 주세요.',
          code: 'FILE_TRANSFER_OUTCOME_UNKNOWN',
        },
        { status: 503 },
      ),
    );
  if (request.method === 'OPTIONS') {
    const method = request.headers.get('access-control-request-method');
    const names = (request.headers.get('access-control-request-headers') ?? '')
      .toLowerCase()
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    if (
      !['GET', 'POST'].includes(method ?? '') ||
      names.some((name) => !['authorization', 'content-type'].includes(name))
    )
      return cors(deny(403));
    return cors(
      new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-methods': 'GET, POST',
          'access-control-allow-headers': 'authorization, content-type',
          'access-control-max-age': '120',
        },
      }),
    );
  }
  if (
    !['GET', 'POST'].includes(request.method) ||
    request.headers.has('content-encoding')
  )
    return cors(deny(405));
  let claims: TransferClaims;
  try {
    const auth = request.headers.get('authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return cors(deny(401));
    claims = await openTransferTicket(config, auth.slice(7));
    if (request.method !== fileTransferMethod(claims.intent))
      return cors(deny(403));
  } catch {
    return cors(deny(401));
  }
  try {
    const response = await dispatch(request, claims);
    try {
      assertTransferTime(claims);
    } catch {
      await response.body?.cancel().catch(() => {});
      return fileTransferMethod(claims.intent) === 'POST'
        ? uncertain()
        : cors(deny(401));
    }
    return cors(response);
  } catch {
    // An upload may already have committed. No automatic retry or byte cleanup.
    return uncertain();
  }
}
