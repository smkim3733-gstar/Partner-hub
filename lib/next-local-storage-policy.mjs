/** @param {Record<string, string | undefined>} environment */
export function nextLocalStorageEnabled(environment) {
  return (
    environment.NODE_ENV === 'development' &&
    environment.PARTNER_HUB_LOCAL_STORAGE === '1' &&
    ['VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_PROJECT_ID'].every(
      (name) => environment[name] === undefined,
    )
  );
}

/** @param {string | undefined} name */
export function nextLocalStorageName(name) {
  const value = name ?? 'development';
  if (!/^[a-z0-9][a-z0-9-]{0,15}$/.test(value))
    throw new Error(
      'Local storage name must be 1-16 lowercase letters, digits or hyphens.',
    );
  return value;
}
