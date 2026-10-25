import {
  passwordDatabase,
  sessionToken,
  assertPasswordOrigin,
} from '../../lib/password-store';
import {
  readStandaloneAdminIdentity,
  standaloneAdminIdentityStatement,
  type StandaloneAdminSessionLookup,
} from '../../lib/standalone-admin-store';

// Only the transfer Worker selects this verifier; it has no admin login route.
// Gateway validates its configuration and decrypts a scoped ticket first.
export function standaloneAdminSessionLookup(
  request: Request,
): StandaloneAdminSessionLookup | null {
  const token = sessionToken(request);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return {
    token,
    statement: (db) => standaloneAdminIdentityStatement(db, token),
    accept(identity) {
      if (identity && !['GET', 'HEAD', 'OPTIONS'].includes(request.method))
        assertPasswordOrigin(request);
      return identity;
    },
  };
}
export async function standaloneAdminIdentity(request: Request) {
  const lookup = standaloneAdminSessionLookup(request);
  if (!lookup) return null;
  return lookup.accept(
    await readStandaloneAdminIdentity(await passwordDatabase(), lookup.token),
  );
}