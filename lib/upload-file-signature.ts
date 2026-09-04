import { unzipSync } from 'fflate';

const SIGNATURE_MISMATCH =
  '파일 확장자와 실제 파일 형식이 일치하지 않습니다. 원본 프로그램에서 다시 저장한 파일을 선택해 주세요.';
const MAX_HEADER_BYTES = 4096;
const MAX_ZIP_ENTRIES = 10_000;

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((byte, index) => bytes[index] === byte);
}

function includesAscii(bytes: Uint8Array, text: string) {
  const signature = new TextEncoder().encode(text);
  outer: for (
    let index = 0;
    index <= bytes.length - signature.length;
    index++
  ) {
    for (let offset = 0; offset < signature.length; offset++)
      if (bytes[index + offset] !== signature[offset]) continue outer;
    return true;
  }
  return false;
}

function isMpegAudio(bytes: Uint8Array) {
  if (startsWith(bytes, [0x49, 0x44, 0x33])) return true;
  for (let index = 0; index < bytes.length - 3; index++) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    if (
      first === 0xff &&
      (second & 0xe0) === 0xe0 &&
      (second & 0x18) !== 0x08 &&
      (second & 0x06) !== 0 &&
      (third & 0xf0) !== 0 &&
      (third & 0xf0) !== 0xf0
    )
      return true;
  }
  return false;
}

function hasIsoBaseMediaTypeBox(bytes: Uint8Array) {
  for (let typeOffset = 4; typeOffset <= bytes.length - 4; typeOffset++) {
    if (
      bytes[typeOffset] !== 0x66 ||
      bytes[typeOffset + 1] !== 0x74 ||
      bytes[typeOffset + 2] !== 0x79 ||
      bytes[typeOffset + 3] !== 0x70
    )
      continue;
    const sizeOffset = typeOffset - 4;
    const boxSize =
      bytes[sizeOffset] * 0x1000000 +
      bytes[sizeOffset + 1] * 0x10000 +
      bytes[sizeOffset + 2] * 0x100 +
      bytes[sizeOffset + 3];
    if (boxSize >= 8 && sizeOffset + boxSize <= bytes.length) return true;
  }
  return false;
}

function isOoxml(bytes: Uint8Array, directory: 'word/' | 'xl/' | 'ppt/') {
  let entries = 0;
  let hasContentTypes = false;
  let hasDocumentDirectory = false;
  try {
    unzipSync(bytes, {
      filter(file) {
        entries++;
        if (entries > MAX_ZIP_ENTRIES) throw new Error('too many entries');
        const name = file.name.replaceAll('\\', '/');
        if (name === '[Content_Types].xml') hasContentTypes = true;
        if (name.startsWith(directory)) hasDocumentDirectory = true;
        return false;
      },
    });
  } catch {
    return false;
  }
  return hasContentTypes && hasDocumentDirectory;
}

export async function uploadFileContentProblem(
  file: Pick<File, 'name' | 'slice' | 'arrayBuffer'>,
  availableBytes?: ArrayBuffer,
) {
  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
  if (extension === 'txt' || extension === 'md') return '';
  try {
    if (['docx', 'xlsx', 'pptx'].includes(extension)) {
      const bytes = new Uint8Array(
        availableBytes ?? (await file.arrayBuffer()),
      );
      const directory = {
        docx: 'word/',
        xlsx: 'xl/',
        pptx: 'ppt/',
      }[extension] as 'word/' | 'xl/' | 'ppt/';
      return isOoxml(bytes, directory) ? '' : SIGNATURE_MISMATCH;
    }

    const bytes = new Uint8Array(
      availableBytes ?? (await file.slice(0, MAX_HEADER_BYTES).arrayBuffer()),
    ).subarray(0, MAX_HEADER_BYTES);
    const valid =
      extension === 'pdf'
        ? includesAscii(bytes.subarray(0, 1024), '%PDF-')
        : extension === 'png'
          ? startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
          : extension === 'jpg' || extension === 'jpeg'
            ? startsWith(bytes, [0xff, 0xd8, 0xff])
            : extension === 'xls'
              ? startsWith(
                  bytes,
                  [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
                )
              : extension === 'wav'
                ? startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
                  bytes[8] === 0x57 &&
                  bytes[9] === 0x41 &&
                  bytes[10] === 0x56 &&
                  bytes[11] === 0x45
                : extension === 'm4a'
                  ? hasIsoBaseMediaTypeBox(bytes)
                  : extension === 'mp3'
                    ? isMpegAudio(bytes)
                    : true;
    return valid ? '' : SIGNATURE_MISMATCH;
  } catch {
    return SIGNATURE_MISMATCH;
  }
}
