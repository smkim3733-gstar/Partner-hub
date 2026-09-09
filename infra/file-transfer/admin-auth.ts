import {
  passwordDatabase,
  sessionToken,
  assertPasswordOrigin,
} from '../../lib/password-store';
import { readStandaloneAdminIdentity } from '../../lib/standalone-admin-store';

// Only the transfer Worker selects this verifier; it has no admin login route.
// Gateway validates its configuration and decrypts a scoped ticket first.
export async function standaloneAdminIdentity(request: Request) {
  const token = sessionToken(request);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const identity = await readStandaloneAdminIdentity(
    await passwordDatabase(),
    token,
  );
  if (identity && !['GET', 'HEAD', 'OPTIONS'].includes(request.method))
    assertPasswordOrigin(request);
  return identity;
}
