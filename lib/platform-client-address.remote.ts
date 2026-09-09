import 'server-only';
import { vercelRateLimitClientKey } from './vercel-client-address';

export function platformRateLimitClientKey(request: Request): string | null {
  return vercelRateLimitClientKey(request, process.env);
}
