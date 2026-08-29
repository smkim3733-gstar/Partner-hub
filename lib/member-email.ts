export const LOGIN_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeLoginEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isValidLoginEmail(value: string) {
  return LOGIN_EMAIL_PATTERN.test(value.trim());
}

export function hasDuplicateLoginEmail(
  members: Array<{ id: string; email: string }>,
  email: string,
  excludedMemberId?: string,
) {
  const normalized = normalizeLoginEmail(email);
  return members.some(
    (member) => member.id !== excludedMemberId && normalizeLoginEmail(member.email) === normalized,
  );
}
