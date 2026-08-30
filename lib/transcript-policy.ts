export const MAX_TRANSCRIPT_CHARS = 60_000;
export const MAX_TRANSCRIPT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export function transcriptProblem(value: string) {
  if (value.trim().length < 20) return '전사문은 20자 이상 입력해 주세요.';
  if (value.length > MAX_TRANSCRIPT_CHARS)
    return '전사문은 60,000자까지 처리합니다. 내용을 임의로 자르지 않았습니다. 상담을 나누어 등록해 주세요.';
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (
      (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
      code === 0xfffd
    )
      return '읽을 수 없는 문자가 있습니다. Word에서 다시 저장하거나 UTF-8 TXT로 변환해 주세요.';
  }
  return '';
}

export function transcriptFileProblem(file: { name: string; size: number }) {
  if (!/\.(docx|txt)$/i.test(file.name))
    return '전사문은 Word(.docx) 또는 TXT 파일로 첨부해 주세요. PDF·HWP·구형 DOC는 본문을 복사해 붙여넣을 수 있습니다.';
  if (!file.size) return '비어 있는 파일입니다. 전사문 본문을 확인해 주세요.';
  if (file.size > MAX_TRANSCRIPT_FILE_BYTES)
    return '전사문 파일은 5MB 이하여야 합니다.';
  return '';
}

export function audioFileProblem(file: { name: string; size: number }) {
  if (!/\.(mp3|m4a|wav)$/i.test(file.name))
    return '보조 음성은 MP3·M4A·WAV 파일로 첨부해 주세요.';
  if (!file.size || file.size > MAX_AUDIO_BYTES)
    return '음성 파일은 0바이트보다 크고 25MB 이하여야 합니다.';
  return '';
}
