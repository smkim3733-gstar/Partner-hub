export const PORTAL_CONFLICT_RECEIPT_HEADER = 'x-portal-conflict-receipt';
export const PORTAL_CONFLICT_RECEIPT_TTL_SECONDS = 24 * 60 * 60;
export const PORTAL_CONFLICT_RECEIPT_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function portalConflictReceiptFrom(value: unknown) {
  return typeof value === 'string' && PORTAL_CONFLICT_RECEIPT_PATTERN.test(value)
    ? value
    : undefined;
}

export function portalConflictReceiptHeaders(
  receipt?: string,
): Record<string, string> {
  return receipt && PORTAL_CONFLICT_RECEIPT_PATTERN.test(receipt)
    ? { [PORTAL_CONFLICT_RECEIPT_HEADER]: receipt }
    : {};
}
