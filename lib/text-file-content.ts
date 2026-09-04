const TEXT_ENCODING_PROBLEM =
  '텍스트 파일의 문자 인코딩을 읽지 못했습니다. UTF-8 또는 BOM이 있는 UTF-16으로 다시 저장해 주세요.';
const TEXT_CHARACTER_PROBLEM =
  '텍스트 파일에 읽을 수 없는 바이너리 문자가 있습니다. 원본 편집기에서 텍스트 파일로 다시 저장해 주세요.';

export function decodeTextFileBytes(bytes: Uint8Array) {
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : 'utf-8';
  try {
    return new TextDecoder(encoding, { fatal: true })
      .decode(bytes)
      .replace(/^\ufeff/, '')
      .replace(/\r\n?/g, '\n');
  } catch {
    throw new Error(TEXT_ENCODING_PROBLEM);
  }
}

export function textFileContentProblem(bytes: Uint8Array) {
  let text: string;
  try {
    text = decodeTextFileBytes(bytes);
  } catch {
    return TEXT_ENCODING_PROBLEM;
  }
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      (codePoint < 32 && ![9, 10, 13].includes(codePoint)) ||
      codePoint === 127 ||
      codePoint === 0xfffd ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    )
      return TEXT_CHARACTER_PROBLEM;
  }
  return '';
}
