import 'server-only';
import { createR2HttpBucket } from './r2-http-client';

// No browser imports or insecure transport overrides. Production remains off
// until the actual storage account, migration and rollback are verified.
export function createNextR2HttpBucket(origin: string, secret: string) {
  return createR2HttpBucket({ origin, secret });
}
