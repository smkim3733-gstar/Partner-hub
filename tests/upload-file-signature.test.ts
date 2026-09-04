import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { uploadFileContentProblem } from '../lib/upload-file-signature';

const ooxml = (directory: 'word' | 'xl' | 'ppt') =>
  zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    [`${directory}/document.xml`]: strToU8('<document/>'),
  }) as Uint8Array<ArrayBuffer>;

void test('allowed binary uploads match their actual signatures', async () => {
  const cases: Array<[string, Uint8Array<ArrayBuffer> | string]> = [
    ['document.pdf', '%PDF-1.7\n'],
    ['image.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])],
    ['photo.jpeg', new Uint8Array([0xff, 0xd8, 0xff, 0xdb])],
    [
      'legacy.xls',
      new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    ],
    ['report.docx', ooxml('word')],
    ['ledger.xlsx', ooxml('xl')],
    ['brief.pptx', ooxml('ppt')],
    ['recording.mp3', new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0])],
    [
      'recording.m4a',
      new Uint8Array([
        0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0, 0, 0, 0,
        0x4d, 0x34, 0x41, 0x20,
      ]),
    ],
    [
      'recording.wav',
      new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
      ]),
    ],
  ];
  for (const [name, body] of cases)
    assert.equal(await uploadFileContentProblem(new File([body], name)), '');
});

void test('binary extension mismatches are rejected', async () => {
  for (const name of [
    'document.pdf',
    'image.png',
    'photo.jpg',
    'legacy.xls',
    'recording.mp3',
    'recording.m4a',
    'recording.wav',
  ])
    assert.match(
      await uploadFileContentProblem(new File(['<html>unsafe</html>'], name)),
      /실제 파일 형식/,
    );
});

void test('OOXML uploads require the matching internal document directory', async () => {
  assert.match(
    await uploadFileContentProblem(new File([ooxml('xl')], 'wrong.docx')),
    /실제 파일 형식/,
  );
  assert.match(
    await uploadFileContentProblem(
      new File(['PK\u0003\u0004fake'], 'wrong.pptx'),
    ),
    /실제 파일 형식/,
  );
});

void test('text uploads stay on their existing text-validation path', async () => {
  assert.equal(
    await uploadFileContentProblem(new File(['본문'], 'notes.txt')),
    '',
  );
  assert.equal(
    await uploadFileContentProblem(new File(['# 보고서'], 'report.md')),
    '',
  );
});

void test('both upload routes validate content before durable storage', async () => {
  for (const route of [
    'app/api/files/route.ts',
    'app/api/consulting-flow/[caseId]/route.ts',
  ]) {
    const source = await readFile(join(process.cwd(), route), 'utf8');
    assert.match(source, /uploadFileContentProblem/);
    assert.ok(
      source.lastIndexOf('uploadFileContentProblem') <
        Math.max(
          source.indexOf('storeCompanyUpload('),
          source.indexOf('flowBucket().put('),
        ),
    );
  }
});
