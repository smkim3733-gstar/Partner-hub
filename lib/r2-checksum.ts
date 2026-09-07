export function r2Sha256Bytes(value: string) {
  if (!/^[0-9a-f]{64}$/.test(value)) return null;
  return Uint8Array.from(value.match(/.{2}/g)!, (byte) =>
    Number.parseInt(byte, 16),
  );
}

export function r2ObjectSha256Hex(object: R2Object) {
  const checksum = object.checksums?.sha256;
  if (!checksum) return null;
  return Array.from(new Uint8Array(checksum), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
