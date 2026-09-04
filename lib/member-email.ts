export const LOGIN_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PORTAL_OWNER_EMAIL = 'smkim3733@gmail.com';
export const LOCAL_PORTAL_OWNER_EMAIL = 'seedy@sites.test';

const reservedPortalOwnerEmails = new Set([
  PORTAL_OWNER_EMAIL,
  LOCAL_PORTAL_OWNER_EMAIL,
]);

export function normalizeLoginEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isValidLoginEmail(value: unknown) {
  return typeof value === 'string' && LOGIN_EMAIL_PATTERN.test(value.trim());
}

export function isReservedPortalOwnerEmail(value: unknown) {
  return reservedPortalOwnerEmails.has(normalizeLoginEmail(value));
}

export function hasDuplicateLoginEmail(
  members: Array<{ id: string; email: unknown }>,
  email: unknown,
  excludedMemberId?: string,
) {
  const normalized = normalizeLoginEmail(email);
  if (!normalized) return false;
  return members.some(
    (member) =>
      member.id !== excludedMemberId &&
      normalizeLoginEmail(member.email) === normalized,
  );
}
