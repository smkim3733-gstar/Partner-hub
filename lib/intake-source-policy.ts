import { MAX_TRANSCRIPT_FILE_BYTES } from './transcript-policy';

export const MAX_AI_SOURCE_BYTES = 8 * 1024 * 1024;
export const MAX_AI_SOURCE_FILES = 8;
export type IntakeSourceKind = 'text' | 'binary' | 'audio' | 'unsupported';
export type IntakeSourceOption = {
  id: string;
  name: string;
  category: string;
  size: number;
  createdAt: string;
  kind: IntakeSourceKind;
  blockedReason: string;
};
export type IntakeSourcePreview = {
  file: IntakeSourceOption;
  sourceHash: string;
  text?: string;
};

export function intakeSourceKind(name: string): IntakeSourceKind {
  if (/\.(docx|txt)$/i.test(name)) return 'text';
  if (/\.(pdf|png|jpe?g)$/i.test(name)) return 'binary';
  if (/\.(mp3|m4a|wav)$/i.test(name)) return 'audio';
  return 'unsupported';
}

export function intakeSourceProblem(file: { name: string; size: number }) {
  const kind = intakeSourceKind(file.name);
  if (kind === 'audio')
    return '음성은 자동 전사하지 않습니다. Word·TXT 녹취 문서로 변환한 뒤 등록해 주세요.';
  if (kind === 'unsupported')
    return 'Word·TXT 또는 PDF·JPG·PNG 사본으로 변환해 주세요.';
  if (!Number.isSafeInteger(file.size) || file.size <= 0)
    return '비어 있거나 크기를 확인할 수 없는 자료입니다.';
  if (kind === 'text' && file.size > MAX_TRANSCRIPT_FILE_BYTES)
    return '본문 읽기는 5MB 이하의 Word·TXT 문서만 지원합니다.';
  if (file.size > MAX_AI_SOURCE_BYTES)
    return '분석용 사본은 8MB 이하여야 합니다. 원본은 자료함에 보존됩니다.';
  return '';
}
