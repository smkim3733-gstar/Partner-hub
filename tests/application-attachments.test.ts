import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  safeFileName,
  type ApplicationAttachment,
} from '../lib/company-file-policy';

const makeFile = (name: string, body = '가상 파일 본문') =>
  new File([body], name, { lastModified: 12345 });

async function attachment(
  name: string,
  category: ApplicationAttachment['category'],
  categoryConfirmed = true,
) {
  return (
    await appendApplicationFiles([], [makeFile(name)], category === '상담녹취')
  ).files.map((item) => ({ ...item, category, categoryConfirmed }))[0];
}

void test('stored upload names share one Unicode-safe boundary', () => {
  assert.equal(safeFileName(` e\u0301/\u0000\ud800.pdf `), 'é___.pdf');
  const longName = safeFileName(`${'😀'.repeat(181)}.pdf`);
  assert.equal(Array.from(longName).length, 180);
  assert.equal(Array.from(longName).at(-5), '😀');
  assert.equal(longName.endsWith('.pdf'), true);
});

void test('intake UI exposes separate labeled recording and company inputs with safe file names', async () => {
  const file = makeFile('<script>.txt');
  const item = await attachment('<script>.txt', '상담녹취', false);
  const html = renderToStaticMarkup(
    createElement(ApplicationAttachments, {
      value: [{ ...item, file }],
      onChange: () => {},
      onBusyChange: () => {},
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

void test('initial application combines business sources with explicit call documents and audio', async () => {
  const basics = (
    await appendApplicationFiles(
      [],
      [makeFile('사업자등록증.pdf'), makeFile('크레탑.pdf')],
      false,
    )
  ).files;
  const all = (
    await appendApplicationFiles(
      basics,
      [makeFile('notes.docx'), makeFile('voice.m4a')],
      true,
    )
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
  assert.equal(
    (await appendApplicationFiles(all, [all[2].file], true)).duplicates,
    1,
  );
  assert.equal(
    (await appendApplicationFiles(all, [all[2].file], true)).files.length,
    4,
  );
  assert.equal(
    documentCategoryFromFileName('사업자등록증.MP3'),
    '상담녹취',
    'audio cannot be misclassified as a registration certificate',
  );
  assert.equal(documentCategoryFromFileName('상담전사문.txt'), '상담녹취');
});

void test('unsupported, empty, oversized and excess attachments retain the current selection', async () => {
  const existing: ApplicationAttachment[] = [
    await attachment('크레탑.pdf', '크레탑'),
  ];
  await assert.rejects(
    appendApplicationFiles(
      existing,
      [makeFile('okay.txt'), makeFile('bad.exe')],
      true,
    ),
    /녹취자료/,
  );
  assert.equal(existing.length, 1);
  await assert.rejects(
    appendApplicationFiles(existing, [makeFile('empty.txt', '')], true),
    /비어/,
  );
  await assert.rejects(
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

void test('attachment deduplication follows normalized names and actual bytes', async () => {
  const name = '신청자료.txt';
  const first = new File(['AAAA'], name.normalize('NFD'), {
    type: 'text/html',
    lastModified: 100,
  });
  const same = new File(['AAAA'], name.normalize('NFC'), {
    type: 'application/x-alternate-text',
    lastModified: 200,
  });
  const changed = new File(['BBBB'], name.normalize('NFC'), {
    type: 'text/plain',
    lastModified: 100,
  });
  const selected = (await appendApplicationFiles([], [first], false)).files;
  const duplicate = await appendApplicationFiles(selected, [same], false);
  const distinct = await appendApplicationFiles(selected, [changed], false);
  assert.equal(duplicate.duplicates, 1);
  assert.equal(duplicate.files.length, 1);
  assert.equal(distinct.duplicates, 0);
  assert.equal(distinct.files.length, 2);
  assert.notEqual(distinct.files[0].fingerprint, distinct.files[1].fingerprint);
});

void test('application submission stays locked while attachment bytes are checked', () => {
  const picker = readFileSync(
    join(process.cwd(), 'components/application-attachments.tsx'),
    'utf8',
  );
  const page = readFileSync(join(process.cwd(), 'app/page.tsx'), 'utf8');
  assert.match(picker, /onBusyChange\(true\)/);
  assert.match(picker, /onBusyChange\(false\)/);
  assert.match(page, /attachmentBusyRef\.current/);
  assert.match(page, /onBusyChange=\{busy =>/);
  assert.match(page, /attachmentBusy \? '첨부 내용 확인 중'/);
  assert.match(
    page,
    /disabled=\{submitting \|\| draftBusy \|\| attachmentBusy \|\|/,
  );
});
