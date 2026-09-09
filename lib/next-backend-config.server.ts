import 'server-only';
import { readNextBackendConfig } from './next-backend-config';
import { readVercelStorageConfig } from './vercel-storage-config';
import { vercelStorageSelected } from './vercel-storage-policy.mjs';

export function standaloneRequestConfig() {
  return vercelStorageSelected(process.env)
    ? readVercelStorageConfig(process.env)
    : readNextBackendConfig(process.env);
}

// Runtime-only reads. Never place these fields in next.config.env/NEXT_PUBLIC_*.
export function nextBackendConfig() {
  return readNextBackendConfig(process.env);
}
