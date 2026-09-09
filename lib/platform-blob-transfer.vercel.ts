import 'server-only';
import { env } from './platform-runtime.vercel';
import { vercelStorageConfig } from './vercel-storage-config.server';
import { createBlobTransferHandler } from './vercel-blob-transfer';
import { privateJsonResponse } from './private-response';
export async function handleBlobTransfer(request: Request) {
  try {
    return await createBlobTransferHandler(
      env.DB,
      vercelStorageConfig(),
    )(request);
  } catch {
    return privateJsonResponse(
      { error: 'Vercel 저장소 연결을 확인해 주세요.' },
      { status: 503 },
    );
  }
}
