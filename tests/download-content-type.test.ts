import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { downloadContentType } from '../lib/download-content-type';

void test('download MIME type comes from the allowlisted file extension', () => {
  const cases = {
    'analysis.PDF': 'application/pdf',
    'scan.jpeg': 'image/jpeg',
    'ledger.xlsx':
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'legacy.xls': 'application/vnd.ms-excel',
    'report.docx':
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'brief.pptx':
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'call.m4a': 'audio/mp4',
    'notes.txt': 'text/plain',
  };
  for (const [filename, expected] of Object.entries(cases))
    assert.equal(downloadContentType(filename), expected);
});

void test('unknown MIME values fall back and file routes use the shared boundary', async () => {
  assert.equal(
    downloadContentType('legacy.unknown'),
    'application/octet-stream',
  );
  assert.equal(downloadContentType('no-extension'), 'application/octet-stream');

  for (const route of [
    'app/api/files/[id]/route.ts',
    'app/api/consulting-flow/[caseId]/files/[fileId]/route.ts',
  ]) {
    const source = await readFile(join(process.cwd(), route), 'utf8');
    assert.match(source, /downloadContentType/);
    assert.doesNotMatch(
      source,
      /'content-type':\s*(row\.content_type|file\.contentType)/,
    );
  }
});
