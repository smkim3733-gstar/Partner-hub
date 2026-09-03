/** Shared upload rules. Category keys stay compatible with existing stored documents. */
export const companyFileCategories = [
  '사업자등록증',
  '크레탑',
  '재무제표',
  '상담녹취',
  '인증·특허',
  '계약자료',
  '요청서류',
  '기타자료',
] as const;
export type CompanyFileCategory = (typeof companyFileCategories)[number];
export const MAX_COMPANY_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_APPLICATION_FILES = 10;
export const companyFileAccept = '.pdf,.jpg,.jpeg,.png,.xlsx,.xls,.docx,.txt';
export const recordingFileAccept = '.docx,.txt,.pdf,.mp3,.m4a,.wav';
const documentExtensions = new Set([
  'pdf',
  'jpg',
  'jpeg',
  'png',
  'xlsx',
  'xls',
  'docx',
  'txt',
]);
const recordingExtensions = new Set([
  'docx',
  'txt',
  'pdf',
  'mp3',
  'm4a',
  'wav',
]);
const audioExtensions = new Set(['mp3', 'm4a', 'wav']);
const extension = (name: string) => name.split('.').at(-1)?.toLowerCase() || '';
export function safeFileName(value: string) {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return character === '\\' || character === '/' || code < 32 || code === 127
      ? '_'
      : character;
  })
    .join('')
    .trim()
    .slice(0, 180);
}
export const isAudioFile = (name: string) =>
  audioExtensions.has(extension(name));
export const companyCategoryLabel = (category: string) =>
  category === '상담녹취' ? '녹취자료' : category;

export function companyFileProblem(
  file: { name: string; size: number },
  category: CompanyFileCategory,
) {
  if (!file.name.trim() || !file.size)
    return '비어 있는 파일은 등록할 수 없습니다.';
  if (file.size > MAX_COMPANY_FILE_BYTES)
    return '파일 한 개의 크기는 25MB 이하여야 합니다.';
  const ext = extension(file.name);
  if (category === '상담녹취') {
    if (!recordingExtensions.has(ext))
      return '녹취자료는 Word(DOCX)·TXT·PDF 또는 MP3·M4A·WAV로 등록해 주세요.';
  } else if (isAudioFile(file.name)) {
    return '음성 파일은 녹취자료로 등록해 주세요.';
  } else if (!documentExtensions.has(ext)) {
    return '기업자료는 PDF·이미지·엑셀·Word(DOCX)·TXT로 등록해 주세요.';
  }
  return '';
}

export function documentCategoryFromFileName(
  name: string,
): CompanyFileCategory {
  const value = name.toLowerCase();
  if (isAudioFile(name) || /녹취|통화|전사문/.test(value)) return '상담녹취';
  if (value.includes('사업자')) return '사업자등록증';
  if (/cretop|크레탑/.test(value)) return '크레탑';
  if (/재무|결산/.test(value)) return '재무제표';
  if (/특허|인증/.test(value)) return '인증·특허';
  if (value.includes('계약')) return '계약자료';
  return '기타자료';
}

export type ApplicationAttachment = {
  file: File;
  category: CompanyFileCategory;
  categoryConfirmed: boolean;
};
export function applicationAttachmentCategoryProblem(
  items: ApplicationAttachment[],
) {
  const unconfirmed = items.find((item) => !item.categoryConfirmed);
  return unconfirmed
    ? `${unconfirmed.file.name}: 자료종류를 확인해 주세요.`
    : '';
}
export function applicationAttachmentTitle(item: ApplicationAttachment) {
  return item.category === '상담녹취'
    ? `신청 전 전화상담 녹취자료 · ${item.file.name}`
    : item.category === '기타자료'
      ? item.file.name
      : item.category;
}
export const attachmentKey = (file: File) =>
  `${file.name}:${file.size}:${file.lastModified}`;
export function appendApplicationFiles(
  current: ApplicationAttachment[],
  files: File[],
  recording: boolean,
) {
  const next = [...current];
  let duplicates = 0;
  for (const file of files) {
    if (next.some((item) => attachmentKey(item.file) === attachmentKey(file))) {
      duplicates++;
      continue;
    }
    const category = recording
      ? '상담녹취'
      : documentCategoryFromFileName(file.name);
    const issue = companyFileProblem(file, category);
    if (issue) throw new Error(`${file.name}: ${issue}`);
    next.push({ file, category, categoryConfirmed: recording });
  }
  if (next.length > MAX_APPLICATION_FILES)
    throw new Error(
      `한 번의 협업신청에는 자료를 ${MAX_APPLICATION_FILES}개까지 첨부해 주세요.`,
    );
  return { files: next, duplicates };
}
