import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { TextDecoder } from 'node:util';

const HEADER = Buffer.from('PHUB-BACKUP\0\x01', 'ascii');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const OVERHEAD_BYTES = HEADER.length + NONCE_BYTES + TAG_BYTES;
const MAX_PLAINTEXT_BYTES = MAX_ARCHIVE_BYTES - OVERHEAD_BYTES;
const ERROR_MESSAGE = 'BACKUP_ARCHIVE_INVALID';

function invalidArchive() {
  return new Error(ERROR_MESSAGE);
}

function requireKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw invalidArchive();
}

// Reject values that JSON silently changes or omits. Payload fields containing
// PostgreSQL JSON text, bigint text, or binary base64 remain ordinary strings.
function requireJsonValue(value) {
  const ancestors = new WeakSet();
  const stack = [{ value, leave: false }];
  while (stack.length) {
    const entry = stack.pop();
    const current = entry.value;
    if (entry.leave) {
      ancestors.delete(current);
      continue;
    }
    if (current === null || typeof current === 'string' || typeof current === 'boolean')
      continue;
    if (typeof current === 'number') {
      if (!Number.isFinite(current) || Object.is(current, -0)) throw invalidArchive();
      continue;
    }
    if (typeof current !== 'object' || ancestors.has(current)) throw invalidArchive();
    const array = Array.isArray(current);
    const prototype = Object.getPrototypeOf(current);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
      throw invalidArchive();
    ancestors.add(current);
    stack.push({ value: current, leave: true });
    const keys = Reflect.ownKeys(current).filter((key) => !array || key !== 'length');
    if (array && keys.length !== current.length) throw invalidArchive();
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== 'string' || (array && key !== String(index))) throw invalidArchive();
      const property = Object.getOwnPropertyDescriptor(current, key);
      if (!property?.enumerable || !Object.hasOwn(property, 'value')) throw invalidArchive();
      stack.push({ value: property.value, leave: false });
    }
  }
}

/** Encrypt a versioned JSON payload. The caller owns key storage and file I/O. */
export function sealBackup(payload, key) {
  let plaintext;
  try {
    requireKey(key);
    requireJsonValue(payload);
    const serialized = JSON.stringify({ version: 1, payload });
    if (Buffer.byteLength(serialized, 'utf8') > MAX_PLAINTEXT_BYTES) throw invalidArchive();
    plaintext = Buffer.from(serialized, 'utf8');
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(HEADER);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([HEADER, nonce, encrypted, cipher.getAuthTag()]);
  } catch {
    throw invalidArchive();
  } finally {
    plaintext?.fill(0);
  }
}

/** Authenticate before parsing. No paths, SQL, or other payload data execute. */
export function openBackup(ciphertext, key) {
  let first;
  let last;
  let plaintext;
  try {
    requireKey(key);
    if (!Buffer.isBuffer(ciphertext) || ciphertext.length <= OVERHEAD_BYTES ||
      ciphertext.length > MAX_ARCHIVE_BYTES ||
      !ciphertext.subarray(0, HEADER.length).equals(HEADER)) throw invalidArchive();
    const nonceEnd = HEADER.length + NONCE_BYTES;
    const tagStart = ciphertext.length - TAG_BYTES;
    const decipher = createDecipheriv('aes-256-gcm', key,
      ciphertext.subarray(HEADER.length, nonceEnd), { authTagLength: TAG_BYTES });
    decipher.setAAD(HEADER);
    decipher.setAuthTag(ciphertext.subarray(tagStart));
    first = decipher.update(ciphertext.subarray(nonceEnd, tagStart));
    last = decipher.final();
    plaintext = Buffer.concat([first, last]);
    if (plaintext.length > MAX_PLAINTEXT_BYTES) throw invalidArchive();
    const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
    if (envelope === null || Array.isArray(envelope) || typeof envelope !== 'object' ||
      Object.keys(envelope).length !== 2 || envelope.version !== 1 ||
      !Object.hasOwn(envelope, 'payload')) throw invalidArchive();
    requireJsonValue(envelope.payload);
    return envelope.payload;
  } catch {
    throw invalidArchive();
  } finally {
    first?.fill(0);
    last?.fill(0);
    plaintext?.fill(0);
  }
}

export function hashBackupBytes(bytes) {
  try {
    if (!(bytes instanceof Uint8Array)) throw invalidArchive();
    return createHash('sha256').update(bytes).digest('hex');
  } catch {
    throw invalidArchive();
  }
}
