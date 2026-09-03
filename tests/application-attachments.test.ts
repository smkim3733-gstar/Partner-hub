import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApplicationAttachments } from '../components/application-attachments';
import {
  appendApplicationFiles,
  applicationAttachmentCategoryProblem,
  applicationAttachmentTitle,
  companyFileProblem,
  documentCategoryFromFileName,
  MAX_COMPANY_FILE_BYTES,
  type ApplicationAttachment,
} from '../lib/company-file-policy';

const makeFile = (name: string, body = '가상 파일 본문') =>
  new File([body], name, { lastModified: 12345 });

void test('intake UI exposes separate labeled recording and company inputs with safe file names', () => {
  const file = makeFile('<script>.txt');
  const html = renderToStaticMarkup(
    createElement(ApplicationAttachments, {
      value: [{ file, category: '상담녹취', categoryConfirmed: false }],
      onChange: () => {},
      disabled: false,
    }),
  );
  assert.match(html, /기업 기본자료/);
  assert.match(html, /녹취자료 등록 \(선택\)/);
  assert.equal((html.match(/type="file"/g) || []).length, 2);
  assert.match(html, /\.mp3,\.m4a,\.wav/);
  assert.match(html, /&lt;script&gt;\.txt/);
  assert.ok(!html.includes('<script>.txt'));
  assert.match(html, /외부 전송을 하지 않습니다/);
  assert.match(html, /현재 파일의 자료종류 확인/);
  assert.match(html, /파일명 기준 제안/);
});

void test('initial application combines business sources with explicit call documents and audio', () => {
  const basics = appendApplicationFiles(
    [],
    [makeFile('사업자등록증.pdf'), makeFile('크레탑.pdf')],
    false,
  ).files;
  const all = appendApplicationFiles(
    basics,
    [makeFile('notes.docx'), makeFile('voice.m4a')],
    true,
  ).files;
  assert.deepEqual(
    all.map((item) => item.category),
    ['사업자등록증', '크레탑', '상담녹취', '상담녹취'],
  );
  assert.deepEqual(
    all.map((item) => item.categoryConfirmed),
    [false, false, true, true],
  );
  assert.match(applicationAttachmentCategoryProblem(all), /사업자등록증\.pdf/);
  assert.equal(
    applicationAttachmentCategoryProblem(
      all.map((item) => ({ ...item, categoryConfirmed: true })),
    ),
    '',
  );
  assert.match(
    applicationAttachmentTitle(all[2]),
    /신청 전 전화상담 녹취자료.*notes.docx/,
  );
  assert.equal(
    basics.length,
    2,
    'adding recordings preserves existing business files without mutating input',
  );
  assert.equal(appendApplicationFiles(all, [all[2].file], true).duplicates, 1);
  assert.equal(
    appendApplicationFiles(all, [all[2].file], true).files.length,
    4,
  );
  assert.equal(
    documentCategoryFromFileName('사업자등록증.MP3'),
    '상담녹취',
    'audio cannot be misclassified as a registration certificate',
  );
  assert.equal(documentCategoryFromFileName('상담전사문.txt'), '상담녹취');
});

void test('unsupported, empty, oversized and excess attachments retain the current selection', () => {
  const existing: ApplicationAttachment[] = [
    { file: makeFile('크레탑.pdf'), category: '크레탑', categoryConfirmed: true },
  ];
  assert.throws(
    () =>
      appendApplicationFiles(
        existing,
        [makeFile('okay.txt'), makeFile('bad.exe')],
        true,
      ),
    /녹취자료/,
  );
  assert.equal(existing.length, 1);
  assert.throws(
    () => appendApplicationFiles(existing, [makeFile('empty.txt', '')], true),
    /비어/,
  );
  assert.throws(
    () =>
      appendApplicationFiles(
        [],
        Array.from({ length: 11 }, (_, i) => makeFile(`voice-${i}.txt`)),
        true,
      ),
    /10개/,
  );
  assert.match(
    companyFileProblem(
      { name: 'voice.wav', size: MAX_COMPANY_FILE_BYTES + 1 },
      '상담녹취',
    ),
    /25MB/,
  );
  assert.match(
    companyFileProblem({ name: 'voice.wav', size: 1 }, '기타자료'),
    /녹취자료/,
  );
  assert.equal(
    companyFileProblem({ name: 'call.pdf', size: 1 }, '상담녹취'),
    '',
  );
});
