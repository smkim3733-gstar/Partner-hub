import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  companyFileAccept,
  companyPortalFileAccept,
  MAX_COMPANY_FILE_MEGABYTES,
  recordingFileAccept,
} from '../lib/company-file-policy';
import { downloadContentType } from '../lib/download-content-type';
import {
  UPLOAD_FILE_FORMATS,
  uploadFileAccept,
  uploadFileExtension,
  uploadFileFormat,
  type UploadFileExtension,
} from '../lib/upload-file-formats';

void test('one registry owns upload signatures and fixed MIME values', () => {
  const expected = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    xlsx:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    md: 'text/markdown',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
  };
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(UPLOAD_FILE_FORMATS).map(([extension, format]) => [
        extension,
        format.contentType,
      ]),
    ),
    expected,
  );
  for (const [extension, contentType] of Object.entries(expected)) {
    assert.equal(uploadFileExtension(`source.${extension.toUpperCase()}`), extension);
    assert.equal(uploadFileFormat(extension)?.contentType, contentType);
    assert.equal(downloadContentType(`source.${extension}`), contentType);
  }
});

void test('file input accept values derive from registered extensions', async () => {
  const extensions = Object.keys(UPLOAD_FILE_FORMATS) as UploadFileExtension[];
  assert.equal(uploadFileAccept(extensions), extensions.map((item) => `.${item}`).join(','));
  assert.equal(companyFileAccept, '.pdf,.jpg,.jpeg,.png,.xlsx,.xls,.docx,.txt');
  assert.equal(recordingFileAccept, '.docx,.txt,.pdf,.mp3,.m4a,.wav');
  assert.equal(
    companyPortalFileAccept,
    '.pdf,.jpg,.jpeg,.png,.xlsx,.xls,.docx,.txt,.mp3,.m4a,.wav',
  );
  assert.equal(MAX_COMPANY_FILE_MEGABYTES, 25);
  const page = await readFile(join(process.cwd(), 'app/page.tsx'), 'utf8');
  assert.match(page, /accept=\{companyPortalFileAccept\}/);
  assert.doesNotMatch(
    page,
    /accept="\.pdf,\.jpg,\.jpeg,\.png,\.xlsx,\.xls,\.docx,\.txt,\.mp3,\.m4a,\.wav"/,
  );
  assert.match(page, /파일당 \{MAX_COMPANY_FILE_MEGABYTES\}MB 이하/);
  assert.doesNotMatch(page, /파일당 25MB 이하/);
  const attachments = await readFile(
    join(process.cwd(), 'components/application-attachments.tsx'),
    'utf8',
  );
  assert.match(attachments, /\{MAX_COMPANY_FILE_MEGABYTES\}MB 이하/);
  assert.doesNotMatch(attachments, /파일당 25MB 이하/);
});
