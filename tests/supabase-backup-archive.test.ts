import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import {
  sealBackup,
  openBackup,
  hashBackupBytes,
} from '../scripts/supabase-backup-archive.mjs';

const key = randomBytes(32);
const sensitive = 'TEST-ONLY-PRIVATE-BACKUP-DATA';
const payload = {
  text: `${sensitive} 한기평 😀`,
  pgBigint: '9223372036854775807',
  pgJson: '{ "raw":1e2, "duplicate":1, "duplicate":2 }',
  pgTimestamp: '2026-09-11 12:34:56.123456+00',
  nullValue: null,
  rows: [true, false, 0, 3.5, { binary: Buffer.from([0, 255, 128]).toString('base64') }],
};

function reject(action: () => unknown) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'BACKUP_ARCHIVE_INVALID');
    assert.equal(error.cause, undefined);
    assert.equal(error.message.includes(sensitive), false);
    return true;
  });
}

// Synthetic authenticated adversarial envelopes exercise parser validation,
// independently of sealBackup, without storing files or accessing credentials.
function syntheticEnvelope(plaintext: Buffer) {
  const header = Buffer.from('PHUB-BACKUP\0\x01', 'ascii');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  cipher.setAAD(header);
  return Buffer.concat([header, nonce, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

void test('backup preserves PostgreSQL text, Unicode, binary base64 and JSON values', () => {
  const sealed = sealBackup(payload, key);
  assert.deepEqual(openBackup(sealed, key), payload);
  assert.equal(sealed.includes(Buffer.from(sensitive)), false);
  for (const value of [null, true, false, 7, 'hello', [], {}])
    assert.deepEqual(openBackup(sealBackup(value, key), key), value);
  const shared = { id: 'same-value' };
  assert.deepEqual(openBackup(sealBackup([shared, shared], key), key), [shared, shared]);
});

void test('random nonces produce distinct archives and key or source buffers stay unchanged', () => {
  const keyBefore = Buffer.from(key);
  const first = sealBackup(payload, key);
  const second = sealBackup(payload, key);
  assert.notDeepEqual(first, second);
  const before = Buffer.from(first);
  assert.deepEqual(openBackup(first, key), payload);
  assert.deepEqual(first, before);
  assert.deepEqual(key, keyBefore);
});

void test('wrong keys and mutations of header, version, nonce, data, and tag fail closed', () => {
  const archive = sealBackup(payload, key);
  reject(() => openBackup(archive, randomBytes(32)));
  const headerLength = Buffer.from('PHUB-BACKUP\0\x01', 'ascii').length;
  for (const offset of [0, headerLength - 1, headerLength, headerLength + 12, archive.length - 1]) {
    const modified = Buffer.from(archive);
    modified[offset] ^= 1;
    reject(() => openBackup(modified, key));
  }
});

void test('truncation, appended bytes, invalid keys and non-buffer archives are rejected', () => {
  const archive = sealBackup(payload, key);
  for (const length of [0, 1, 12, 40, archive.length - 1])
    reject(() => openBackup(archive.subarray(0, length), key));
  reject(() => openBackup(Buffer.concat([archive, Buffer.from([0])]), key));
  for (const invalidKey of [Buffer.alloc(0), Buffer.alloc(31), Buffer.alloc(33), new Uint8Array(32), 'secret', null]) {
    reject(() => sealBackup(payload, invalidKey));
    reject(() => openBackup(archive, invalidKey));
  }
  for (const invalid of [new Uint8Array(archive), 'not-an-archive', null])
    reject(() => openBackup(invalid, key));
});

void test('authenticated malformed JSON, UTF-8, versions and envelopes fail closed', () => {
  for (const source of [
    '{broken', 'null', '[]', '{}',
    '{"version":2,"payload":{}}',
    '{"version":1}',
    '{"version":1,"payload":{},"extra":true}',
    '{"version":1,"payload":1e400}',
  ]) reject(() => openBackup(syntheticEnvelope(Buffer.from(source)), key));
  reject(() => openBackup(syntheticEnvelope(Buffer.from([0xff, 0xfe])), key));
});

void test('inputs that JSON would silently discard or change are rejected without getters', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  let getterCalls = 0;
  const getter = Object.defineProperty({}, 'private', {
    enumerable: true,
    get() { getterCalls += 1; return sensitive; },
  });
  const sparse: unknown[] = [];
  sparse.length = 1;
  const extraProperty = Object.assign([1], { hidden: 'value' });
  for (const invalid of [undefined, BigInt(7), Infinity, NaN, -0, () => sensitive,
    Symbol('private'), new Date(), Buffer.from('bytes'), { missing: undefined },
    { [Symbol('hidden')]: sensitive }, sparse, extraProperty, cyclic, getter])
    reject(() => sealBackup(invalid, key));
  assert.equal(getterCalls, 0);
});

void test('ciphertext larger than 512 MiB is rejected before reading or decrypting', () => {
  // allocUnsafe reserves virtual address space; the limit rejects before touching
  // content. No giant plaintext or encryption allocation is necessary for QA.
  const oversized = Buffer.allocUnsafe(512 * 1024 * 1024 + 1);
  reject(() => openBackup(oversized, key));
});

void test('SHA256 identifies exact bytes and supports Uint8Array views', () => {
  const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  assert.equal(hashBackupBytes(Buffer.from('abc')), expected);
  assert.equal(hashBackupBytes(new Uint8Array(Buffer.from('abc'))), expected);
  assert.notEqual(hashBackupBytes(Buffer.from('abd')), expected);
  reject(() => hashBackupBytes('abc'));
});
