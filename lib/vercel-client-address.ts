import { isIP } from 'node:net';
import { readVercelStorageConfig } from './vercel-storage-config';
import { vercelStorageSelected } from './vercel-storage-policy.mjs';
import {
  readNextBackendConfig,
  nextBackendRequestAllowed,
} from './next-backend-config';

function normalizedAddress(header: string | null): string | null {
  if (!header || header.length > 64) return null;
  const value = header.trim();
  // One address only: no lists, ports, brackets, zone IDs or alternative headers.
  if (!/^[0-9a-fA-F:.]+$/.test(value)) return null;
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return null;
  const canonical = new URL(`http://[${value}]`).hostname.slice(1, -1);
  // Treat IPv4 and its mapped IPv6 spelling as the same bucket.
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
  if (!mapped) return canonical;
  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  return [high >>> 8, high & 255, low >>> 8, low & 255].join('.');
}

// Server runtime policy, not identity authentication. Environment is injected so
// offline tests never need service credentials. Only the remote alias imports it.
export function vercelRateLimitClientKey(
  request: Request,
  environment: Record<string, string | undefined>,
): string | null {
  if (
    environment.VERCEL !== '1' ||
    !['preview', 'production'].includes(environment.VERCEL_ENV ?? '')
  )
    return null;
  try {
    const config = vercelStorageSelected(environment)
      ? readVercelStorageConfig(environment)
      : readNextBackendConfig(environment);
    if (!nextBackendRequestAllowed(request, config)) return null;
    // Vercel documents this edge header separately from an externally replaced
    // x-forwarded-for. Self-hosted/proxy-only installs must use the shared fallback.
    const address = normalizedAddress(
      request.headers.get('x-vercel-forwarded-for'),
    );
    return address ? `vercel-ip:${address}` : null;
  } catch {
    return null;
  }
}
