import 'server-only';
import { nextBackendConfig } from './next-backend-config.server';
import type { FileTransferConfig } from './file-transfer-ticket';
export async function fileTransferConfig(): Promise<FileTransferConfig | null> {
  try {
    return nextBackendConfig().transfer;
  } catch {
    return null;
  }
}
