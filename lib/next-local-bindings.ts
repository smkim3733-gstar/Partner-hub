import type { FileTransferConfig } from './file-transfer-ticket';
export type NextLocalBindings = {
  DB: D1Database;
  AI_SOURCE_FILES: R2Bucket;
  FILE_TRANSFER?: FileTransferConfig;
};

// Production/default build. The real local driver is selected only in next dev.
export async function loadNextLocalBindings(): Promise<
  NextLocalBindings | undefined
> {
  return undefined;
}
