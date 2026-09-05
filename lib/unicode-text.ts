/** Reject malformed UTF-16 and non-display controls while preserving tab/newline. */
export function isSafeStoredText(value: string) {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index++;
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) return false;
    if (
      (unit < 32 && unit !== 9 && unit !== 10 && unit !== 13) ||
      (unit >= 127 && unit <= 159) ||
      unit === 0xfffd
    )
      return false;
  }
  return true;
}
