export type UploadSignatureKind =
  | 'pdf'
  | 'png'
  | 'jpeg'
  | 'xls'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'text'
  | 'mp3'
  | 'm4a'
  | 'wav';

export const UPLOAD_FILE_FORMATS = {
  pdf: { contentType: 'application/pdf', signature: 'pdf' },
  png: { contentType: 'image/png', signature: 'png' },
  jpg: { contentType: 'image/jpeg', signature: 'jpeg' },
  jpeg: { contentType: 'image/jpeg', signature: 'jpeg' },
  xlsx: {
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    signature: 'xlsx',
  },
  xls: { contentType: 'application/vnd.ms-excel', signature: 'xls' },
  docx: {
    contentType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    signature: 'docx',
  },
  pptx: {
    contentType:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    signature: 'pptx',
  },
  txt: { contentType: 'text/plain', signature: 'text' },
  md: { contentType: 'text/markdown', signature: 'text' },
  mp3: { contentType: 'audio/mpeg', signature: 'mp3' },
  m4a: { contentType: 'audio/mp4', signature: 'm4a' },
  wav: { contentType: 'audio/wav', signature: 'wav' },
} as const satisfies Record<
  string,
  { contentType: string; signature: UploadSignatureKind }
>;

export type UploadFileExtension = keyof typeof UPLOAD_FILE_FORMATS;

export function uploadFileExtension(filename: string) {
  return filename.split('.').at(-1)?.toLowerCase() ?? '';
}

export function uploadFileFormat(extension: string) {
  return UPLOAD_FILE_FORMATS[extension as UploadFileExtension];
}

export function uploadFileAccept(extensions: readonly UploadFileExtension[]) {
  return extensions.map((extension) => `.${extension}`).join(',');
}
