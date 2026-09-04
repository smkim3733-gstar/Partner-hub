import { isValidLoginEmail, normalizeLoginEmail } from '@/lib/member-email';

const SHARED_RATE_LIMIT_KEY = 'shared-no-edge-ip';

export function chatGPTIdentityFromRequest(request: Request) {
  const id = request.headers.get('oai-authenticated-user-id')?.trim() ?? '';
  const email = normalizeLoginEmail(
    request.headers.get('oai-authenticated-user-email') ?? '',
  );
  if (
    !id ||
    id.length > 256 ||
    !/^[\x21-\x7e]+$/.test(id) ||
    !email ||
    email.length > 254 ||
    !isValidLoginEmail(email)
  )
    return null;
  return { id, email };
}

export function chatGPTDisplayNameFromRequest(
  request: Request,
  fallback: string,
) {
  const encoded = request.headers.get('oai-authenticated-user-full-name');
  const encoding = request.headers.get(
    'oai-authenticated-user-full-name-encoding',
  );
  if (
    !encoded ||
    encoded.length > 1_000 ||
    encoding !== 'percent-encoded-utf-8'
  )
    return fallback;
  try {
    const name = decodeURIComponent(encoded).trim();
    return name &&
      Array.from(name).length <= 80 &&
      !/\p{Cc}/u.test(name)
      ? name
      : fallback;
  } catch {
    return fallback;
  }
}

export function rateLimitClientKey(request: Request) {
  const value = request.headers.get('cf-connecting-ip')?.trim();
  return value && value.length <= 64 && /^[0-9A-Fa-f:.]+$/.test(value)
    ? value.toLowerCase()
    : SHARED_RATE_LIMIT_KEY;
}

export function readSessionCookieToken(request: Request, name: string) {
  const header = request.headers.get('cookie');
  if (header === null) return null;
  if (header.length > 8_192) return '';
  const prefix = `${name}=`;
  const matches = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(prefix));
  if (matches.length === 0) return null;
  if (matches.length !== 1) return '';
  const token = matches[0].slice(prefix.length);
  return /^[a-f0-9]{64}$/.test(token) ? token : '';
}
