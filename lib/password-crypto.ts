import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from 'node:crypto';

// OWASP's 16 MiB scrypt profile fits the Worker memory budget. No plain-text passwords are stored.
const options = { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 };
export const opaqueToken = () => randomBytes(32).toString('hex');
export const tokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$16384$8$5$${salt}$${scryptSync(password, salt, 32, options).toString('hex')}`;
}
export function verifyPassword(password: string, encoded?: string) {
  const match = encoded?.match(
    /^scrypt\$16384\$8\$5\$([a-f0-9]{32})\$([a-f0-9]{64})$/,
  );
  // Unknown accounts do the same expensive work; responses do not disclose whether the email exists.
  const actual = scryptSync(
    password,
    match?.[1] ?? '00000000000000000000000000000000',
    32,
    options,
  );
  const expected = Buffer.from(match?.[2] ?? '0'.repeat(64), 'hex');
  return timingSafeEqual(actual, expected) && Boolean(match);
}
