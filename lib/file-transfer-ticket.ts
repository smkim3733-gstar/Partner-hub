import { Buffer } from 'node:buffer';
import {
  fileTransferLifetimeSeconds,
  parseFileTransferIntent,
  type FileTransferIntent,
} from './file-transfer-contract';

export type FileTransferConfig = {
  appOrigin: string;
  transferOrigin: string;
  secret: string;
  allowLoopback?: boolean;
};
export type TransferClaims = {
  v: 1;
  iat: number;
  exp: number;
  nonce: string;
  sub: string;
  session: string;
  origin: string;
  aud: string;
  intent: FileTransferIntent;
};
const aad = new TextEncoder().encode('partner-hub-private-file-transfer-v1');
export function assertTransferConfig(config: FileTransferConfig) {
  if (!/^[a-f0-9]{64}$/.test(config.secret))
    throw new Error('File transfer not configured');
  for (const value of [config.appOrigin, config.transferOrigin]) {
    const url = new URL(value);
    if (
      url.origin !== value ||
      url.username ||
      url.password ||
      !(
        url.protocol === 'https:' ||
        (config.allowLoopback === true &&
          url.protocol === 'http:' &&
          ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))
      )
    )
      throw new Error('Invalid transfer origin');
  }
  if (config.appOrigin === config.transferOrigin)
    throw new Error('Transfer origin must be separate');
}
async function key(config: FileTransferConfig) {
  assertTransferConfig(config);
  return crypto.subtle.importKey(
    'raw',
    Uint8Array.from(Buffer.from(config.secret, 'hex')),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  );
}
export function assertTransferTime(
  claims: TransferClaims,
  now = Math.floor(Date.now() / 1000),
) {
  if (
    !Number.isSafeInteger(claims.iat) ||
    !Number.isSafeInteger(claims.exp) ||
    claims.iat > now ||
    claims.exp <= now ||
    claims.exp - claims.iat !== fileTransferLifetimeSeconds
  )
    throw new Error('Transfer expired');
}
export async function sealTransferTicket(
  config: FileTransferConfig,
  input: {
    intent: FileTransferIntent;
    session: string;
    userId: string;
  },
  now = Math.floor(Date.now() / 1000),
) {
  const claims: TransferClaims = {
    v: 1,
    iat: now,
    exp: now + fileTransferLifetimeSeconds,
    nonce: crypto.randomUUID(),
    sub: input.userId,
    session: input.session,
    origin: config.appOrigin,
    aud: config.transferOrigin,
    intent: parseFileTransferIntent(input.intent),
  };
  if (
    !/^[a-f0-9]{64}$/.test(claims.session) ||
    !claims.sub ||
    claims.sub.length > 200
  )
    throw new Error('Invalid transfer identity');
  assertTransferTime(claims, now);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
    await key(config),
    new TextEncoder().encode(JSON.stringify(claims)),
  );
  return {
    token: `v1.${Buffer.from(iv).toString('base64url')}.${Buffer.from(ciphertext).toString('base64url')}`,
    expiresAt: claims.exp,
  };
}
export async function openTransferTicket(
  config: FileTransferConfig,
  token: string,
  now = Math.floor(Date.now() / 1000),
): Promise<TransferClaims> {
  try {
    if (
      token.length > 20_000 ||
      !/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/.test(token)
    )
      throw new Error();
    const [, rawIv, rawCipher] = token.split('.');
    const iv = Uint8Array.from(Buffer.from(rawIv, 'base64url'));
    const ciphertext = Uint8Array.from(Buffer.from(rawCipher, 'base64url'));
    if (Buffer.from(ciphertext).toString('base64url') !== rawCipher)
      throw new Error();
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
      await key(config),
      ciphertext,
    );
    const value = JSON.parse(
      new TextDecoder().decode(decrypted),
    ) as TransferClaims;
    if (
      !value ||
      value.v !== 1 ||
      value.origin !== config.appOrigin ||
      value.aud !== config.transferOrigin ||
      typeof value.sub !== 'string' ||
      !value.sub ||
      value.sub.length > 200 ||
      typeof value.session !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.session) ||
      typeof value.nonce !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(value.nonce)
    )
      throw new Error();
    assertTransferTime(value, now);
    return { ...value, intent: parseFileTransferIntent(value.intent) };
  } catch {
    // Never expose session material, token contents or crypto error details.
    throw new Error('Invalid or expired file transfer');
  }
}
