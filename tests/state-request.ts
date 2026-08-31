// Existing domain tests model a client that just read its baseline. Tests of
// stale or missing revisions call the unwrapped route directly.
import { PUT as rawPut } from '../app/api/state/route';
import { readPortalState } from '../lib/portal-state';
import { portalRevision } from '../lib/portal-revision';
export { GET } from '../app/api/state/route';
export async function PUT(request: Request) {
  const headers = new Headers(request.headers);
  if (!headers.has('if-match'))
    headers.set(
      'if-match',
      `"${await portalRevision(await readPortalState())}"`,
    );
  return rawPut(new Request(request, { headers }));
}
