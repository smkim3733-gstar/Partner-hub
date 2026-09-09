import { handleFileTransfer } from '../../lib/file-transfer-gateway';
import { dispatchFileTransfer } from '../../lib/file-transfer-dispatch';

type FileWorkerEnv = {
  FILE_TRANSFER_ENABLED?: string;
  FILE_TRANSFER_SECRET?: string;
  FILE_TRANSFER_APP_ORIGIN?: string;
  FILE_TRANSFER_ORIGIN?: string;
};

// Native D1/R2 bindings are consumed by existing business handlers. No generic
// SQL/storage access, public bucket route, or deployment resource IDs live here.
const worker = {
  fetch(request: Request, env: FileWorkerEnv) {
    const config =
      env.FILE_TRANSFER_ENABLED === '1'
        ? {
            appOrigin: env.FILE_TRANSFER_APP_ORIGIN ?? '',
            transferOrigin: env.FILE_TRANSFER_ORIGIN ?? '',
            secret: env.FILE_TRANSFER_SECRET ?? '',
          }
        : null;
    return handleFileTransfer(request, config, dispatchFileTransfer);
  },
};
export default worker;
