import { uploadFileExtension, uploadFileFormat } from './upload-file-formats';

export function downloadContentType(filename: string) {
  return (
    uploadFileFormat(uploadFileExtension(filename))?.contentType ??
    'application/octet-stream'
  );
}
