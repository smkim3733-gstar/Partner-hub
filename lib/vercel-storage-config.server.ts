import 'server-only';
import { readVercelStorageConfig } from './vercel-storage-config';
export function vercelStorageConfig() {
  return readVercelStorageConfig(process.env);
}
