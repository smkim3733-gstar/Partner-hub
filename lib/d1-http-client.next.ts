import 'server-only';
import { createD1HttpDatabase } from './d1-http-client';

// Next entry point forbids Client Components and insecure transport overrides.
// Used by the explicitly selected remote candidate; default Next stays closed.
export function createNextD1HttpDatabase(origin: string, secret: string) {
  return createD1HttpDatabase({ origin, secret });
}
