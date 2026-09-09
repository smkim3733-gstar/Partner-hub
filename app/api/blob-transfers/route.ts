import { handleBlobTransfer } from '@/lib/platform-blob-transfer';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function POST(request: Request) {
  return handleBlobTransfer(request);
}
