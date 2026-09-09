import { fileTransferConfig } from '@/lib/platform-file-transfer';
import { issueFileTransfer } from '@/lib/file-transfer-issuer';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return issueFileTransfer(request, await fileTransferConfig());
}
