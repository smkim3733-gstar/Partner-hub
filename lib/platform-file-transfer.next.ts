import 'server-only';
import { loadNextLocalBindings } from '@/lib/next-local-bindings';
import { nextLocalStorageEnabled } from './next-local-storage-policy.mjs';
import type { FileTransferConfig } from './file-transfer-ticket';
export async function fileTransferConfig(): Promise<FileTransferConfig | null> {
  if (!nextLocalStorageEnabled(process.env)) return null;
  return (await loadNextLocalBindings())?.FILE_TRANSFER ?? null;
}
