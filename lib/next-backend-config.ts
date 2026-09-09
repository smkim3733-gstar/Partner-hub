// Pure validation for the server-only runtime and offline preflight tests.
// Do not import this configuration from Client Components.
import { nextRemoteBackendSelected } from './next-backend-policy.mjs';
import type { FileTransferConfig } from './file-transfer-ticket';

export class NextBackendConfigError extends Error {
  constructor() {
    super('NEXT_BACKEND_NOT_CONFIGURED');
  }
}
export type NextBackendConfig = {
  appOrigin: string;
  d1: { origin: string; secret: string };
  r2: { origin: string; secret: string };
  transfer: FileTransferConfig;
};
function invalid(): never {
  throw new NextBackendConfigError();
}
function origin(value: string | undefined) {
  if (!value) invalid();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid();
  }
  if (
    url.protocol !== 'https:' ||
    url.origin !== value ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    invalid();
  return value;
}
function secret(value: string | undefined) {
  if (!value || !/^[a-f0-9]{64}$/.test(value)) invalid();
  return value;
}
export function readNextBackendConfig(
  environment: Record<string, string | undefined>,
): NextBackendConfig {
  try {
    if (!nextRemoteBackendSelected(environment)) invalid();
  } catch {
    return invalid();
  }
  if (
    environment.PARTNER_HUB_BACKEND_ENABLED !== '1' ||
    environment.PARTNER_HUB_LOCAL_STORAGE === '1'
  )
    invalid();
  const appOrigin = origin(environment.PARTNER_HUB_APP_ORIGIN);
  const d1 = {
    origin: origin(environment.PARTNER_HUB_D1_ORIGIN),
    secret: secret(environment.PARTNER_HUB_D1_SECRET),
  };
  const r2 = {
    origin: origin(environment.PARTNER_HUB_R2_ORIGIN),
    secret: secret(environment.PARTNER_HUB_R2_SECRET),
  };
  const transfer = {
    appOrigin,
    transferOrigin: origin(environment.PARTNER_HUB_FILE_ORIGIN),
    secret: secret(environment.PARTNER_HUB_FILE_SECRET),
  };
  // Never expose a privileged DB/object bridge at the app or browser file host,
  // and never reuse a bearer secret between these independent trust domains.
  if (
    new Set([appOrigin, d1.origin, r2.origin, transfer.transferOrigin]).size !==
      4 ||
    new Set([d1.secret, r2.secret, transfer.secret]).size !== 3
  )
    invalid();
  return { appOrigin, d1, r2, transfer };
}
export function nextBackendRequestAllowed(
  request: Request,
  config: Pick<NextBackendConfig, 'appOrigin'>,
) {
  if (new URL(request.url).origin !== config.appOrigin) return false;
  const originHeader = request.headers.get('origin');
  if (originHeader !== null && originHeader !== config.appOrigin) return false;
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
    originHeader !== config.appOrigin
  )
    return false;
  return (
    request.headers.get('sec-fetch-site')?.trim().toLowerCase() !== 'cross-site'
  );
}

export function nextBackendRequiresDirectTransfer(request: Request) {
  const path = new URL(request.url).pathname;
  return (
    (['GET', 'HEAD'].includes(request.method) &&
      (/^\/api\/files\/[^/]+\/?$/.test(path) ||
        /^\/api\/consulting-flow\/[^/]+\/files\/[^/]+\/?$/.test(path))) ||
    (request.method === 'POST' &&
      /^multipart\/form-data(?:;|$)/i.test(
        request.headers.get('content-type') ?? '',
      ))
  );
}
