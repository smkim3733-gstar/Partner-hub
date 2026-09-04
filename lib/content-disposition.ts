const MAX_DOWNLOAD_FILENAME_CODE_POINTS = 180;

function safeDownloadFilename(value: string) {
  const characters = Array.from(value.normalize('NFC'), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return character === '/' ||
      character === '\\' ||
      codePoint < 32 ||
      codePoint === 127 ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ? '_'
      : character;
  });
  const filename = characters
    .slice(0, MAX_DOWNLOAD_FILENAME_CODE_POINTS)
    .join('')
    .trim();
  return filename || 'download';
}

function encodeRfc5987Value(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function attachmentContentDisposition(filename: string) {
  return `attachment; filename*=UTF-8''${encodeRfc5987Value(safeDownloadFilename(filename))}`;
}
